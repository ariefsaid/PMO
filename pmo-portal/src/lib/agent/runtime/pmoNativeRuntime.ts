/**
 * PmoNativeRuntime — the client-side adapter implementing AgentRuntime.
 *
 * This is the ONLY place in the SPA that knows the agent-chat transport (URL, SSE framing).
 * The panel (A2) and all callers depend only on the AgentRuntime port — swapping to
 * AgentNativeRuntime later requires no change to callers (FR-AR-001/024).
 *
 * D8/R5: stateless followUp — full transcript replayed per request; server is stateless.
 * D1/ADR-0042: SSE transport (text/event-stream), consumed via fetch + getReader().
 * NFR-AR-SEC-008: only the caller JWT is forwarded; no service-role key, no model API key.
 *
 * FR-AR-022/023/024.
 */

import type { AgentRun, AgentRuntime, AgentEvent, RunContext } from './port';
import {
  decodeSseStream,
  type AgentChatRequest,
  type ConversationMessage,
} from './transport';

export interface PmoNativeRuntimeOptions {
  /** Returns the current caller JWT (e.g. from supabase.auth.getSession). */
  getJwt: () => Promise<string> | string;
  /** URL of the agent-chat edge function (e.g. `${SUPABASE_URL}/functions/v1/agent-chat`). */
  fnUrl: string;
  /** Injectable fetch implementation (defaults to globalThis.fetch). */
  fetchImpl?: typeof fetch;
}

interface RunState {
  messages: ConversationMessage[];
  controller: AbortController;
  context?: RunContext;
}

/**
 * PmoNativeRuntime implements AgentRuntime.
 * Holds a per-run transcript client-side; re-POSTs the full message list each turn (D8).
 */
export class PmoNativeRuntime implements AgentRuntime {
  private readonly _opts: PmoNativeRuntimeOptions;
  private readonly _runs = new Map<string, RunState>();

  constructor(opts: PmoNativeRuntimeOptions) {
    this._opts = opts;
  }

  async createRun(input: { goal: string; context?: RunContext }): Promise<AgentRun> {
    const runId = crypto.randomUUID();
    const state: RunState = {
      messages: [{ role: 'user', content: input.goal }],
      controller: new AbortController(),
      context: input.context,
    };
    this._runs.set(runId, state);
    return {
      id: runId,
      title: input.goal.slice(0, 60),
      status: 'running',
    };
  }

  async followUp(runId: string, message: string): Promise<void> {
    const state = this._runs.get(runId);
    if (!state) return;
    state.messages.push({ role: 'user', content: message });
  }

  async control(
    runId: string,
    cmd: 'pause' | 'resume' | 'cancel' | 'approve' | 'reject',
  ): Promise<void> {
    if (cmd === 'cancel') {
      const state = this._runs.get(runId);
      state?.controller.abort();
    }
    // pause/resume/approve/reject are no-ops in A1 (FR-AR-005)
  }

  subscribe(runId: string): AsyncIterable<AgentEvent> {
    // Use arrow function for [Symbol.asyncIterator] to capture `this` lexically
    // (avoids no-this-alias lint error while preserving the correct binding).
    return {
      [Symbol.asyncIterator]: () => {
        let gen: AsyncGenerator<AgentEvent> | null = null;
        const getGen = (): AsyncGenerator<AgentEvent> => {
          if (!gen) gen = this._doSubscribe(runId);
          return gen;
        };
        return {
          next: () => getGen().next(),
          return: (value?: unknown) =>
            getGen().return(value as AgentEvent),
          throw: (e?: unknown) => getGen().throw(e),
        };
      },
    };
  }

  /**
   * Internal generator that performs one SSE request and yields events.
   *
   * Lifecycle: the _runs entry is created by createRun and deleted in the `finally`
   * block here, so it lives exactly as long as the stream. This prevents unbounded
   * growth in long-lived SPA sessions (Blocker 4 / A1 review).
   *
   * @param runId — the run whose state entry to subscribe and clean up.
   */
  private async *_doSubscribe(runId: string): AsyncGenerator<AgentEvent> {
    const state = this._runs.get(runId);
    if (!state) return;

    try {
      const jwt = await this._opts.getJwt();
      const fetchImpl = this._opts.fetchImpl ?? globalThis.fetch;

      const body: AgentChatRequest = {
        runId,
        messages: state.messages,
        context: state.context,
      };

      const resp = await fetchImpl(this._opts.fnUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${jwt}`,
        },
        body: JSON.stringify(body),
        signal: state.controller.signal,
      });

      if (!resp.ok || !resp.body) {
        // Yield an error status event and stop
        yield {
          id: crypto.randomUUID(),
          runId,
          type: 'status',
          payload: { status: 'errored', error: 'UPSTREAM_ERROR' },
          createdAt: new Date().toISOString(),
        } satisfies AgentEvent;
        return;
      }

      const reader = resp.body.getReader();

      for await (const ev of decodeSseStream(reader)) {
        // Accumulate assistant/tool events into the transcript for followUp (D8)
        if (ev.type === 'assistant' && ev.text) {
          state.messages.push({ role: 'assistant', content: ev.text });
        }
        yield ev;
      }
    } finally {
      // Clean up the run entry when the stream terminates (normal or error path).
      // Prevents unbounded Map growth in long-lived SPA sessions (Blocker 4).
      this._runs.delete(runId);
    }
  }
}
