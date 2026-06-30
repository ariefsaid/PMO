/**
 * Unit tests for PmoNativeRuntime.
 * FR-AR-022/023/024: adapter correctness.
 * Blocker 4: _runs Map is cleaned up after stream terminates (no memory leak).
 */
import { it, expect, vi } from 'vitest';
import { PmoNativeRuntime } from './runtime/pmoNativeRuntime';
import { encodeSse } from './runtime/transport';
import type { AgentEvent } from './runtime/port';

/** Convert a string body into a ReadableStream<Uint8Array>. */
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

function makeRuntime(events: AgentEvent[]): PmoNativeRuntime {
  const body = events.map(encodeSse).join('');
  const fetchImpl = vi.fn().mockResolvedValue({
    ok: true,
    body: readableFrom(body),
  }) as unknown as typeof fetch;

  return new PmoNativeRuntime({
    getJwt: () => 'caller-jwt',
    fnUrl: 'http://x/functions/v1/agent-chat',
    fetchImpl,
  });
}

const EVENTS: AgentEvent[] = [
  { id: '1', runId: 'r', type: 'user', createdAt: 'a' },
  { id: '2', runId: 'r', type: 'assistant', text: 'hi', createdAt: 'b' },
  { id: '3', runId: 'r', type: 'status', payload: { status: 'completed' }, createdAt: 'c' },
];

// ── Blocker 4: _runs Map cleanup after stream terminates ──────────────────────

it('Blocker 4: _runs Map entry is deleted after subscribe stream completes (no memory leak)', async () => {
  // RED: before the fix, _runs.delete was never called → the Map grows unboundedly.
  // Access the private _runs map via a type cast to verify cleanup.
  const runtime = makeRuntime(EVENTS);
  const run = await runtime.createRun({ goal: 'test' });

  // The run entry should exist after createRun
  const runsMap = (runtime as unknown as { _runs: Map<string, unknown> })._runs;
  expect(runsMap.has(run.id)).toBe(true);

  // Consume the entire stream
  for await (const _ of runtime.subscribe(run.id)) { /* drain */ }

  // After stream completes, the Map entry must be deleted
  expect(runsMap.has(run.id)).toBe(false);
});

it('Blocker 4: _runs Map entry is deleted even when the fetch fails (error path cleanup)', async () => {
  const fetchImpl = vi.fn().mockResolvedValue({
    ok: false,
    body: null,
  }) as unknown as typeof fetch;

  const runtime = new PmoNativeRuntime({
    getJwt: () => 'caller-jwt',
    fnUrl: 'http://x/functions/v1/agent-chat',
    fetchImpl,
  });

  const run = await runtime.createRun({ goal: 'test' });
  const runsMap = (runtime as unknown as { _runs: Map<string, unknown> })._runs;
  expect(runsMap.has(run.id)).toBe(true);

  // Drain the stream (will yield an error status event then end)
  for await (const _ of runtime.subscribe(run.id)) { /* drain */ }

  // Map entry must be cleaned up even on the error path
  expect(runsMap.has(run.id)).toBe(false);
});
