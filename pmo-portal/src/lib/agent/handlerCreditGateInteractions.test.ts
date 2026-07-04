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
 * RED-2 follow-up (gpt-5.5 red-team audit, HIGH — "out-of-credits users force model
 * calls via decision/answer with no pending item"): the answer test below was updated —
 * before RED-2, the answer-continuation's own model call was UN-GATED entirely (a
 * pre-existing gap noted but deliberately left out of scope by finding 2's original fix).
 * RED-2 closes it: runLoopAfterAnswer (and runLoop) now gate themselves on
 * deps.rateGuard, so the answer-continuation model call correctly shows RATE_LIMITED at
 * zero balance instead of proceeding un-gated. See handlerCreditGateContinuation.test.ts
 * for the full RED-2 coverage (fake/absent pending item, genuine reject, genuine answer).
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

it('answering a pending question at zero balance routes through handleAnswer, but the model continuation is credit-gated (RED-2)', async () => {
  const req: AgentChatRequest = {
    runId: 'run-1',
    messages: transcriptWithPendingQuestion('q1'),
    answer: { questionId: 'q1', optionId: 'a' },
  };

  // Semantics corrected by RED-2 (gpt-5.5 red-team audit, HIGH): the post-answer model
  // turn IS a genuine NEW modelClient.create() call — indistinguishable in cost from a
  // fresh-send turn — so it MUST be credit-gated like any other model call, not exempted
  // just because it happens to follow an answer resolution. Only the pure resolution
  // (finding the trailing tool_use + appending the answer tool_result to the CONSTRUCTED
  // messages, never sent anywhere) is exempt from the gate — it never itself calls the
  // model. The routing goal-oracle stays intact: req.answer must still route through
  // handleAnswer (never short-circuited by the unrelated gate (1)/(2) checks or a bare
  // pre-flight RATE_LIMITED that ignores req.answer's existence) — the RATE_LIMITED
  // terminal status below is emitted FROM WITHIN the answer-continuation path
  // (runLoopAfterAnswer's own gate), not from gate (3)'s fresh-send-only short-circuit.
  const create = vi.fn().mockResolvedValue({
    finish_reason: 'stop',
    message: { role: 'assistant', content: 'Logged.' },
    usage: {},
    model: 'deepseek/deepseek-v4-flash',
  });

  const events = await collect(agentChatHandler(req, baseDeps({ modelClient: { create } })));

  // The continuation model call must NOT happen at zero balance.
  expect(create).not.toHaveBeenCalled();

  // The run still reaches a terminal RATE_LIMITED status — the resolution was genuinely
  // attempted (routed all the way through handleAnswer), not dangling/silently dropped.
  const terminal = events.find(
    (e) => e.type === 'status' && (e.payload as { error?: string } | undefined)?.error === 'RATE_LIMITED',
  );
  expect(terminal).toBeDefined();
});
