/**
 * FR-DH-007 wiring guard — NOT a numbered AC (AC-DH-003 owns the builder-layer proof). This pins
 * that the caller's role (initialRole, derived from profiles in agentChatHandlerInner) reaches the
 * system prompt at ALL THREE construction sites: the fresh-turn path, handleAnswer, and handleDecision.
 * The spec's Contradictions §1 warns that missing any one site silently omits role-grounding from
 * that path; these three tests catch that regression. Harness mirrors handlerAnswerCapabilities.test.ts.
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

function mockSupabase() {
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
    // rateGuard omitted on purpose ⇒ fresh-turn + continuation paths skip the credit gate and
    // proceed to the model (handler.ts:981 `if (deps.rateGuard)`).
    modelClient: {
      create: vi.fn().mockResolvedValue({
        finish_reason: 'stop',
        message: { role: 'assistant', content: 'ok' },
        usage: {},
        model: 'deepseek/deepseek-v4-flash',
      }),
    },
    supabase: mockSupabase(),
    userId: 'user-1',
    model: 'deepseek/deepseek-v4-flash',
    now: () => new Date('2026-07-03T00:00:00Z'),
    can: () => true,
    ...overrides,
  };
}

function transcriptWithPendingQuestion(questionId: string): ConversationMessage[] {
  return [
    { role: 'user', content: 'log a call' },
    { role: 'assistant', content: 'Which project is this for?' },
    {
      role: 'assistant',
      content: [
        { type: 'tool_use', id: questionId, name: 'ask_user',
          input: { prompt: 'Which project?', options: [{ id: 'a', label: 'Alpha' }] } },
      ],
    },
  ];
}

function systemPromptFromFirstCall(create: ReturnType<typeof vi.fn>): string {
  const messages = (create.mock.calls[0][0] as { messages: { role: string; content?: unknown }[] }).messages;
  return String(messages[0].content);
}

it('FR-DH-007 fresh-turn path threads the caller role into the system prompt', async () => {
  const create = vi.fn().mockResolvedValue({
    finish_reason: 'stop', message: { role: 'assistant', content: 'ok' },
    usage: {}, model: 'deepseek/deepseek-v4-flash',
  });
  const req: AgentChatRequest = { runId: 'run-1', messages: [{ role: 'user', content: 'how do I approve a timesheet?' }] };
  await collect(agentChatHandler(req, baseDeps({ modelClient: { create } })));
  expect(systemPromptFromFirstCall(create)).toMatch(/The current user's role is Project Manager/i);
});

it('FR-DH-007 answer-continuation path (handleAnswer) threads the caller role into the system prompt', async () => {
  const create = vi.fn().mockResolvedValue({
    finish_reason: 'stop', message: { role: 'assistant', content: 'ok' },
    usage: {}, model: 'deepseek/deepseek-v4-flash',
  });
  const req: AgentChatRequest = {
    runId: 'run-1',
    messages: transcriptWithPendingQuestion('q1'),
    answer: { questionId: 'q1', optionId: 'a' },
  };
  await collect(agentChatHandler(req, baseDeps({ modelClient: { create } })));
  expect(systemPromptFromFirstCall(create)).toMatch(/The current user's role is Project Manager/i);
});

it('FR-DH-007 decision-continuation path (handleDecision) threads the caller role into the system prompt', async () => {
  // A fabricated pendingId with a transcript that has NO trailing confirm tool_use takes
  // handleDecision's stale/no-op branch (handler.ts `!trailingToolUse`), which still runs the model
  // with the prompt built at handleDecision's own buildAgentSystemPrompt call site — exactly the call
  // site this test pins. reAuthRole is NOT used there (derived later, out of scope at the prompt build).
  const create = vi.fn().mockResolvedValue({
    finish_reason: 'stop', message: { role: 'assistant', content: 'ok' },
    usage: {}, model: 'deepseek/deepseek-v4-flash',
  });
  const req: AgentChatRequest = {
    runId: 'run-1',
    messages: [{ role: 'user', content: 'approve it' }],
    decision: { pendingId: 'stale-pending-id', verdict: 'approve' },
  };
  await collect(agentChatHandler(req, baseDeps({ modelClient: { create } })));
  expect(systemPromptFromFirstCall(create)).toMatch(/The current user's role is Project Manager/i);
});
