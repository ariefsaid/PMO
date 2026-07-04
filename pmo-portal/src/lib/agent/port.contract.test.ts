/**
 * AC-AR-009: PmoNativeRuntime satisfies the port contract (FR-AR-025).
 * Uses a scripted SSE fetch mock; no live network.
 *
 * Blocker 5: cancel test now uses CANCEL_SCRIPTED_MIN (8+) events so the
 * assertion proves early termination rather than vacuously passing for a
 * short stream where 3 ≤ 3.
 */
import { runAgentRuntimeContract, CANCEL_SCRIPTED_MIN } from './runtime/runtime.contract';
import { PmoNativeRuntime } from './runtime/pmoNativeRuntime';
import { encodeSse } from './runtime/transport';
import { vi } from 'vitest';
import type { AgentEvent } from './runtime/port';

/** Convert a string into a ReadableStream<Uint8Array> with a .getReader() method. */
function readableFrom(body: string): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  const bytes = enc.encode(body);
  return new ReadableStream({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
}

/** Build a scripted fetch that returns a fake SSE stream of the given events. */
function scriptedFetch(events: AgentEvent[]): typeof fetch {
  const body = events.map(encodeSse).join('');
  return vi.fn().mockResolvedValue({
    ok: true,
    body: readableFrom(body),
  }) as unknown as typeof fetch;
}

/** Minimal 3-event scripted stream for the standard contract tests. */
const SCRIPTED_EVENTS: AgentEvent[] = [
  { id: '1', runId: 'r', type: 'user', createdAt: 'a' },
  { id: '2', runId: 'r', type: 'assistant', text: 'hi', createdAt: 'b' },
  { id: '3', runId: 'r', type: 'status', payload: { status: 'completed' }, createdAt: 'c' },
];

/**
 * Long scripted stream for the cancel contract test (Blocker 5).
 * Uses CANCEL_SCRIPTED_MIN + extra events so proving events.length < scriptedCount
 * is meaningful.
 */
function makeLongScriptedEvents(): AgentEvent[] {
  const events: AgentEvent[] = [
    { id: 'u1', runId: 'r', type: 'user', createdAt: 'a' },
  ];
  for (let i = 0; i < CANCEL_SCRIPTED_MIN; i++) {
    events.push({
      id: `a${i}`,
      runId: 'r',
      type: 'assistant',
      text: `Intermediate answer ${i}`,
      createdAt: `b${i}`,
    });
  }
  events.push({
    id: 's1',
    runId: 'r',
    type: 'status',
    payload: { status: 'completed' },
    createdAt: 'z',
  });
  return events;
}

const LONG_EVENTS = makeLongScriptedEvents();

runAgentRuntimeContract(
  () =>
    new PmoNativeRuntime({
      getJwt: () => 'caller-jwt',
      fnUrl: 'http://x/functions/v1/agent-chat',
      fetchImpl: scriptedFetch(SCRIPTED_EVENTS),
    }),
  () => {
    // For the cancel test, use a fetch that honours AbortSignal between chunks.
    //
    // Correctness-remediation (finding 4): control('cancel') now ALSO fires a SEPARATE
    // fire-and-forget POST (no AbortSignal of its own — see PmoNativeRuntime._postCancel)
    // to drive the server-side abort. A real `fetch()` scopes its AbortSignal per-request,
    // so that second, signal-less request has zero effect on the FIRST request's own
    // signal — this fixture must model that same per-request isolation (a SINGLE shared
    // `capturedSignal` variable would be overwritten to `undefined` by the second,
    // signal-less call, masking the first request's real abort — a fixture artifact, not
    // a production bug). Track signals keyed by call index instead.
    let callIndex = 0;
    const capturedSignals: Array<AbortSignal | undefined> = [];
    const fetchImpl = ((_url: string, init?: RequestInit) => {
      const thisCallIndex = callIndex++;
      capturedSignals[thisCallIndex] = init?.signal as AbortSignal | undefined;
      if (thisCallIndex > 0) {
        // The cancel-POST (or any subsequent call) — not the streamed run itself;
        // no scripted body needed, the contract test only drains the FIRST subscribe.
        return Promise.resolve({ ok: true, body: readableFrom('') } as unknown as Response);
      }
      // Return a stream that checks THIS call's own signal.aborted between chunks.
      return new Promise<Response>((resolve) => {
        // Resolved synchronously so _doSubscribe can start reading;
        // the stream itself pauses between chunks via microtask
        resolve({
          ok: true,
          body: (() => {
            const enc = new TextEncoder();
            let idx = 0;
            return new ReadableStream<Uint8Array>({
              async pull(controller) {
                await Promise.resolve(); // yield to event loop so cancel can be called
                const aborted = capturedSignals[thisCallIndex]?.aborted ?? false;
                if (aborted || idx >= LONG_EVENTS.length) {
                  controller.close();
                  return;
                }
                controller.enqueue(enc.encode(encodeSse(LONG_EVENTS[idx++])));
              },
            });
          })(),
        } as unknown as Response);
      });
    }) as typeof fetch;

    return {
      runtime: new PmoNativeRuntime({
        getJwt: () => 'caller-jwt',
        fnUrl: 'http://x/functions/v1/agent-chat',
        fetchImpl,
      }),
      scriptedCount: LONG_EVENTS.length,
    };
  },
);
