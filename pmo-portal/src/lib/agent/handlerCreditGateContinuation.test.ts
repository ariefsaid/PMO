/**
 * RED-first regression tests for gpt-5.5 red-team audit RED-2 (HIGH):
 * "out-of-credits users force model calls via decision/answer with no pending item."
 *
 * Bug: req.decision/req.answer route BEFORE the credit gate (correctness-remediation
 * finding 2, handlerCreditGateInteractions.test.ts) — correct, because a pure resolution
 * write (the write_resolved audit event / the answer's tool_result append) never itself
 * costs a model call and must never be credit-blocked. BUT if no trailing unresolved
 * pending tool_use/question exists (a fake, stale, or absent decision/answer), the
 * decision/answer handlers still fall through into runLoop/runLoopAfterAnswer, which make
 * an UN-GATED model call regardless of deps.rateGuard — a zero-credit user can send a
 * fabricated decision/answer and get free model spend with no real pending item to
 * resolve at all.
 *
 * Fix: any continuation that WILL make a model call (runLoop / runLoopAfterAnswer) is
 * gated on deps.rateGuard first — only the pure resolution write (a real pending item's
 * tool_result/write_resolved append, with no subsequent model turn) is exempt. This is a
 * single gate point common to all three call shapes: the stale/absent-pending no-op, the
 * genuine-reject continuation, and the genuine-answer continuation.
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

it('RED-2 zero-balance user with a FAKE/absent pending decision gets no model call — terminal no-op', async () => {
  const create = vi.fn();
  const req: AgentChatRequest = {
    runId: 'run-1',
    // No trailing unresolved tool_use — there is nothing real to resolve.
    messages: [{ role: 'user', content: 'log a call' }],
    decision: { pendingId: 'fake-pending-id', verdict: 'approve' },
  };

  const events = await collect(agentChatHandler(req, baseDeps({ modelClient: { create } })));

  expect(create).not.toHaveBeenCalled();
  // A terminal status must still fire (no dangling run) — RATE_LIMITED is the terminal
  // no-op shape credit-gating already uses elsewhere (gate 3's fresh-send path).
  const terminal = events.find((e) => e.type === 'status');
  expect(terminal).toBeDefined();
  expect((terminal?.payload as { status?: string })?.status).toBe('errored');
  expect((terminal?.payload as { error?: string })?.error).toBe('RATE_LIMITED');
});

it('RED-2 zero-balance user with a FAKE/absent pending answer gets no model call — terminal no-op', async () => {
  const create = vi.fn();
  const req: AgentChatRequest = {
    runId: 'run-1',
    // No trailing unresolved ask_user tool_use — nothing real to resolve.
    messages: [{ role: 'user', content: 'log a call' }],
    answer: { questionId: 'fake-question-id', optionId: 'a' },
  };

  const events = await collect(agentChatHandler(req, baseDeps({ modelClient: { create } })));

  expect(create).not.toHaveBeenCalled();
  const terminal = events.find((e) => e.type === 'status');
  expect(terminal).toBeDefined();
  expect((terminal?.payload as { error?: string })?.error).toBe('RATE_LIMITED');
});

it('RED-2 zero-balance genuine reject of a real pending write still resolves (no model call needed)', async () => {
  const create = vi.fn();
  const req: AgentChatRequest = {
    runId: 'run-1',
    messages: transcriptWithPendingWrite('p1'),
    decision: { pendingId: 'p1', verdict: 'reject' },
  };

  const events = await collect(agentChatHandler(req, baseDeps({ modelClient: { create } })));

  // The rejection resolution itself must have fired — a real pending write DID get
  // resolved even though the run is out of credits.
  const rejected = events.find(
    (e) => e.type === 'system' && (e.payload as { decision?: string } | undefined)?.decision === 'rejected',
  );
  expect(rejected).toBeDefined();

  // The model continuation (letting the model acknowledge the rejection) is a genuine
  // NEW model call and is correctly credit-gated at zero balance — it must not happen.
  expect(create).not.toHaveBeenCalled();
});

it('RED-2 zero-balance genuine answer of a real pending question is credit-gated (RATE_LIMITED, no model call)', async () => {
  const create = vi.fn();
  const req: AgentChatRequest = {
    runId: 'run-1',
    messages: transcriptWithPendingQuestion('q1'),
    answer: { questionId: 'q1', optionId: 'a' },
  };

  const events = await collect(agentChatHandler(req, baseDeps({ modelClient: { create } })));

  // The answer-continuation IS a genuine new model call (the model must acknowledge the
  // answer) — correctly credit-gated at zero balance.
  expect(create).not.toHaveBeenCalled();
  const terminal = events.find(
    (e) => e.type === 'status' && (e.payload as { error?: string })?.error === 'RATE_LIMITED',
  );
  expect(terminal).toBeDefined();
});

it('RED-2 genuine reject of a real pending write still resolves at a NON-zero balance too (no rateGuard regression)', async () => {
  // Sanity: without a rateGuard configured at all, behavior is entirely unaffected —
  // reject resolves and the model continuation runs normally (pre-existing behavior).
  const create = vi.fn().mockResolvedValue({
    finish_reason: 'stop',
    message: { role: 'assistant', content: 'Okay, cancelled.' },
    usage: {},
    model: 'deepseek/deepseek-v4-flash',
  });
  const req: AgentChatRequest = {
    runId: 'run-1',
    messages: transcriptWithPendingWrite('p1'),
    decision: { pendingId: 'p1', verdict: 'reject' },
  };

  const events = await collect(
    agentChatHandler(req, baseDeps({ modelClient: { create }, rateGuard: undefined })),
  );

  const rejected = events.find(
    (e) => e.type === 'system' && (e.payload as { decision?: string } | undefined)?.decision === 'rejected',
  );
  expect(rejected).toBeDefined();
  expect(create).toHaveBeenCalledTimes(1);
});
