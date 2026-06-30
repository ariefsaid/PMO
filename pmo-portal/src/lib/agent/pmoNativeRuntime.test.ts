/**
 * Unit tests for PmoNativeRuntime.
 * FR-AR-022/023/024: adapter correctness.
 * Blocker 4: _runs Map is cleaned up after stream terminates (no memory leak).
 * A3 (Task 19): control('approve'/'reject') stashes decision → re-POST carries decision.
 */
import { it, expect, vi } from 'vitest';
import { PmoNativeRuntime } from './runtime/pmoNativeRuntime';
import { encodeSse } from './runtime/transport';
import type { AgentEvent, NeedsApprovalPayload } from './runtime/port';
import type { AgentChatRequest } from './runtime/transport';

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

// ── Task 19 (RED→GREEN): A3 approve/reject control sends decision on re-POST ──

it('AC-AW-adapter: control(approve) stashes decision; next subscribe re-POSTs with decision.verdict=approve', async () => {
  // First subscribe: emits needs-approval event with pendingId:'p1', then ends
  const needsApprovalEvent: AgentEvent = {
    id: 'na-1',
    runId: 'r1',
    type: 'status',
    payload: {
      status: 'needs-approval',
      pendingId: 'p1',
      actionName: 'create_activity',
      humanSummary: 'Log a call',
      structuredArgs: { contactId: 'c1', kind: 'call', subject: 'Follow-up' },
    } satisfies NeedsApprovalPayload,
    createdAt: new Date().toISOString(),
  };

  const toolResultEvent: AgentEvent = {
    id: 'tr-1',
    runId: 'r1',
    type: 'tool',
    payload: { name: 'create_activity', pendingId: 'p1', result: { id: 'act-1' } },
    createdAt: new Date().toISOString(),
  };
  const completedEvent: AgentEvent = {
    id: 'comp-1',
    runId: 'r1',
    type: 'status',
    payload: { status: 'completed' },
    createdAt: new Date().toISOString(),
  };

  const firstBody = needsApprovalEvent;
  const secondBody = [toolResultEvent, completedEvent];

  let callCount = 0;
  const fetchMock = vi.fn().mockImplementation(() => {
    callCount++;
    if (callCount === 1) {
      return Promise.resolve({
        ok: true,
        body: readableFrom(encodeSse(firstBody)),
      });
    }
    return Promise.resolve({
      ok: true,
      body: readableFrom(secondBody.map(encodeSse).join('')),
    });
  });

  const runtime = new PmoNativeRuntime({
    getJwt: () => 'caller-jwt',
    fnUrl: 'http://x/functions/v1/agent-chat',
    fetchImpl: fetchMock as unknown as typeof fetch,
  });

  const run = await runtime.createRun({ goal: 'log a call' });

  // First subscribe → drain → see needs-approval, stream ends
  const events1: AgentEvent[] = [];
  for await (const ev of runtime.subscribe(run.id)) {
    events1.push(ev);
  }
  expect(events1.some((e) => (e.payload as { status?: string })?.status === 'needs-approval')).toBe(true);

  // Stash approve decision and re-subscribe
  await runtime.control(run.id, 'approve');
  const events2: AgentEvent[] = [];
  for await (const ev of runtime.subscribe(run.id)) {
    events2.push(ev);
  }

  // The second POST must carry decision.verdict === 'approve'
  expect(fetchMock).toHaveBeenCalledTimes(2);
  const secondCall = fetchMock.mock.calls[1] as [string, RequestInit];
  const body = JSON.parse(secondCall[1].body as string) as AgentChatRequest;
  expect(body.decision).toEqual({ pendingId: 'p1', verdict: 'approve' });

  // The second subscribe should see the tool and completed events
  expect(events2.some((e) => e.type === 'tool')).toBe(true);
  expect(events2.some((e) => (e.payload as { status?: string })?.status === 'completed')).toBe(true);
});

// ── Blocker 5: adapter must replay tool_use block in transcript so handler can find it ──
// Without this, findTrailingConfirmToolUse returns null and approve is a silent no-op.
it('Blocker-5 AC-AW-adapter: on needs-approval, re-POST messages include assistant tool_use block', async () => {
  const structuredArgs = { contactId: 'c1', kind: 'call', subject: 'Follow-up' };
  const pendingId = 'p1-b5';

  const needsApprovalEvent: AgentEvent = {
    id: 'na-b5',
    runId: 'r-b5',
    type: 'status',
    payload: {
      status: 'needs-approval',
      pendingId,
      actionName: 'create_activity',
      humanSummary: 'Log a call',
      structuredArgs,
    } satisfies NeedsApprovalPayload,
    createdAt: new Date().toISOString(),
  };
  const completedEvent: AgentEvent = {
    id: 'comp-b5',
    runId: 'r-b5',
    type: 'status',
    payload: { status: 'completed' },
    createdAt: new Date().toISOString(),
  };

  let callCount = 0;
  const fetchMockB5 = vi.fn().mockImplementation(() => {
    callCount++;
    if (callCount === 1) {
      return Promise.resolve({ ok: true, body: readableFrom(encodeSse(needsApprovalEvent)) });
    }
    return Promise.resolve({ ok: true, body: readableFrom(encodeSse(completedEvent)) });
  });

  const runtime = new PmoNativeRuntime({
    getJwt: () => 'caller-jwt',
    fnUrl: 'http://x/functions/v1/agent-chat',
    fetchImpl: fetchMockB5 as unknown as typeof fetch,
  });

  const run = await runtime.createRun({ goal: 'log a call' });
  for await (const _ of runtime.subscribe(run.id)) { /* drain first */ }

  await runtime.control(run.id, 'approve');
  for await (const _ of runtime.subscribe(run.id)) { /* drain second */ }

  const secondCall = fetchMockB5.mock.calls[1] as [string, RequestInit];
  const body = JSON.parse(secondCall[1].body as string) as AgentChatRequest;

  // The re-POST messages MUST contain an assistant turn with a tool_use content block
  // for create_activity, so findTrailingConfirmToolUse in handler.ts can find it.
  // Without this block, approve is a silent no-op (Blocker-5).
  const assistantMsg = body.messages.find(
    (m) =>
      m.role === 'assistant' &&
      Array.isArray(m.content) &&
      (m.content as Array<{ type?: string; name?: string }>).some(
        (b) => b.type === 'tool_use' && b.name === 'create_activity',
      ),
  );
  expect(assistantMsg).toBeDefined();

  // The tool_use block must carry the pendingId as its id so handler can match it
  const toolUseBlock = (assistantMsg!.content as Array<{ type?: string; name?: string; id?: string; input?: unknown }>).find(
    (b) => b.type === 'tool_use',
  );
  expect(toolUseBlock?.id).toBe(pendingId);
  expect(toolUseBlock?.input).toEqual(structuredArgs);
});

it('AC-AW-adapter: control(reject) stashes decision; next subscribe re-POSTs with verdict=reject', async () => {
  const needsApprovalEvent: AgentEvent = {
    id: 'na-2',
    runId: 'r2',
    type: 'status',
    payload: {
      status: 'needs-approval',
      pendingId: 'p2',
      actionName: 'create_activity',
      humanSummary: 'Log a call',
      structuredArgs: {},
    } satisfies NeedsApprovalPayload,
    createdAt: new Date().toISOString(),
  };
  const completedEvent: AgentEvent = {
    id: 'comp-2',
    runId: 'r2',
    type: 'status',
    payload: { status: 'completed' },
    createdAt: new Date().toISOString(),
  };

  let callCount = 0;
  const fetchMock2 = vi.fn().mockImplementation(() => {
    callCount++;
    if (callCount === 1) {
      return Promise.resolve({
        ok: true,
        body: readableFrom(encodeSse(needsApprovalEvent)),
      });
    }
    return Promise.resolve({
      ok: true,
      body: readableFrom(encodeSse(completedEvent)),
    });
  });

  const runtime = new PmoNativeRuntime({
    getJwt: () => 'caller-jwt',
    fnUrl: 'http://x/functions/v1/agent-chat',
    fetchImpl: fetchMock2 as unknown as typeof fetch,
  });

  const run = await runtime.createRun({ goal: 'log a call' });
  for await (const _ of runtime.subscribe(run.id)) { /* drain first */ }

  await runtime.control(run.id, 'reject');
  for await (const _ of runtime.subscribe(run.id)) { /* drain second */ }

  const secondCall2 = fetchMock2.mock.calls[1] as [string, RequestInit];
  const body2 = JSON.parse(secondCall2[1].body as string) as AgentChatRequest;
  expect(body2.decision).toEqual({ pendingId: 'p2', verdict: 'reject' });
});
