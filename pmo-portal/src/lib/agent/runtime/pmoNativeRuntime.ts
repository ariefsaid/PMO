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

import type { AgentRun, AgentRuntime, AgentEvent, RunContext, NeedsApprovalPayload, QuestionPayload, AgentAnswer } from './port';
import {
  decodeSseStream,
  type AgentChatRequest,
  type AgentDecision,
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
  /** A3: pendingId from the most recent needs-approval event (stashed to send on re-POST). */
  pendingId?: string;
  /** A3: decision to send on the next re-POST (approve or reject). */
  pendingDecision?: AgentDecision;
  /** A3: true when the stream ended in needs-approval (run is paused, not done — preserve Map entry). */
  awaitingDecision?: boolean;
  /** ADR-0045 §2: questionId from the most recent pending question event. */
  pendingQuestionId?: string;
  /** ADR-0045 §2: answer to send on the next re-POST. */
  pendingAnswer?: AgentAnswer;
  /** ADR-0045 §2: true when the stream ended awaiting a question answer (run is paused). */
  awaitingAnswer?: boolean;
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
    cmd: 'pause' | 'resume' | 'cancel' | 'approve' | 'reject' | 'answer',
    payload?: AgentAnswer,
  ): Promise<void> {
    if (cmd === 'cancel') {
      const state = this._runs.get(runId);
      // Abort the client-side fetch (unchanged, existing behavior — stops this browser
      // tab from continuing to read/render the stream).
      state?.controller.abort();
      // Correctness-remediation (ADR-0043 §4, finding 4): ALSO drive a server-side
      // abort — a plain client-side AbortController.abort() only stops THIS browser
      // from reading the response; it does nothing to agent_runs.status (the edge fn,
      // per ADR-0043 §6, keeps running the turn server-side to a terminal state even
      // after the client disconnects — by design, for durable-resume). Fire-and-forget
      // a SEPARATE POST carrying { cancel: { runId } } so the server sets a persisted
      // terminal status regardless of what the aborted fetch above does. Deliberately
      // NOT awaited by the caller in the critical path (stop() should feel instant);
      // errors are swallowed — a failed cancel-POST is no worse than the pre-fix
      // behavior (no server-side effect at all).
      void this._postCancel(runId);
      return;
    }
    if (cmd === 'approve' || cmd === 'reject') {
      const state = this._runs.get(runId);
      if (!state?.pendingId) return; // no pending decision to stash
      const verdict: 'approve' | 'reject' = cmd === 'approve' ? 'approve' : 'reject';
      state.pendingDecision = { pendingId: state.pendingId, verdict };
      return;
    }
    if (cmd === 'answer') {
      const state = this._runs.get(runId);
      if (!state?.pendingQuestionId || !payload) return; // no pending question to stash
      state.pendingAnswer = { questionId: state.pendingQuestionId, optionId: payload.optionId, freeText: payload.freeText };
      return;
    }
    // pause/resume are no-ops
  }

  /**
   * Correctness-remediation (ADR-0043 §4, finding 4): fire-and-forget POST carrying
   * `{ cancel: { runId } }` — a SEPARATE request from the run's own SSE fetch (which
   * `control('cancel')` already aborts client-side above), so it succeeds even though
   * that other request's AbortController just fired. A minimal request body is enough:
   * the handler's cancel branch makes no model call and needs no messages/context — it
   * only needs `runId` to persist the terminal status.
   */
  private async _postCancel(runId: string): Promise<void> {
    try {
      const jwt = await this._opts.getJwt();
      const fetchImpl = this._opts.fetchImpl ?? globalThis.fetch;
      const body: AgentChatRequest = {
        runId,
        messages: [],
        cancel: { runId },
      };
      await fetchImpl(this._opts.fnUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${jwt}`,
        },
        body: JSON.stringify(body),
      });
    } catch {
      // Best-effort — a failed cancel-POST leaves the server's run status un-updated
      // (no worse than the pre-fix behavior, which never attempted this at all). BUT this
      // must not be FULLY silent (observability hardening, harden #1 item 3, spike
      // 2026-07-04): a stuck server-side run with no client-visible signal is a support
      // dead-end. Emit a structured console.warn — never the raw error's message/stack
      // (could carry a URL/host/token-adjacent detail) — so the failure is at least
      // greppable in browser/telemetry logs.
      console.warn(`[pmo-native-runtime] cancel-POST failed`, {
        errorCode: 'CANCEL_POST_FAILED',
        runId,
      });
    }
  }

  subscribe(runId: string): AsyncIterable<AgentEvent> {
    // A3/ADR-0045 §2: if the run is awaiting a decision or a question answer,
    // re-create a fresh run state for the re-POST (restore the messages + context
    // but NOT the awaiting flags).
    const existingState = this._runs.get(runId);
    if (existingState?.awaitingDecision || existingState?.awaitingAnswer) {
      // Rehydrate run entry for the next POST (re-create controller; preserve messages+context)
      const newState: RunState = {
        messages: existingState.messages,
        controller: new AbortController(),
        context: existingState.context,
        pendingId: existingState.pendingId,
        pendingDecision: existingState.pendingDecision,
        awaitingDecision: false,
        pendingQuestionId: existingState.pendingQuestionId,
        pendingAnswer: existingState.pendingAnswer,
        awaitingAnswer: false,
      };
      this._runs.set(runId, newState);
    }

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
   * A3 exception: if the stream ends in `needs-approval`, the entry is PRESERVED
   * (awaitingDecision=true) so the stashed pendingId+decision survives to the next
   * subscribe() call. After the decision re-POST resolves (completed/errored), the
   * entry is deleted normally.
   *
   * @param runId — the run whose state entry to subscribe and clean up.
   */
  private async *_doSubscribe(runId: string): AsyncGenerator<AgentEvent> {
    const state = this._runs.get(runId);
    if (!state) return;

    // Consume (and clear) any stashed decision/answer so each is sent exactly once.
    const decision = state.pendingDecision;
    state.pendingDecision = undefined;
    const answer = state.pendingAnswer;
    state.pendingAnswer = undefined;

    let endedInNeedsApproval = false;
    let endedInQuestion = false;

    try {
      const jwt = await this._opts.getJwt();
      const fetchImpl = this._opts.fetchImpl ?? globalThis.fetch;

      const body: AgentChatRequest = {
        runId,
        messages: state.messages,
        context: state.context,
        // A3: include decision on re-POST if present
        ...(decision ? { decision } : {}),
        // ADR-0045 §2: include answer on re-POST if present
        ...(answer ? { answer } : {}),
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

        // A3: stash pendingId from needs-approval events for the next control() call.
        // Also push the assistant tool_use block into state.messages so the re-POST
        // transcript contains the trailing confirm-action tool_use block that
        // findTrailingConfirmToolUse() in handler.ts needs to locate.
        // Without this block, approve is a silent no-op (Blocker-5).
        if (
          ev.type === 'status' &&
          (ev.payload as NeedsApprovalPayload | undefined)?.status === 'needs-approval'
        ) {
          const payload = ev.payload as NeedsApprovalPayload;
          state.pendingId = payload.pendingId;
          endedInNeedsApproval = true;

          // Reconstruct the assistant tool_use block from the needs-approval payload.
          // The pendingId doubles as the tool_use id so the handler's tool_result
          // (appended on approve/reject) references the correct tool_use_id.
          state.messages.push({
            role: 'assistant',
            content: [
              {
                type: 'tool_use',
                id: payload.pendingId,
                name: payload.actionName,
                input: payload.structuredArgs,
              },
            ],
          });
        } else if (
          ev.type === 'status' &&
          (ev.payload as QuestionPayload | undefined)?.kind === 'question'
        ) {
          // ADR-0045 §2: stash questionId from question events for the next control()
          // call, and reconstruct the assistant ask_user tool_use block (mirrors the
          // needs-approval reconstruction above) so findTrailingQuestion in handler.ts
          // can locate it on the answer re-POST.
          const payload = ev.payload as QuestionPayload;
          state.pendingQuestionId = payload.questionId;
          endedInQuestion = true;

          state.messages.push({
            role: 'assistant',
            content: [
              {
                type: 'tool_use',
                id: payload.questionId,
                name: 'ask_user',
                input: { prompt: payload.prompt, options: payload.options, allowFreeText: payload.allowFreeText },
              },
            ],
          });
        } else if (ev.type === 'status') {
          // Any other status (completed, errored) means the run is no longer paused.
          endedInNeedsApproval = false;
          endedInQuestion = false;
        }

        yield ev;
      }

      // If the last notable status was needs-approval/question, the run is paused (not done).
      if (endedInNeedsApproval) {
        state.awaitingDecision = true;
      }
      if (endedInQuestion) {
        state.awaitingAnswer = true;
      }
    } finally {
      // A3/ADR-0045 §2: preserve the Map entry when the stream ended in needs-approval
      // or awaiting a question answer (run is paused). Delete in all other cases to
      // prevent unbounded Map growth (Blocker 4).
      if (!state.awaitingDecision && !state.awaitingAnswer) {
        this._runs.delete(runId);
      }
    }
  }
}
