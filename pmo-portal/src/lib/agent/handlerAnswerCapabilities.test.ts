/**
 * RED-first regression tests for gpt-5.5 cross-family audit finding 1:
 * "answer-continuation loses capabilities."
 *
 * Bug: handleAnswer's continuation ran through runLoop, which hardcodes
 * allowCompose:false + allowProposeConfirm:false — the SAME restricted shape
 * used by handleDecision's continuation (which is legitimately terminal: a
 * decision resolves a write, it must not immediately propose a SECOND write).
 * An answer, however, RESUMES the user's original request (ADR-0045 §2) — the
 * model should regain full main-loop capabilities once the question is
 * answered, so it can propose a confirm-action (needs-approval) or emit a
 * compose_view artifact in the SAME turn.
 *
 * [REC-1]: handler unit tests live under pmo-portal/src/lib/agent/*.test.ts.
 */
import { it, expect, vi } from 'vitest';

// Mirrors agentChatHandler.compose.test.ts's harness: mock runComposeView at the actions
// module level so this test exercises the handler's compose_view DISPATCH branch (was it
// reachable at all in the answer-continuation pass?) without depending on the real
// composeSpec/repair-loop logic, which is out of scope for this regression test.
vi.mock('../../../../supabase/functions/agent-chat/actions', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../supabase/functions/agent-chat/actions')>();
  return {
    ...actual,
    runComposeView: vi.fn(),
  };
});

import { agentChatHandler } from '../../../../supabase/functions/agent-chat/handler';
import type { HandlerDeps } from '../../../../supabase/functions/agent-chat/handler';
import { runComposeView as mockRunComposeView } from '../../../../supabase/functions/agent-chat/actions';
import type { AgentEvent } from './runtime/port';
import type { AgentChatRequest, ConversationMessage } from './runtime/transport';
import type { CompositionSpec } from '../viewspec/types';

const VALID_SPEC: CompositionSpec = {
  version: 1,
  panels: [
    {
      id: 'p1',
      primitive: 'KPITile',
      querySpec: {
        entity: 'projects',
        select: ['id'],
        aggregate: { fn: 'count', column: 'id', alias: 'count' },
      },
    },
  ],
};

async function collect(it: AsyncIterable<AgentEvent>): Promise<AgentEvent[]> {
  const out: AgentEvent[] = [];
  for await (const e of it) out.push(e);
  return out;
}

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
    modelClient: { create: vi.fn() },
    supabase: mockSupabase(),
    userId: 'user-1',
    model: 'deepseek/deepseek-v4-flash',
    now: () => new Date('2026-07-03T00:00:00Z'),
    can: () => true,
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

it('after an answer, the model may propose a confirm action (needs-approval), not "not available in this context"', async () => {
  // The model responds to the answer's tool_result by immediately calling create_activity —
  // a confirm:true action. Before the fix, the answer-continuation ran with
  // allowProposeConfirm:false, so this would be rejected as "action 'create_activity' not
  // available in this context" instead of pausing for approval.
  const create = vi.fn().mockResolvedValue({
    finish_reason: 'tool_calls',
    message: {
      role: 'assistant',
      content: null,
      tool_calls: [
        {
          id: 'call-1',
          type: 'function',
          function: {
            name: 'create_activity',
            arguments: JSON.stringify({
              contactId: 'contact-1',
              kind: 'call',
              subject: 'Logged the call on Alpha',
            }),
          },
        },
      ],
    },
    usage: {},
    model: 'deepseek/deepseek-v4-flash',
  });

  const req: AgentChatRequest = {
    runId: 'run-1',
    messages: transcriptWithPendingQuestion('q1'),
    answer: { questionId: 'q1', optionId: 'a' },
  };

  const events = await collect(agentChatHandler(req, baseDeps({ modelClient: { create } })));

  const statusEvents = events.filter((e) => e.type === 'status');
  const needsApproval = statusEvents.find(
    (e) => (e.payload as { status?: string } | undefined)?.status === 'needs-approval',
  );
  expect(needsApproval).toBeDefined();
  expect((needsApproval?.payload as { actionName?: string } | undefined)?.actionName).toBe('create_activity');

  // Must NOT have fallen through the "not available in this context" branch — that would
  // show up as a role:'tool' error result appended to the sent messages, never as a
  // needs-approval status event.
  const toolResultMessages = create.mock.calls[0][0].messages as { role: string; content?: unknown }[];
  const unavailableMsg = toolResultMessages.find(
    (m) => m.role === 'tool' && typeof m.content === 'string' && m.content.includes('not available in this context'),
  );
  expect(unavailableMsg).toBeUndefined();
});

it('after an answer, the model may emit a compose_view artifact', async () => {
  const create = vi.fn().mockResolvedValue({
    finish_reason: 'tool_calls',
    message: {
      role: 'assistant',
      content: null,
      tool_calls: [
        {
          id: 'call-1',
          type: 'function',
          function: {
            name: 'compose_view',
            arguments: JSON.stringify({ prompt: 'show Alpha budget' }),
          },
        },
      ],
    },
    usage: {},
    model: 'deepseek/deepseek-v4-flash',
  });

  vi.mocked(mockRunComposeView).mockResolvedValueOnce({
    spec: VALID_SPEC,
    repairAttempts: 0,
    tokensUsed: 120,
    title: 'Alpha budget',
  });

  const req: AgentChatRequest = {
    runId: 'run-1',
    messages: transcriptWithPendingQuestion('q1'),
    answer: { questionId: 'q1', optionId: 'a' },
  };

  const events = await collect(
    agentChatHandler(req, baseDeps({ modelClient: { create }, composeEnabled: true })),
  );

  // Before the fix, compose_view was never registered as a tool in the answer-continuation
  // pass (allowCompose:false), so the model could never even attempt to call it in a way the
  // handler would dispatch as compose_view — it would fall into the unknown-action branch.
  const artifactEvent = events.find((e) => e.type === 'artifact');
  expect(artifactEvent).toBeDefined();
  expect((artifactEvent?.payload as { kind?: string } | undefined)?.kind).toBe('compose_view');
});
