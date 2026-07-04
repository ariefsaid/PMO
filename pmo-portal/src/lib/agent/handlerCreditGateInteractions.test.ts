/**
 * RED-first regression tests for gpt-5.5 cross-family audit finding 2:
 * "credit gate blocks pending-interaction resolution."
 *
 * Bug: the RateGuard preflight (gate 3, agentChatHandlerInner) runs BEFORE
 * req.decision/req.answer are routed to their resolution branches. An
 * out-of-credits user therefore cannot reject a pending write, nor answer a
 * pending question — the interaction dangles forever (the model can never
 * see the rejection/answer, and the client has no way to un-pause the run).
 *
 * Fix: route req.decision (verdict==='reject' at least) and req.answer
 * resolution BEFORE the credit gate — resolving a pending interaction
 * without triggering a NEW model turn must never be credit-blocked. An
 * approve/answer that DOES trigger a model continuation may still be gated
 * (the continuation's own runToolLoop model call still incurs cost).
 *
 * [REC-1]: handler unit tests live under pmo-portal/src/lib/agent/*.test.ts.
 */
import { it, expect, vi } from 'vitest';
import { agentChatHandler } from '../../../../supabase/functions/agent-chat/handler';
import type { HandlerDeps } from '../../../../supabase/functions/agent-chat/handler';
import { createCreditRateGuard } from '../../../../supabase/functions/_shared/creditRateGuard';
import type { AgentEvent } from './runtime/port';
import type { AgentChatRequest, ConversationMessage } from './runtime/transport';

async function collect(it: AsyncIterable<AgentEvent>): Promise<AgentEvent[]> {
  const out: AgentEvent[] = [];
  for await (const e of it) out.push(e);
  return out;
}

/** profiles lookup works; credits/agent_usage select yields a ZERO (exhausted) balance. */
function mockZeroBalanceSupabase(): HandlerDeps['supabase'] {
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
      if (table === 'credits' || table === 'agent_usage') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              limit: vi.fn().mockResolvedValue(
                table === 'credits' ? { data: [], error: null } : { data: [{ cost: 5 }], error: null },
              ),
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
  const supabase = mockZeroBalanceSupabase();
  return {
    modelClient: { create: vi.fn() },
    supabase,
    userId: 'user-1',
    model: 'deepseek/deepseek-v4-flash',
    now: () => new Date('2026-07-03T00:00:00Z'),
    rateGuard: createCreditRateGuard({ supabase }),
    can: () => true,
    ...overrides,
  };
}

/** The transcript shape PmoNativeRuntime replays: the trailing assistant tool_use for a confirm action. */
function transcriptWithPendingWrite(pendingId: string): ConversationMessage[] {
  return [
    { role: 'user', content: 'log a call on Alpha' },
    {
      role: 'assistant',
      content: [
        {
          type: 'tool_use',
          id: pendingId,
          name: 'create_activity',
          input: { contactId: 'contact-1', kind: 'call', subject: 'Logged the call' },
        },
      ],
    },
  ];
}

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

it('reject succeeds at zero balance — not credit-blocked', async () => {
  const req: AgentChatRequest = {
    runId: 'run-1',
    messages: transcriptWithPendingWrite('p1'),
    decision: { pendingId: 'p1', verdict: 'reject' },
  };

  const events = await collect(agentChatHandler(req, baseDeps()));

  // Must NOT be the generic RATE_LIMITED short-circuit.
  expect(events[0]).not.toMatchObject({ payload: { error: 'RATE_LIMITED' } });

  // A rejection audit event must have fired — the interaction is genuinely resolved,
  // not left dangling.
  const rejected = events.find(
    (e) => e.type === 'system' && (e.payload as { decision?: string } | undefined)?.decision === 'rejected',
  );
  expect(rejected).toBeDefined();
});

it('answering a pending question at zero balance resolves the trailing tool_use — not credit-blocked', async () => {
  const req: AgentChatRequest = {
    runId: 'run-1',
    messages: transcriptWithPendingQuestion('q1'),
    answer: { questionId: 'q1', optionId: 'a' },
  };

  // The post-answer model turn itself would normally trigger a NEW modelClient.create()
  // call — that call is a legitimate credit-gated continuation, so a real deployment MAY
  // still show RATE_LIMITED for it. What must NOT happen is the raw resolution (finding
  // the trailing tool_use + appending the answer tool_result) being skipped/blocked before
  // even reaching the model. We assert the FIRST event is not the bare pre-flight
  // RATE_LIMITED-with-no-context short-circuit that ignores req.answer entirely — i.e. the
  // answer resolution is at least ATTEMPTED (the handler routes through handleAnswer).
  const create = vi.fn().mockResolvedValue({
    finish_reason: 'stop',
    message: { role: 'assistant', content: 'Logged.' },
    usage: {},
    model: 'deepseek/deepseek-v4-flash',
  });

  const events = await collect(agentChatHandler(req, baseDeps({ modelClient: { create } })));

  // The answer resolution itself must reach the model (i.e. create() was actually called
  // with the answer tool_result injected) rather than short-circuiting on RATE_LIMITED
  // before ever routing to handleAnswer.
  expect(create).toHaveBeenCalledTimes(1);
  const sentMessages = create.mock.calls[0][0].messages as {
    role: string;
    tool_call_id?: string;
    content?: unknown;
  }[];
  const answerMsg = sentMessages.find((m) => m.role === 'tool' && m.tool_call_id === 'q1');
  expect(answerMsg).toBeDefined();
});
