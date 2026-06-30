/**
 * Transport codec tests.
 * FR-AR-019, AR-OD-001 (SSE transport, D1/D8).
 */
import { it, expect } from 'vitest';
import { encodeSse, decodeSseStream } from './transport';
import type { AgentEvent } from './port';

/** Create a fake ReadableStreamDefaultReader-like object from string chunks. */
function fakeReader(
  chunks: string[],
): ReadableStreamDefaultReader<Uint8Array> {
  const enc = new TextEncoder();
  let i = 0;
  return {
    read() {
      if (i < chunks.length) {
        return Promise.resolve({ value: enc.encode(chunks[i++]), done: false });
      }
      return Promise.resolve({ value: undefined, done: true });
    },
    cancel: () => Promise.resolve(),
    releaseLock: () => {},
    closed: Promise.resolve(undefined),
  } as unknown as ReadableStreamDefaultReader<Uint8Array>;
}

it('encodeSse emits one `data: <json>\\n\\n` frame per event', () => {
  const ev: AgentEvent = {
    id: 'e1',
    runId: 'r1',
    type: 'assistant',
    text: 'hi',
    createdAt: '2026-06-30T00:00:00Z',
  };
  expect(encodeSse(ev)).toBe(`data: ${JSON.stringify(ev)}\n\n`);
});

it('decodeSseStream yields each AgentEvent across chunk boundaries', async () => {
  const e1: AgentEvent = { id: 'e1', runId: 'r1', type: 'user', createdAt: 'x' };
  const e2: AgentEvent = {
    id: 'e2',
    runId: 'r1',
    type: 'status',
    payload: { status: 'completed' },
    createdAt: 'y',
  };
  const frames = encodeSse(e1) + encodeSse(e2);
  // split mid-frame to prove buffering
  const reader = fakeReader([frames.slice(0, 10), frames.slice(10)]);
  const out: AgentEvent[] = [];
  for await (const ev of decodeSseStream(reader)) out.push(ev);
  expect(out).toEqual([e1, e2]);
});
