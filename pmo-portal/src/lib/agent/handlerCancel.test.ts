/**
 * RED-first regression test for gpt-5.5 cross-family audit finding 4:
 * "no server cancel path."
 *
 * Bug: control('cancel') (PmoNativeRuntime) only aborts the client-side fetch —
 * agent_runs.status is never set to a terminal state server-side, so a
 * cancelled run's persisted status stays whatever it was before (e.g.
 * 'running') forever, contradicting ADR-0043 §4's "cancel sets
 * agent_runs.status='errored' (or a terminal cancelled state)".
 *
 * Fix: agent-chat now handles a `req.cancel: { runId }` request shape by
 * emitting a terminal errored/CANCELLED status event under the caller JWT —
 * the SAME setRunStatus call site withPersistence already uses for every
 * other terminal status persists it, no new persistence code needed.
 *
 * [REC-1]: handler unit tests live under pmo-portal/src/lib/agent/*.test.ts.
 */
import { it, expect, vi } from 'vitest';
import { agentChatHandler } from '../../../../supabase/functions/agent-chat/handler';
import type { HandlerDeps } from '../../../../supabase/functions/agent-chat/handler';
import type { AgentEvent } from './runtime/port';
import type { AgentChatRequest } from './runtime/transport';

async function collect(it: AsyncIterable<AgentEvent>): Promise<AgentEvent[]> {
  const out: AgentEvent[] = [];
  for await (const e of it) out.push(e);
  return out;
}

function mockSupabase(runsUpdateSpy: ReturnType<typeof vi.fn>): HandlerDeps['supabase'] {
  return {
    from: vi.fn().mockImplementation((table: string) => {
      if (table === 'profiles') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({ data: { org_id: 'org-1', role: 'Project Manager' }, error: null }),
            }),
          }),
        };
      }
      if (table === 'agent_runs') {
        return {
          update: runsUpdateSpy,
          insert: vi.fn().mockReturnValue({
            select: vi.fn().mockReturnValue({ single: vi.fn().mockResolvedValue({ data: { id: 'run-cancel-1' }, error: null }) }),
          }),
        };
      }
      return {
        select: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue({ data: [], error: null }),
          eq: vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue({ data: [], error: null }) }),
        }),
        insert: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({ single: vi.fn().mockResolvedValue({ data: { id: 'x' }, error: null }) }),
        }),
      };
    }),
  } as unknown as HandlerDeps['supabase'];
}

it('control(cancel) drives the run to a persisted terminal status', async () => {
  const create = vi.fn(); // must NEVER be called — cancel makes no model call
  const runsUpdateSpy = vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ data: null, error: null }) });
  const supabase = mockSupabase(runsUpdateSpy);

  const req = {
    runId: 'run-cancel-1',
    messages: [{ role: 'user', content: 'do something slow' }],
    cancel: { runId: 'run-cancel-1' },
  } as unknown as AgentChatRequest;

  const deps: HandlerDeps = {
    modelClient: { create },
    supabase,
    userId: 'user-1',
    model: 'deepseek/deepseek-v4-flash',
    now: () => new Date('2026-07-03T00:00:00Z'),
    persistence: {
      supabase,
      ownerId: 'user-1',
      orgId: 'org-1',
      now: () => new Date('2026-07-03T00:00:00Z'),
    },
  };

  const events = await collect(agentChatHandler(req, deps));

  // A terminal status event fires — the SSE-visible half of the cancel contract.
  const terminal = events.find((e) => e.type === 'status' && (e.payload as { status?: string })?.status === 'errored');
  expect(terminal).toBeDefined();
  expect((terminal?.payload as { error?: string })?.error).toBe('CANCELLED');

  // The DURABLE half: agent_runs.status is persisted via setRunStatus (the SAME call
  // site every other terminal status uses — withPersistence's status-event hook).
  expect(runsUpdateSpy).toHaveBeenCalledWith({ status: 'errored' });

  // No model call — a cancel is a pure server-side status write, not a continuation.
  expect(create).not.toHaveBeenCalled();
});
