/**
 * Tests for agent-chat's live-context grounding + thread-scope write (ADR-0045 §3).
 * AC-ATC-012: context.entity grounds query_entity read (a prompt hint, untrusted).
 * AC-ATC-013: forged context entity id yields zero rows, not elevated access.
 * AC-ATC-014: createRun with context.entity populates thread scope.
 * AC-ATC-015: createRun with no entity writes scope null.
 * AC-ATC-016: follow-up context does not overwrite existing scope.
 * [REC-1]: handler unit tests live under pmo-portal/src/lib/agent/*.test.ts (no Vitest
 * project rooted in supabase/), importing the handler via relative path.
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

/**
 * Mock HandlerSupabaseLike that resolves the profiles lookup, a configurable
 * query_entity read (rowsFactory), and captures agent_threads inserts (scope arg)
 * for AC-ATC-014/015/016.
 */
function mockSupabase(opts: {
  rowsFactory?: () => { data: unknown[]; error: null };
  threadInsertSpy?: (row: Record<string, unknown>) => void;
} = {}): HandlerDeps['supabase'] {
  const { rowsFactory = () => ({ data: [], error: null }), threadInsertSpy } = opts;

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
      if (table === 'agent_threads') {
        return {
          insert: vi.fn().mockImplementation((row: Record<string, unknown>) => {
            threadInsertSpy?.(row);
            return {
              select: vi.fn().mockReturnValue({
                single: vi.fn().mockResolvedValue({ data: { id: 'thread-1' }, error: null }),
              }),
            };
          }),
        };
      }
      if (table === 'agent_runs') {
        return {
          insert: vi.fn().mockReturnValue({
            select: vi.fn().mockReturnValue({ single: vi.fn().mockResolvedValue({ data: { id: 'run-1' }, error: null }) }),
          }),
        };
      }
      // Entity reads (projects/companies) — a single identity-check spy so
      // AC-ATC-013 can assert only deps.supabase (never a second client) is touched.
      return {
        select: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue(rowsFactory()),
          eq: vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue(rowsFactory()) }),
        }),
      };
    }),
  } as unknown as HandlerDeps['supabase'];
}

function baseDeps(overrides: Partial<HandlerDeps> = {}): HandlerDeps {
  return {
    modelClient: {
      create: vi.fn().mockResolvedValue({
        finish_reason: 'stop',
        message: { role: 'assistant', content: 'Done.' },
        usage: {},
        model: 'deepseek/deepseek-v4-flash',
      }),
    },
    supabase: mockSupabase(),
    userId: 'user-1',
    model: 'deepseek/deepseek-v4-flash',
    now: () => new Date('2026-07-03T00:00:00Z'),
    ...overrides,
  };
}

// ── AC-ATC-012: grounding hint reaches the model's system/context message ────

it('AC-ATC-012 context.entity grounds query_entity read', async () => {
  const create = vi.fn().mockResolvedValue({
    finish_reason: 'stop',
    message: { role: 'assistant', content: 'Summary ready.' },
    usage: {},
    model: 'deepseek/deepseek-v4-flash',
  });

  const req: AgentChatRequest = {
    messages: [{ role: 'user', content: 'summarize this' }],
    context: { route: '/projects/123', entity: { type: 'project', id: '123', label: 'Alpha' } },
  };

  await collect(agentChatHandler(req, baseDeps({ modelClient: { create } })));

  expect(create).toHaveBeenCalledTimes(1);
  const sentMessages = create.mock.calls[0][0].messages as { role: string; content: string }[];
  const systemMsg = sentMessages.find((m) => m.role === 'system');
  expect(systemMsg).toBeDefined();
  expect(systemMsg?.content).toContain('123');
  expect(systemMsg?.content).toMatch(/untrusted/i);
});

// ── Security Lows item 2: buildGroundingHint clamps client strings ───────────

it('SEC-2 oversized entity.label is truncated (not rejected) in the grounding hint', async () => {
  const create = vi.fn().mockResolvedValue({
    finish_reason: 'stop',
    message: { role: 'assistant', content: 'Summary ready.' },
    usage: {},
    model: 'deepseek/deepseek-v4-flash',
  });

  const oversizedLabel = 'A'.repeat(500);

  const req: AgentChatRequest = {
    messages: [{ role: 'user', content: 'summarize this' }],
    context: { route: '/projects/123', entity: { type: 'project', id: '123', label: oversizedLabel } },
  };

  await collect(agentChatHandler(req, baseDeps({ modelClient: { create } })));

  const sentMessages = create.mock.calls[0][0].messages as { role: string; content: string }[];
  const systemMsg = sentMessages.find((m) => m.role === 'system');
  expect(systemMsg).toBeDefined();
  // The 500-char label must not appear whole in the prompt — it's truncated to <=200 chars.
  expect(systemMsg?.content).not.toContain(oversizedLabel);
  // Still grounds the model (truncated label present, request not rejected).
  expect(systemMsg?.content).toContain('A'.repeat(50));
});

// ── AC-ATC-013: forged entity id degrades to a zero-row RLS read ─────────────

it('AC-ATC-013 forged context entity id yields zero rows not elevated access', async () => {
  const create = vi.fn()
    .mockResolvedValueOnce({
      finish_reason: 'tool_calls',
      message: {
        role: 'assistant',
        content: null,
        tool_calls: [
          { id: 'tu1', type: 'function', function: { name: 'query_entity', arguments: JSON.stringify({ entity: 'projects', filter: { column: 'id', op: 'eq', value: 'forged-cross-org-id' } }) } },
        ],
      },
      usage: {},
      model: 'deepseek/deepseek-v4-flash',
    })
    .mockResolvedValueOnce({
      finish_reason: 'stop',
      message: { role: 'assistant', content: 'No matching project found.' },
      usage: {},
      model: 'deepseek/deepseek-v4-flash',
    });

  // The mocked caller-JWT client returns zero rows (RLS-scoped) regardless of the
  // forged id in the filter — this IS the existing runQueryEntity/deps.supabase path.
  const supabase = mockSupabase({ rowsFactory: () => ({ data: [], error: null }) });
  const fromSpy = supabase.from as ReturnType<typeof vi.fn>;

  const req: AgentChatRequest = {
    messages: [{ role: 'user', content: 'find this project' }],
    context: { route: '/projects/forged-cross-org-id', entity: { type: 'project', id: 'forged-cross-org-id', label: 'Unknown' } },
  };

  const events = await collect(agentChatHandler(req, baseDeps({ supabase, modelClient: { create } })));

  const toolEvent = events.find((e) => e.type === 'tool');
  expect(toolEvent).toBeDefined();
  expect((toolEvent!.payload as { result: unknown }).result).toEqual({ rowCount: 0, rows: [] });

  // Identity check: every .from() call went through the SAME caller-JWT client
  // (deps.supabase) — no second/service-role client was introduced.
  expect(fromSpy).toHaveBeenCalled();
  for (const call of fromSpy.mock.calls) {
    expect(['profiles', 'projects', 'companies']).toContain(call[0]);
  }
});

// ── AC-ATC-014/015/016: thread scope write narrowing ──────────────────────────

it('AC-ATC-014 createRun with context.entity populates thread scope', async () => {
  const threadInsertSpy = vi.fn();
  const supabase = mockSupabase({ threadInsertSpy });

  const req: AgentChatRequest = {
    messages: [{ role: 'user', content: 'hello' }],
    context: { route: '/projects/123', entity: { type: 'project', id: '123', label: 'Alpha' } },
  };

  await collect(
    agentChatHandler(
      req,
      baseDeps({
        supabase,
        persistence: { supabase, ownerId: 'user-1', orgId: 'org-1', now: () => new Date('2026-07-03T00:00:00Z') },
      }),
    ),
  );

  expect(threadInsertSpy).toHaveBeenCalledTimes(1);
  const insertedRow = threadInsertSpy.mock.calls[0][0] as { scope?: unknown };
  expect(insertedRow.scope).toEqual({ type: 'project', id: '123', label: 'Alpha' });
});

it('AC-ATC-015 createRun with no entity writes scope null', async () => {
  const threadInsertSpy = vi.fn();
  const supabase = mockSupabase({ threadInsertSpy });

  const req: AgentChatRequest = {
    messages: [{ role: 'user', content: 'hello' }],
  };

  await collect(
    agentChatHandler(
      req,
      baseDeps({
        supabase,
        persistence: { supabase, ownerId: 'user-1', orgId: 'org-1', now: () => new Date('2026-07-03T00:00:00Z') },
      }),
    ),
  );

  expect(threadInsertSpy).toHaveBeenCalledTimes(1);
  const insertedRow = threadInsertSpy.mock.calls[0][0] as { scope?: unknown };
  expect(insertedRow.scope).toBeNull();
});

it('AC-ATC-015b createRun with context present but entity absent writes scope null', async () => {
  const threadInsertSpy = vi.fn();
  const supabase = mockSupabase({ threadInsertSpy });

  const req: AgentChatRequest = {
    messages: [{ role: 'user', content: 'hello' }],
    context: { route: '/dashboard' },
  };

  await collect(
    agentChatHandler(
      req,
      baseDeps({
        supabase,
        persistence: { supabase, ownerId: 'user-1', orgId: 'org-1', now: () => new Date('2026-07-03T00:00:00Z') },
      }),
    ),
  );

  const insertedRow = threadInsertSpy.mock.calls[0][0] as { scope?: unknown };
  expect(insertedRow.scope).toBeNull();
});

it('AC-ATC-016 follow-up context does not overwrite existing scope', async () => {
  const threadInsertSpy = vi.fn();
  const supabase = mockSupabase({ threadInsertSpy });

  // A follow-up (req.runId present) carrying a DIFFERENT context.entity.
  const req: AgentChatRequest = {
    runId: 'existing-run-1',
    messages: [{ role: 'user', content: 'now tell me about Beta' }],
    context: { route: '/projects/456', entity: { type: 'project', id: '456', label: 'Beta' } },
  };

  await collect(
    agentChatHandler(
      req,
      baseDeps({
        supabase,
        persistence: { supabase, ownerId: 'user-1', orgId: 'org-1', now: () => new Date('2026-07-03T00:00:00Z') },
      }),
    ),
  );

  // No agent_threads INSERT (or any scope write) fires on the follow-up branch —
  // only creation writes scope (FR-ATC-018).
  expect(threadInsertSpy).not.toHaveBeenCalled();
});

// ── Security Lows item 2: persisted scope narrowing at write time ────────────

it('SEC-2 oversized entity.label is truncated in the persisted thread scope', async () => {
  const threadInsertSpy = vi.fn();
  const supabase = mockSupabase({ threadInsertSpy });

  const oversizedLabel = 'B'.repeat(500);

  const req: AgentChatRequest = {
    messages: [{ role: 'user', content: 'hello' }],
    context: { route: '/projects/123', entity: { type: 'project', id: '123', label: oversizedLabel } },
  };

  await collect(
    agentChatHandler(
      req,
      baseDeps({
        supabase,
        persistence: { supabase, ownerId: 'user-1', orgId: 'org-1', now: () => new Date('2026-07-03T00:00:00Z') },
      }),
    ),
  );

  const insertedRow = threadInsertSpy.mock.calls[0][0] as { scope?: { label?: string } };
  expect(insertedRow.scope?.label.length).toBeLessThanOrEqual(200);
  expect(insertedRow.scope?.label).not.toBe(oversizedLabel);
});

it('SEC-2 unknown keys on context.entity are stripped from the persisted scope', async () => {
  const threadInsertSpy = vi.fn();
  const supabase = mockSupabase({ threadInsertSpy });

  const req: AgentChatRequest = {
    messages: [{ role: 'user', content: 'hello' }],
    context: {
      route: '/projects/123',
      // Extra keys beyond {type,id,label} — e.g. a forged/bypassed-TS payload.
      entity: { type: 'project', id: '123', label: 'Alpha', evil: 'DROP TABLE', __proto__: { polluted: true } } as unknown as {
        type: string;
        id: string;
        label: string;
      },
    },
  };

  await collect(
    agentChatHandler(
      req,
      baseDeps({
        supabase,
        persistence: { supabase, ownerId: 'user-1', orgId: 'org-1', now: () => new Date('2026-07-03T00:00:00Z') },
      }),
    ),
  );

  const insertedRow = threadInsertSpy.mock.calls[0][0] as { scope?: Record<string, unknown> };
  expect(insertedRow.scope).toEqual({ type: 'project', id: '123', label: 'Alpha' });
  expect(Object.keys(insertedRow.scope ?? {}).sort()).toEqual(['id', 'label', 'type']);
});
