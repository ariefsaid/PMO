/**
 * Tests for grounding-hint consistency across ALL agent-chat continuation paths
 * (DEC-5, Track C of docs/plans/2026-07-05-agent-experience-layer.md).
 *
 * The initial-run build site (handler.ts ~:1001) already appends
 * `buildGroundingHint(req.context?.entity)` to the system prompt. The two
 * continuation paths — `handleAnswer` (~:1077) and `handleDecision` (~:1146) —
 * build the SAME system prompt but were missing the hint append, so a follow-up
 * turn silently lost the live-context grounding a user had on the initial turn.
 *
 * AC-AXP-017: grounding hint on continuation turns (answer path + decision path).
 * FR-AXP-023 / AC-ATC-013 (unchanged): a forged context.entity.id degrades to a
 * zero-row RLS read under the caller JWT — the hint is grounding-only, never an
 * authorization signal (NFR-AXP-SEC-003).
 *
 * [REC-1]: handler unit tests live under pmo-portal/src/lib/agent/*.test.ts (no Vitest
 * project rooted in supabase/), importing the handler via relative path.
 */
import { it, expect, vi } from 'vitest';
import { agentChatHandler } from '../../../../supabase/functions/agent-chat/handler';
import type { HandlerDeps } from '../../../../supabase/functions/agent-chat/handler';
import type { AgentEvent } from './runtime/port';
import type { AgentChatRequest, ConversationMessage } from './runtime/transport';

async function collect(it: AsyncIterable<AgentEvent>): Promise<AgentEvent[]> {
  const out: AgentEvent[] = [];
  for await (const e of it) out.push(e);
  return out;
}

/**
 * Mock HandlerSupabaseLike that resolves the profiles lookup and a configurable
 * query_entity read (rowsFactory) — mirrors handlerContext.test.ts's helper.
 */
function mockSupabase(opts: {
  rowsFactory?: () => { data: unknown[]; error: null };
} = {}): HandlerDeps['supabase'] {
  const { rowsFactory = () => ({ data: [], error: null }) } = opts;

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
      // Entity reads (projects/companies) — a single identity-check spy so the
      // forged-id sub-case can assert only deps.supabase (never a second client) is touched.
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
    now: () => new Date('2026-07-05T00:00:00Z'),
    ...overrides,
  };
}

/** The transcript shape PmoNativeRuntime replays: a trailing unresolved ask_user tool_use. */
function transcriptWithPendingQuestion(questionId: string): ConversationMessage[] {
  return [
    { role: 'user', content: 'summarize this' },
    { role: 'assistant', content: 'Which project is this for?' },
    {
      role: 'assistant',
      content: [
        {
          type: 'tool_use',
          id: questionId,
          name: 'ask_user',
          input: { prompt: 'Which project is this for?', options: [{ id: 'a', label: 'Alpha' }] },
        },
      ],
    },
  ];
}

// ── AC-AXP-017 (answer continuation): handleAnswer's system prompt carries the hint ──

it('AC-AXP-017 grounding hint on continuation turns (answer path)', async () => {
  const create = vi.fn().mockResolvedValue({
    finish_reason: 'stop',
    message: { role: 'assistant', content: 'Logging on Alpha.' },
    usage: {},
    model: 'deepseek/deepseek-v4-flash',
  });

  const req: AgentChatRequest = {
    runId: 'run-1',
    messages: transcriptWithPendingQuestion('q1'),
    answer: { questionId: 'q1', optionId: 'a' },
    context: { route: '/projects/p-123', entity: { type: 'project', id: 'p-123', label: 'Alpha' } },
  };

  await collect(agentChatHandler(req, baseDeps({ modelClient: { create } })));

  expect(create).toHaveBeenCalledTimes(1);
  const sentMessages = create.mock.calls[0][0].messages as { role: string; content: string }[];
  const systemMsg = sentMessages.find((m) => m.role === 'system');
  expect(systemMsg).toBeDefined();
  expect(systemMsg?.content).toContain('p-123');
  expect(systemMsg?.content).toContain('Alpha');
  expect(systemMsg?.content).toMatch(/untrusted/i);
});

// ── AC-AXP-017 (decision continuation): handleDecision's system prompt carries the hint ──

it('AC-AXP-017 grounding hint on continuation turns (decision path)', async () => {
  const validArgs = { contactId: 'c1', kind: 'call', subject: 'Follow-up' };
  const toolId = 'tool-use-id-1';

  const create = vi.fn().mockResolvedValue({
    finish_reason: 'stop',
    message: { role: 'assistant', content: 'Done — logged.' },
    usage: {},
    model: 'deepseek/deepseek-v4-flash',
  });

  const req: AgentChatRequest = {
    runId: 'run-2',
    messages: [
      { role: 'user', content: 'log a call' },
      {
        role: 'assistant',
        content: [
          { type: 'tool_use', id: toolId, name: 'create_activity', input: validArgs },
        ],
      },
    ],
    decision: { pendingId: 'pending-1', verdict: 'reject' },
    context: { route: '/projects/p-123', entity: { type: 'project', id: 'p-123', label: 'Alpha' } },
  };

  await collect(agentChatHandler(req, baseDeps({ modelClient: { create } })));

  expect(create).toHaveBeenCalled();
  const sentMessages = create.mock.calls[0][0].messages as { role: string; content: string }[];
  const systemMsg = sentMessages.find((m) => m.role === 'system');
  expect(systemMsg).toBeDefined();
  expect(systemMsg?.content).toContain('p-123');
  expect(systemMsg?.content).toContain('Alpha');
  expect(systemMsg?.content).toMatch(/untrusted/i);
});

// ── FR-AXP-023 / AC-ATC-013 unchanged: forged entity id degrades to zero-row RLS read ──

it('FR-AXP-023 AC-ATC-013 forged context entity id on a continuation turn still yields zero rows, not elevated access', async () => {
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
  // forged id in the filter/hint — this IS the existing runQueryEntity/deps.supabase path.
  const supabase = mockSupabase({ rowsFactory: () => ({ data: [], error: null }) });
  const fromSpy = supabase.from as ReturnType<typeof vi.fn>;

  const req: AgentChatRequest = {
    runId: 'run-3',
    messages: transcriptWithPendingQuestion('q2'),
    answer: { questionId: 'q2', optionId: 'a' },
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
