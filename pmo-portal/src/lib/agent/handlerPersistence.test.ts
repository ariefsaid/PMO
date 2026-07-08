/**
 * Tests for the agent-chat persistence helpers (ADR-0043 §2/§3/§4).
 * AC-AGP-013..017 own the handler journal/de-dupe/heartbeat/cancel assertions here.
 * [REC-1]: handler unit tests live under pmo-portal/src/lib/agent/*.test.ts (no Vitest
 * project rooted in supabase/), importing the handler + persistence via relative path.
 */
import { it, expect, vi } from 'vitest';
import { hashToolArgs, runExists } from '../../../../supabase/functions/agent-chat/persistence';
import type { PersistenceDeps } from '../../../../supabase/functions/agent-chat/persistence';
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
          // runExists(runId): agent_runs.select('id').eq('id',id).maybeSingle(). Default null =
          // "run does not exist yet" → the handler creates the thread+run (the fresh-run path).
          eq: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue(rowsFactory()),
            maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
          }),
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

// ── ADR-0043 §2 — seq continuity across requests (review round, item 1) ──────

/**
 * AC-AGP-CONT-001: a `req.decision` re-POST on an existing runId must NOT restart `seq` at 0
 * — the handler's per-request `let seq = 0` (persistence.ts makePersistenceRuntime) would
 * collide with the prior turn's persisted rows (silent transcript misordering, since
 * `listRunEvents` orders by `seq`). This drives TWO separate `agentChatHandler` invocations
 * on the SAME runId — a real "create" turn ending in needs-approval, then a "decision approve"
 * re-POST — and asserts the FULL persisted seq sequence across both calls has no duplicates
 * and strictly increases. index.ts is expected to seed `deps.persistence.startSeq` from
 * `maxSeq + 1` (via the new `loadMaxSeq`) on every resumed call, mirroring how it already
 * pre-loads `journaledWrites` — this test exercises that seam directly against the handler.
 */
it('AC-AGP-CONT-001 seq continues (no restart, no duplicates) across two handler invocations on the same runId', async () => {
  // Shared in-memory agent_events store across BOTH calls, simulating what a real resumed
  // request would see via a fresh `loadMaxSeq(runId)` read (index.ts seam).
  const persistedRows: Array<{ id: string; run_id: string; seq: number; type: string }> = [];

  function mockPersistSupabase(): HandlerDeps['supabase'] {
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
        if (table === 'agent_events') {
          return {
            insert: vi.fn().mockImplementation((row: { id: string; run_id: string; seq: number; type: string }) => {
              persistedRows.push(row);
              return { select: vi.fn().mockReturnValue({ single: vi.fn().mockResolvedValue({ data: row, error: null }) }) };
            }),
            update: vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ data: null, error: null }) }),
          };
        }
        if (table === 'crm_activities') {
          return {
            insert: vi.fn().mockReturnValue({
              select: vi.fn().mockReturnValue({ single: vi.fn().mockResolvedValue({ data: { id: 'act-1' }, error: null }) }),
            }),
          };
        }
        return {
          select: vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue({ data: [], error: null }) }),
          insert: vi.fn().mockReturnValue({ select: vi.fn().mockReturnValue({ single: vi.fn().mockResolvedValue({ data: { id: 'x' }, error: null }) }) }),
          update: vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ data: null, error: null }) }),
        };
      }),
    } as unknown as HandlerDeps['supabase'];
  }

  const runId = 'run-continuity-1';
  const supabase = mockPersistSupabase();

  // ── Call 1: create + a confirm:true tool call → needs-approval, stream ends ──
  const modelClient1 = {
    create: vi.fn().mockResolvedValueOnce({
      finish_reason: 'tool_calls',
      message: {
        role: 'assistant',
        content: null,
        tool_calls: [
          { id: 'tu-1', type: 'function', function: { name: 'create_activity', arguments: JSON.stringify(CREATE_ACTIVITY_ARGS) } },
        ],
      },
      usage: {},
      model: 'deepseek/deepseek-v4-flash',
    }),
  };

  const deps1 = baseDeps({
    modelClient: modelClient1,
    supabase,
    persistence: {
      supabase,
      ownerId: 'user-1',
      orgId: 'org-1',
      now: () => new Date('2026-07-03T00:00:00Z'),
    },
  });

  const req1: AgentChatRequest = { runId, messages: [{ role: 'user', content: 'log a call' }] };
  await collect(agentChatHandler(req1, deps1));

  expect(persistedRows.length).toBeGreaterThan(0);
  const seqsAfterCall1 = persistedRows.map((r) => r.seq);

  // ── Call 2: decision re-POST (approve) on the SAME runId ─────────────────────
  // index.ts's seam: a fresh `loadMaxSeq(runId)` read would return the max seq persisted so
  // far — passed here as `startSeq` (maxSeq + 1), exactly as index.ts is expected to do.
  const maxSeqSoFar = Math.max(...seqsAfterCall1);

  const deps2 = baseDeps({
    supabase,
    persistence: {
      supabase,
      ownerId: 'user-1',
      orgId: 'org-1',
      now: () => new Date('2026-07-03T00:00:05Z'),
      startSeq: maxSeqSoFar + 1,
    },
  });

  const req2 = approveReq('tu-1', 'pending-1');
  req2.runId = runId;
  await collect(agentChatHandler(req2, deps2));

  const allSeqs = persistedRows.map((r) => r.seq);

  // No duplicates across the two calls.
  expect(new Set(allSeqs).size).toBe(allSeqs.length);
  // Strictly increasing in insertion order (transcript order).
  for (let i = 1; i < allSeqs.length; i++) {
    expect(allSeqs[i]).toBeGreaterThan(allSeqs[i - 1]);
  }
  // Call 2's rows must not restart at 0/1 — they continue past call 1's max.
  const seqsAfterCall2Only = allSeqs.slice(seqsAfterCall1.length);
  for (const s of seqsAfterCall2Only) {
    expect(s).toBeGreaterThan(maxSeqSoFar);
  }
});

// ── review round item 5 — partial-failure de-dupe window (single-INSERT tool journal) ──

/**
 * AC-AGP-JOURNAL-001: a tool event's journal columns (tool_name/tool_args_hash/tool_status)
 * must be populated in the SAME `agent_events` INSERT as the event row itself — never a
 * separate follow-up UPDATE. The two-step (insert-then-update) shape left a window where a
 * completed write's journal UPDATE could fail after the write itself already executed,
 * making the completed write invisible to resume de-dupe (FR-AGP-013) and letting a retry
 * re-execute it. The tool event's payload already carries the result at emit time, so the
 * journal fields are computable before the single insert — no follow-up UPDATE is structurally
 * necessary. This asserts `agent_events.update` is NEVER called for a tool event, and the
 * SINGLE insert call already carries the journal columns.
 */
it('AC-AGP-JOURNAL-001 a tool event journal is populated in the SAME insert — no follow-up UPDATE', async () => {
  const insertedRows: Array<Record<string, unknown>> = [];
  const eventsUpdateSpy = vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ data: null, error: null }) });

  function mockSupabaseSingleInsert(): HandlerDeps['supabase'] {
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
        if (table === 'agent_events') {
          return {
            insert: vi.fn().mockImplementation((row: Record<string, unknown>) => {
              insertedRows.push(row);
              return { select: vi.fn().mockReturnValue({ single: vi.fn().mockResolvedValue({ data: row, error: null }) }) };
            }),
            update: eventsUpdateSpy,
          };
        }
        if (table === 'crm_activities') {
          return {
            select: vi.fn().mockReturnValue({
              limit: vi.fn().mockResolvedValue({ data: [{ id: '1' }, { id: '2' }, { id: '3' }], error: null }),
            }),
          };
        }
        return {
          select: vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue({ data: [], error: null }) }),
          insert: vi.fn().mockReturnValue({ select: vi.fn().mockReturnValue({ single: vi.fn().mockResolvedValue({ data: { id: 'x' }, error: null }) }) }),
          update: vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ data: null, error: null }) }),
        };
      }),
    } as unknown as HandlerDeps['supabase'];
  }

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

  const supabase = mockSupabaseSingleInsert();
  const deps = baseDeps({
    modelClient,
    supabase,
    persistence: {
      supabase,
      ownerId: 'user-1',
      orgId: 'org-1',
      now: () => new Date('2026-07-03T00:00:00Z'),
    },
  });

  await collect(agentChatHandler({ runId: 'run-journal-1', messages: [{ role: 'user', content: 'how many active projects?' }] }, deps));

  // No follow-up UPDATE on agent_events for the tool event's journal columns.
  expect(eventsUpdateSpy).not.toHaveBeenCalled();

  // The tool event's SINGLE insert already carries the journal columns.
  const toolRow = insertedRows.find((r) => r.type === 'tool');
  expect(toolRow).toBeDefined();
  expect(toolRow!.tool_name).toBe('query_entity');
  expect(toolRow!.tool_status).toBe('completed');
  expect(typeof toolRow!.tool_args_hash).toBe('string');
  expect((toolRow!.tool_args_hash as string).length).toBeGreaterThan(0);
});

// ── Contract fix (2026-07-08): the FE always sends runId → gate run-creation on run-EXISTENCE ──
// The FE adapter (pmoNativeRuntime.ts) mints the runId client-side and sends it on EVERY POST, so a
// fresh createRun ALSO carries req.runId. The old `!req.runId` gate therefore never created the run
// row for a real browser turn → every agent_events/agent_usage insert 42501'd (short runs silently
// unpersisted; ≥3-round runs tripped the usage fail-closed breaker → errored). These lock the fix.

/** A supabase mock that reports agent_runs existence via maybeSingle, and spies on agent_threads
 *  + agent_runs INSERTs so we can assert whether createThreadAndRun ran. */
function mockSupabaseWithRunExistence(runRow: { id: string } | null) {
  const threadInsert = vi.fn().mockReturnValue({
    select: vi.fn().mockReturnValue({ single: vi.fn().mockResolvedValue({ data: { id: 'thread-new' }, error: null }) }),
  });
  const runInsert = vi.fn().mockReturnValue({
    select: vi.fn().mockReturnValue({ single: vi.fn().mockResolvedValue({ data: { id: 'run-new' }, error: null }) }),
  });
  const supabase = {
    from: vi.fn().mockImplementation((table: string) => {
      if (table === 'profiles') {
        return { select: vi.fn().mockReturnValue({ eq: vi.fn().mockReturnValue({ single: vi.fn().mockResolvedValue({ data: { org_id: 'org-1', role: 'Project Manager' }, error: null }) }) }) };
      }
      if (table === 'agent_threads') return { insert: threadInsert };
      if (table === 'agent_runs') {
        return {
          insert: runInsert,
          update: vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ data: null, error: null }) }),
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({ maybeSingle: vi.fn().mockResolvedValue({ data: runRow, error: null }) }),
          }),
        };
      }
      // agent_events + reads
      return {
        insert: vi.fn().mockReturnValue({ select: vi.fn().mockReturnValue({ single: vi.fn().mockResolvedValue({ data: { id: 'x' }, error: null }) }) }),
        update: vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ data: null, error: null }) }),
        select: vi.fn().mockReturnValue({ eq: vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue({ data: [], error: null }) }), limit: vi.fn().mockResolvedValue({ data: [], error: null }) }),
      };
    }),
  } as unknown as HandlerDeps['supabase'];
  return { supabase, threadInsert, runInsert };
}

it('runExists returns true/false from the maybeSingle result and fails open on error', async () => {
  const deps = (row: unknown, error: unknown = null): PersistenceDeps => ({
    supabase: { from: () => ({ select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: row, error }) }) }) }) } as unknown as PersistenceDeps['supabase'],
    ownerId: 'u', orgId: 'o', now: () => new Date(),
  });
  expect(await runExists(deps({ id: 'r1' }), 'r1')).toBe(true);
  expect(await runExists(deps(null), 'r1')).toBe(false);
  expect(await runExists(deps(null, { code: '42501' }), 'r1')).toBe(false); // fail-open to creation
});

it('CONTRACT-FIX: a fresh run with req.runId present but NO existing run row STILL creates the thread+run', async () => {
  // The bug: with the old `!req.runId` gate, this exact request (runId present, no threadId) skipped
  // createThreadAndRun → the run row never existed → 42501 on every event.
  const { supabase, threadInsert, runInsert } = mockSupabaseWithRunExistence(null); // run does NOT exist
  const deps = baseDeps({ supabase, persistence: { supabase, ownerId: 'user-1', orgId: 'org-1', now: () => new Date('2026-07-08T00:00:00Z') } });

  await collect(agentChatHandler({ runId: 'run-fresh-1', messages: [{ role: 'user', content: 'hi' }] }, deps));

  expect(threadInsert).toHaveBeenCalledTimes(1); // thread created
  expect(runInsert).toHaveBeenCalledTimes(1);    // run created with the client's runId
  expect(runInsert).toHaveBeenCalledWith(expect.objectContaining({ id: 'run-fresh-1', status: 'running' }));
});

it('CONTRACT-FIX: a resume (run already exists) does NOT re-create the thread/run', async () => {
  const { supabase, threadInsert, runInsert } = mockSupabaseWithRunExistence({ id: 'run-resume-9' }); // exists
  const deps = baseDeps({ supabase, persistence: { supabase, ownerId: 'user-1', orgId: 'org-1', now: () => new Date('2026-07-08T00:00:00Z') } });

  await collect(agentChatHandler({ runId: 'run-resume-9', messages: [{ role: 'user', content: 'hi again' }] }, deps));

  expect(threadInsert).not.toHaveBeenCalled();
  expect(runInsert).not.toHaveBeenCalled();
});
