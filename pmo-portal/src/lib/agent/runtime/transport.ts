/**
 * SSE transport codec — the ONLY site in the SPA that knows the agent-chat wire format.
 *
 * D1/ADR-0042: transport = SSE (text/event-stream). Each AgentEvent is one
 * `data: <json>\n\n` frame. Browser consumes via fetch + response.body.getReader()
 * (NOT EventSource — EventSource cannot POST/auth).
 *
 * D8: AgentChatRequest carries full messages array (stateless followUp).
 * FR-AR-019: typed request/error contract shared by handler + PmoNativeRuntime.
 */

import type { AgentEvent, AgentRunStatus, RunContext, AgentAnswer } from './port.ts';

export type { AgentAnswer };

export type { AgentEvent };

export interface ConversationMessage {
  role: 'user' | 'assistant';
  content: string | ContentBlock[];
}

export interface ContentBlock {
  type: string;
  [key: string]: unknown;
}

/** A3: approve/reject decision carried on re-POST (D-A3-1, AW-OD-004 Option B). */
export interface AgentDecision {
  /** The pendingId from the needs-approval event; used for audit/chip bookkeeping. */
  pendingId: string;
  /** 'approve' → execute the write; 'reject' → decline + model acknowledges. */
  verdict: 'approve' | 'reject';
}

/**
 * ADR-0043 §4 (correctness-remediation finding 4): present on a re-POST driving a
 * server-side abort. `runId` is carried explicitly (rather than relying solely on the
 * top-level `AgentChatRequest.runId`) so the shape is self-describing on the wire —
 * mirrors AgentDecision/AgentAnswer's own explicit id fields.
 */
export interface AgentCancel {
  runId: string;
}

/** The JSON body POSTed to agent-chat for both createRun and followUp (D8/R5). */
export interface AgentChatRequest {
  /** Present on followUp; omitted on createRun (adapter mints it client-side). */
  runId?: string;
  /** Full conversation history — the handler is stateless (D8). */
  messages: ConversationMessage[];
  /** Optional UI context hints. */
  context?: RunContext;
  /** Tier-2 attachments: caller-scoped references, never raw bytes. */
  attachmentIds?: string[];
  /** A3: present on an approve/deny re-POST (D-A3-1, AW-OD-004 Option B). */
  decision?: AgentDecision;
  /** ADR-0045 §2: present on a re-POST resolving a pending ask-user question (DEC-1). */
  answer?: AgentAnswer;
  /**
   * ADR-0043 §4 (correctness-remediation finding 4): present on a re-POST driving a
   * server-side abort — `control('cancel')` sends this instead of (or alongside)
   * aborting the client-side fetch, so `agent_runs.status` reaches a persisted
   * terminal state even though the browser gave up on the stream.
   */
  cancel?: AgentCancel;
}

/** Typed error shape for non-2xx responses from agent-chat. */
export interface AgentChatError {
  status: 400 | 401 | 429 | 502;
  error: 'BAD_REQUEST' | 'UNAUTHORIZED' | 'RATE_LIMITED' | 'UPSTREAM_ERROR';
  detail?: string;
  retryAfterSeconds?: number;
}

// ── SSE codec ─────────────────────────────────────────────────────────────────

/**
 * Encode one AgentEvent as a single SSE frame: `data: <json>\n\n`.
 * D1: one frame per event; framing isolated here.
 */
export function encodeSse(ev: AgentEvent): string {
  return `data: ${JSON.stringify(ev)}\n\n`;
}

/**
 * Decode an SSE stream from a ReadableStreamDefaultReader.
 * Buffers UTF-8 across chunk boundaries; yields one AgentEvent per `data:` frame.
 * Handles the `data: <json>\n\n` format produced by encodeSse on the server.
 */
export async function* decodeSseStream(
  reader: ReadableStreamDefaultReader<Uint8Array>,
): AsyncIterable<AgentEvent> {
  const dec = new TextDecoder();
  let buffer = '';

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += dec.decode(value, { stream: true });

    // A complete SSE frame ends with \n\n; split on that boundary.
    let boundary = buffer.indexOf('\n\n');
    while (boundary !== -1) {
      const frame = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      boundary = buffer.indexOf('\n\n');

      // Strip the `data: ` prefix and parse JSON.
      const line = frame.startsWith('data: ') ? frame.slice(6) : frame;
      if (line.trim()) {
        try {
          yield JSON.parse(line) as AgentEvent;
        } catch {
          // Malformed frame — skip (don't crash the stream).
        }
      }
    }
  }

  // Flush any remaining buffered complete frame (no trailing \n\n).
  const remaining = buffer.trim();
  if (remaining) {
    const line = remaining.startsWith('data: ') ? remaining.slice(6) : remaining;
    if (line.trim()) {
      try {
        yield JSON.parse(line) as AgentEvent;
      } catch {
        // Skip malformed.
      }
    }
  }
}

// Re-export AgentRunStatus for adapter convenience.
export type { AgentRunStatus };
