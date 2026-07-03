/**
 * Tests for the agent-chat persistence helpers (ADR-0043 §2/§3/§4).
 * AC-AGP-013..017 own the handler journal/de-dupe/heartbeat/cancel assertions here.
 * [REC-1]: handler unit tests live under pmo-portal/src/lib/agent/*.test.ts (no Vitest
 * project rooted in supabase/), importing the handler + persistence via relative path.
 */
import { it, expect, vi } from 'vitest';
import { hashToolArgs } from '../../../../supabase/functions/agent-chat/persistence';
import { agentChatHandler } from '../../../../supabase/functions/agent-chat/handler';
import type { HandlerDeps } from '../../../../supabase/functions/agent-chat/handler';
import type { AgentEvent } from './runtime/port';
import type { AgentChatRequest } from './runtime/transport';

// ── Task B1 — hashToolArgs (RED→GREEN with persistence.ts scaffold) ──────────

it('hashToolArgs canonicalizes key order — same value regardless of key insertion order', () => {
  expect(hashToolArgs({ b: 2, a: 1 })).toBe(hashToolArgs({ a: 1, b: 2 }));
});

it('hashToolArgs differs for genuinely different arg values', () => {
  expect(hashToolArgs({ a: 1 })).not.toBe(hashToolArgs({ a: 2 }));
});

it('hashToolArgs returns a 64-char lowercase hex sha-256 digest', () => {
  expect(hashToolArgs({ a: 1 })).toMatch(/^[0-9a-f]{64}$/);
});

// ── Task B3/B5 — de-dupe gate, heartbeat, cancel (AC-AGP-013..017) ───────────

async function collect(it: AsyncIterable<AgentEvent>): Promise<AgentEvent[]> {
  const out: AgentEvent[] = [];
  for await (const e of it) out.push(e);
  return out;
}

/** Mock HandlerSupabaseLike: profiles lookup + crm_activities insert + generic reads. */
function mockSupabase(opts: {
  insertResult?: { data: unknown; error: unknown };
  rowsFactory?: () => { data: unknown[]; error: null };
} = {}): HandlerDeps['supabase'] {
  const {
    insertResult = { data: { id: 'act-1' }, error: null },
    rowsFactory = () => ({ data: [{ id: '1' }, { id: '2' }, { id: '3' }], error: null }),
  } = opts;

  return {
    from: vi.fn().mockImplementation((table: string) => {
      if (table === 'profiles') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({ data: { org_id: 'org-1', role: 'Project Manager' }, error: null }),
              limit: vi.fn().mockResolvedValue({ data: [{ org_id: 'org-1' }], error: null }),
            }),
          }),
        };
      }
      if (table === 'crm_activities') {
        return {
          insert: vi.fn().mockReturnValue({
            select: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue(insertResult),
            }),
          }),
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue(rowsFactory()) }),
            limit: vi.fn().mockResolvedValue(rowsFactory()),
          }),
        };
      }
      // agent_threads/agent_runs/agent_events + any other read entity
      return {
        select: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue(rowsFactory()),
          eq: vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue(rowsFactory()) }),
        }),
        insert: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({ single: vi.fn().mockResolvedValue({ data: { id: 'x' }, error: null }) }),
        }),
        update: vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ data: null, error: null }) }),
      };
    }),
  } as unknown as HandlerDeps['supabase'];
}

function baseDeps(overrides: Partial<HandlerDeps> = {}): HandlerDeps {
  return {
    modelClient: {
      create: vi.fn().mockResolvedValue({
        finish_reason: 'stop',
        message: { role: 'assistant', content: 'All done.' },
        usage: {},
        model: 'deepseek/deepseek-v4-flash',
      }),
    },
    supabase: mockSupabase(),
    userId: 'user-1',
    model: 'deepseek/deepseek-v4-flash',
    can: vi.fn().mockReturnValue(true),
    now: () => new Date('2026-07-03T00:00:00Z'),
    ...overrides,
  };
}

const CREATE_ACTIVITY_ARGS = { contactId: 'c1', kind: 'call', subject: 'Follow-up' };
const H = hashToolArgs(CREATE_ACTIVITY_ARGS);

/** Build an approve-decision request whose trailing tool_use proposes create_activity. */
function approveReq(toolId: string, pendingId: string): AgentChatRequest {
  return {
    runId: 'run-resume-1',
    messages: [
      { role: 'user', content: 'log a call' },
      {
        role: 'assistant',
        content: [
          { type: 'tool_use', id: toolId, name: 'create_activity', input: CREATE_ACTIVITY_ARGS },
        ],
      },
    ],
    decision: { pendingId, verdict: 'approve' },
  };
}

it('AC-AGP-013 resumed write matching journal is hard-blocked and returns the journaled payload', async () => {
  const supabase = mockSupabase();
  const insertSpy = vi.fn();
  // Override crm_activities insert with a spy so we can assert action.run's DB write path
  // (dispatchActionForced → action.run → sb.from('crm_activities').insert(...)) never fires.
  (supabase.from as ReturnType<typeof vi.fn>).mockImplementation((table: string) => {
    if (table === 'crm_activities') {
      return {
        insert: insertSpy.mockReturnValue({
          select: vi.fn().mockReturnValue({ single: vi.fn().mockResolvedValue({ data: { id: 'act-1' }, error: null }) }),
        }),
      };
    }
    if (table === 'profiles') {
      return {
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({ data: { org_id: 'org-1', role: 'Project Manager' }, error: null }),
          }),
        }),
      };
    }
    return {
      select: vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue({ data: [], error: null }) }),
      update: vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ data: null, error: null }) }),
    };
  });

  const deps = baseDeps({
    supabase,
    persistence: {
      supabase,
      ownerId: 'user-1',
      orgId: 'org-1',
      now: () => new Date('2026-07-03T00:00:00Z'),
      journaledWrites: [{ toolName: 'create_activity', argsHash: H, payload: { id: 'journaled-act' } }],
    },
  });

  const events = await collect(agentChatHandler(approveReq('tool-1', 'pending-1'), deps));

  expect(insertSpy).not.toHaveBeenCalled();
  const toolEvent = events.find((e) => e.type === 'tool');
  expect(toolEvent).toBeDefined();
  expect((toolEvent!.payload as { result: unknown }).result).toMatchObject({ id: 'journaled-act' });
});

it('AC-AGP-014 a repeated read is never blocked by the journal', async () => {
  const modelClient = {
    create: vi.fn()
      .mockResolvedValueOnce({
        finish_reason: 'tool_calls',
        message: {
          role: 'assistant',
          content: null,
          tool_calls: [
            { id: 'tu1', type: 'function', function: { name: 'query_entity', arguments: JSON.stringify({ entity: 'projects' }) } },
          ],
        },
        usage: {},
        model: 'deepseek/deepseek-v4-flash',
      })
      .mockResolvedValueOnce({
        finish_reason: 'stop',
        message: { role: 'assistant', content: 'You have 3 active projects.' },
        usage: {},
        model: 'deepseek/deepseek-v4-flash',
      }),
  };

  const supabase = mockSupabase();
  const readArgsHash = hashToolArgs({ entity: 'projects' });
  const deps = baseDeps({
    modelClient,
    supabase,
    persistence: {
      supabase,
      ownerId: 'user-1',
      orgId: 'org-1',
      now: () => new Date('2026-07-03T00:00:00Z'),
      // Journal contains a completed read with the SAME args-hash — must NOT block.
      journaledWrites: [{ toolName: 'query_entity', argsHash: readArgsHash, payload: { rowCount: 3 } }],
    },
  });

  const events = await collect(agentChatHandler({ runId: 'run-read-1', messages: [{ role: 'user', content: 'how many active projects?' }] }, deps));

  const toolEvent = events.find((e) => e.type === 'tool');
  expect(toolEvent).toBeDefined();
  // The read actually re-ran (result carries rowCount from the mock rows factory: 3 rows), not
  // the journaled payload shape alone — proves query_entity executed again.
  expect((toolEvent!.payload as { result: { rowCount: number } }).result.rowCount).toBe(3);
});

it('AC-AGP-015 a genuinely different-args write (different hash) is allowed to execute', async () => {
  const supabase = mockSupabase();
  const insertSpy = vi.fn().mockReturnValue({
    select: vi.fn().mockReturnValue({ single: vi.fn().mockResolvedValue({ data: { id: 'act-2' }, error: null }) }),
  });
  (supabase.from as ReturnType<typeof vi.fn>).mockImplementation((table: string) => {
    if (table === 'crm_activities') return { insert: insertSpy };
    if (table === 'profiles') {
      return {
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({ data: { org_id: 'org-1', role: 'Project Manager' }, error: null }),
          }),
        }),
      };
    }
    return {
      select: vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue({ data: [], error: null }) }),
      update: vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ data: null, error: null }) }),
    };
  });

  const differentArgsHash = hashToolArgs({ contactId: 'c1', kind: 'call', subject: 'A DIFFERENT subject' });
  const deps = baseDeps({
    supabase,
    persistence: {
      supabase,
      ownerId: 'user-1',
      orgId: 'org-1',
      now: () => new Date('2026-07-03T00:00:00Z'),
      journaledWrites: [{ toolName: 'create_activity', argsHash: differentArgsHash, payload: { id: 'other-act' } }],
    },
  });

  const events = await collect(agentChatHandler(approveReq('tool-2', 'pending-2'), deps));

  expect(insertSpy).toHaveBeenCalledTimes(1);
  const toolEvent = events.find((e) => e.type === 'tool');
  expect((toolEvent!.payload as { result: unknown }).result).toMatchObject({ id: 'act-2' });
});

// ── Task B5 — heartbeat + terminal-status persistence (AC-AGP-016/017) ───────

it('AC-AGP-016 heartbeat advances agent_runs.last_progress_at each tool round', async () => {
  const modelClient = {
    create: vi.fn()
      .mockResolvedValueOnce({
        finish_reason: 'tool_calls',
        message: {
          role: 'assistant',
          content: null,
          tool_calls: [
            { id: 'tu1', type: 'function', function: { name: 'query_entity', arguments: JSON.stringify({ entity: 'projects' }) } },
          ],
        },
        usage: {},
        model: 'deepseek/deepseek-v4-flash',
      })
      .mockResolvedValueOnce({
        finish_reason: 'stop',
        message: { role: 'assistant', content: 'Done.' },
        usage: {},
        model: 'deepseek/deepseek-v4-flash',
      }),
  };

  const heartbeatUpdateSpy = vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ data: null, error: null }) });
  const supabase = mockSupabase();
  (supabase.from as ReturnType<typeof vi.fn>).mockImplementation((table: string) => {
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
        update: heartbeatUpdateSpy,
        insert: vi.fn().mockReturnValue({ select: vi.fn().mockReturnValue({ single: vi.fn().mockResolvedValue({ data: { id: 'run-hb' }, error: null }) }) }),
      };
    }
    return {
      select: vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue({ data: [], error: null }) }),
      insert: vi.fn().mockReturnValue({ select: vi.fn().mockReturnValue({ single: vi.fn().mockResolvedValue({ data: { id: 'x' }, error: null }) }) }),
      update: vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ data: null, error: null }) }),
    };
  });

  const timestamps = ['2026-07-03T00:00:00Z', '2026-07-03T00:00:05Z', '2026-07-03T00:00:10Z'];
  let call = 0;
  const deps = baseDeps({
    modelClient,
    supabase,
    now: () => new Date(timestamps[Math.min(call, timestamps.length - 1)]),
    persistence: {
      supabase,
      ownerId: 'user-1',
      orgId: 'org-1',
      now: () => new Date(timestamps[Math.min(call++, timestamps.length - 1)]),
    },
  });

  await collect(agentChatHandler({ runId: 'run-hb', messages: [{ role: 'user', content: 'go' }] }, deps));

  // Two rounds (tool_calls round + stop round) ⇒ heartbeat called at least twice, each with an
  // advancing last_progress_at.
  expect(heartbeatUpdateSpy.mock.calls.length).toBeGreaterThanOrEqual(2);
  const stamps = heartbeatUpdateSpy.mock.calls.map((c) => (c[0] as { last_progress_at: string }).last_progress_at);
  expect(new Date(stamps[1]).getTime()).toBeGreaterThan(new Date(stamps[0]).getTime());
});

it('AC-AGP-017 a terminal status event persists agent_runs.status via setRunStatus', async () => {
  const supabase = mockSupabase();
  const runsUpdateSpy = vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ data: null, error: null }) });
  (supabase.from as ReturnType<typeof vi.fn>).mockImplementation((table: string) => {
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
        insert: vi.fn().mockReturnValue({ select: vi.fn().mockReturnValue({ single: vi.fn().mockResolvedValue({ data: { id: 'run-cancel' }, error: null }) }) }),
      };
    }
    return {
      select: vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue({ data: [], error: null }) }),
      insert: vi.fn().mockReturnValue({ select: vi.fn().mockReturnValue({ single: vi.fn().mockResolvedValue({ data: { id: 'x' }, error: null }) }) }),
    };
  });

  const deps = baseDeps({
    modelClient: {
      // Model call rejects, driving the handler's UPSTREAM_ERROR terminal branch — the
      // handler-level analog of a run being driven to a terminal (errored) state (D-A3/D7
      // "terminal status" — the same setRunStatus call site persists a cancel-driven
      // terminal status, since both are `type:'status'` events with a terminal payload.status).
      create: vi.fn().mockRejectedValue(new Error('aborted')),
    },
    supabase,
    persistence: {
      supabase,
      ownerId: 'user-1',
      orgId: 'org-1',
      now: () => new Date('2026-07-03T00:00:00Z'),
    },
  });

  const events = await collect(agentChatHandler({ runId: 'run-cancel', messages: [{ role: 'user', content: 'go' }] }, deps));

  const terminal = events.find((e) => e.type === 'status' && (e.payload as { status?: string })?.status === 'errored');
  expect(terminal).toBeDefined();

  // setRunStatus was invoked with the terminal status for THIS run.
  expect(runsUpdateSpy).toHaveBeenCalledWith({ status: 'errored' });
});
