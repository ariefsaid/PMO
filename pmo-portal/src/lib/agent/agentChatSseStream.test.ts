/**
 * Tests for `agent-chat/sseStream.ts` — the SSE drain loop extracted from index.ts's inline
 * `ReadableStream.start()` body (review round 2026-07-28, mirrors the plan's own D2 precedent:
 * telegram-notify's drain loop moved into logic.ts "so it can be unit-tested at all").
 *
 * Test-location convention (ADR-0039 decision-7): edge-fn logic tests live under pmo-portal/
 * (Vitest's root); the implementation stays in supabase/functions/, imported by relative path.
 *
 * WHY this extraction exists: agent-chat/index.ts's ReadableStream.start() ran
 * `try { for await … } finally { close }` with NO catch. A throw from the generator happens
 * AFTER the 200 response has already gone out (start() runs post-return), so
 * wrapWithErrorReporting's outer try/catch — around the Response the handler RETURNS — can never
 * see it: truncated SSE, zero error_events, on the highest-traffic function in the set.
 */
import { describe, it, expect, vi } from 'vitest';
import { drainSseStream } from '../../../../supabase/functions/agent-chat/sseStream';
import type { AgentEvent } from './runtime/transport';

async function* events(...evs: AgentEvent[]): AsyncGenerator<AgentEvent> {
  for (const ev of evs) yield ev;
}

async function* throwingEvents(): AsyncGenerator<AgentEvent> {
  yield { type: 'text_delta', delta: 'partial' } as unknown as AgentEvent;
  throw new Error('boom mid-stream');
}

function fakeController() {
  const chunks: Uint8Array[] = [];
  let closed = false;
  return {
    chunks,
    get closed() {
      return closed;
    },
    controller: {
      enqueue: (c: Uint8Array) => chunks.push(c),
      close: () => {
        closed = true;
      },
    },
  };
}

describe('drainSseStream', () => {
  it('pipes every event to the controller and closes it (happy path unchanged)', async () => {
    const fc = fakeController();
    const onStreamError = vi.fn();

    await drainSseStream(events({ type: 'text_delta', delta: 'a' } as unknown as AgentEvent), fc.controller, onStreamError);

    expect(fc.chunks.length).toBe(1);
    expect(fc.closed).toBe(true);
    expect(onStreamError).not.toHaveBeenCalled();
  });

  it('FR-AGP-016: a dropped socket (enqueue throw) stops enqueueing but keeps draining the generator to completion', async () => {
    const closeSpy = vi.fn();
    let calls = 0;
    const controller = {
      enqueue: () => {
        calls += 1;
        throw new Error('socket dropped');
      },
      close: closeSpy,
    };
    const onStreamError = vi.fn();

    await drainSseStream(events({ type: 'a' } as unknown as AgentEvent, { type: 'b' } as unknown as AgentEvent), controller, onStreamError);

    // enqueue is attempted once (the first failure flips socketLive=false) and the generator is
    // still drained to completion (no early break) — persistence writes complete server-side.
    expect(calls).toBe(1);
    expect(closeSpy).toHaveBeenCalledTimes(1);
    expect(onStreamError).not.toHaveBeenCalled();
  });

  it('review round: a throw from the generator itself is reported via onStreamError — the AFTER-response failure this extraction exists to catch', async () => {
    const fc = fakeController();
    const onStreamError = vi.fn();

    await drainSseStream(throwingEvents(), fc.controller, onStreamError);

    expect(onStreamError).toHaveBeenCalledTimes(1);
    expect(onStreamError.mock.calls[0][0]).toBeInstanceOf(Error);
    expect((onStreamError.mock.calls[0][0] as Error).message).toBe('boom mid-stream');
    // The stream is still closed even though the generator threw (finally, unchanged behavior).
    expect(fc.closed).toBe(true);
  });

  it('the controller is still closed even when onStreamError itself throws (never lets a reporting failure skip the close)', async () => {
    const fc = fakeController();
    const onStreamError = vi.fn(() => {
      throw new Error('reporter down');
    });

    await expect(drainSseStream(throwingEvents(), fc.controller, onStreamError)).rejects.toThrow();
    expect(fc.closed).toBe(true);
  });

  it('tolerates an already-closed/errored controller (finally-close does not throw out)', async () => {
    const controller = {
      enqueue: vi.fn(),
      close: () => {
        throw new Error('already closed');
      },
    };

    await expect(
      drainSseStream(events({ type: 'a' } as unknown as AgentEvent), controller, vi.fn()),
    ).resolves.toBeUndefined();
  });
});
