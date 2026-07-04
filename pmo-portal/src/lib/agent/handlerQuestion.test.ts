/**
 * Tests for agent-chat's ask-user question resolution branch (ADR-0045 §2).
 * AC-ATC-009: answer resolves same run, no new createRun.
 * AC-ATC-010: duplicate answer is idempotent no-op.
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

/** Build a mock SupabaseLike resolving the profiles lookup only (no entity reads needed here). */
function mockSupabase(): HandlerDeps['supabase'] {
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
      return {
        select: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue({ data: [], error: null }),
          eq: vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue({ data: [], error: null }) }),
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
        message: { role: 'assistant', content: 'Got it — thanks!' },
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

/** The transcript shape PmoNativeRuntime replays: the trailing assistant tool_use for ask_user. */
function transcriptWithPendingQuestion(questionId: string): ConversationMessage[] {
  return [
    { role: 'user', content: 'log a call' },
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

it('AC-ATC-009 answer resolves same run, no new createRun', async () => {
  const create = vi.fn().mockResolvedValue({
    finish_reason: 'stop',
    message: { role: 'assistant', content: 'Logging the call on Alpha.' },
    usage: {},
    model: 'deepseek/deepseek-v4-flash',
  });

  const req: AgentChatRequest = {
    runId: 'run-1',
    messages: transcriptWithPendingQuestion('q1'),
    answer: { questionId: 'q1', optionId: 'a' },
  };

  const events = await collect(agentChatHandler(req, baseDeps({ modelClient: { create } })));

  expect(events.length).toBeGreaterThan(0);
  for (const ev of events) {
    expect(ev.runId).toBe('run-1');
  }
  // The stale replayed user turn ("log a call") must NOT be re-echoed as a fresh
  // user event — an answer resolution continues the SAME pending request, it is
  // not a new user turn (mirrors handleDecision, which also doesn't re-echo).
  const userEvents = events.filter((e) => e.type === 'user');
  expect(userEvents).toHaveLength(0);
  expect(events.at(-1)).toMatchObject({ type: 'status', payload: { status: 'completed' } });
  expect(create).toHaveBeenCalledTimes(1);

  // The answer content (the chosen option's label) must reach the model as the
  // tool_result resolving the ask_user tool_use, correlated by questionId/toolId.
  const sentMessages = create.mock.calls[0][0].messages as {
    role: string;
    tool_call_id?: string;
    content?: unknown;
  }[];
  const answerMsg = sentMessages.find((m) => m.role === 'tool' && m.tool_call_id === 'q1');
  expect(answerMsg).toBeDefined();
  expect(String(answerMsg?.content)).toMatch(/Alpha/);
});

it('AC-ATC-010 duplicate answer is idempotent no-op', async () => {
  const create = vi.fn().mockResolvedValue({
    finish_reason: 'stop',
    message: { role: 'assistant', content: 'Already handled.' },
    usage: {},
    model: 'deepseek/deepseek-v4-flash',
  });

  // Transcript already carries a resolution (tool_result) for q1's tool_use.
  const messages: ConversationMessage[] = [
    ...transcriptWithPendingQuestion('q1'),
    {
      role: 'user',
      content: [{ type: 'tool_result', tool_use_id: 'q1', content: 'Alpha' }],
    },
  ];

  const req: AgentChatRequest = {
    runId: 'run-1',
    messages,
    answer: { questionId: 'q1', optionId: 'a' },
  };

  const events = await collect(agentChatHandler(req, baseDeps({ modelClient: { create } })));

  expect(create).toHaveBeenCalledTimes(1);
  // No duplicate answer/tool_result content appended — the continuation simply runs the model once.
  expect(events.at(-1)).toMatchObject({ type: 'status', payload: { status: 'completed' } });

  // AC-ATC-010 idempotency (mirrors AC-AW-003's established convention: a stale/
  // duplicate re-POST finds no trailing UNRESOLVED tool_use, so the handler injects
  // nothing new — it never re-derives or re-appends a second answer for q1).
  const sentMessages = create.mock.calls[0][0].messages as { role: string; tool_call_id?: string }[];
  const answerMsgs = sentMessages.filter((m) => m.role === 'tool' && m.tool_call_id === 'q1');
  expect(answerMsgs).toHaveLength(0);
});
