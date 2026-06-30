/**
 * AC-AR-009: PmoNativeRuntime satisfies the port contract (FR-AR-025).
 * Uses a scripted SSE fetch mock; no live network.
 */
import { runAgentRuntimeContract } from './runtime/runtime.contract';
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

const SCRIPTED_EVENTS: AgentEvent[] = [
  { id: '1', runId: 'r', type: 'user', createdAt: 'a' },
  { id: '2', runId: 'r', type: 'assistant', text: 'hi', createdAt: 'b' },
  { id: '3', runId: 'r', type: 'status', payload: { status: 'completed' }, createdAt: 'c' },
];

runAgentRuntimeContract(() => new PmoNativeRuntime({
  getJwt: () => 'caller-jwt',
  fnUrl: 'http://x/functions/v1/agent-chat',
  fetchImpl: scriptedFetch(SCRIPTED_EVENTS),
}));
