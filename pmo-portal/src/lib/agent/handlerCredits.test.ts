/**
 * Tests for agent-chat's credit-backed RateGuard wiring + unconditional usage recording.
 * AC-AUC-016: a zero-or-negative balance blocks before any modelClient.create() call.
 * AC-AUC-018: a usage row is still inserted even when persistence (ADR-0043 flag) is off.
 */
import { it, expect, vi } from 'vitest';
import { agentChatHandler } from '../../../../supabase/functions/agent-chat/handler';
import type { HandlerDeps } from '../../../../supabase/functions/agent-chat/handler';
import { createCreditRateGuard } from '../../../../supabase/functions/_shared/creditRateGuard';
import type { AgentEvent } from './runtime/port';
import type { AgentChatRequest } from './runtime/transport';

async function collect(it: AsyncIterable<AgentEvent>): Promise<AgentEvent[]> {
  const out: AgentEvent[] = [];
  for await (const e of it) out.push(e);
  return out;
}

const REQ: AgentChatRequest = { messages: [{ role: 'user', content: 'how many active projects?' }] };

/** profiles lookup works; 'credits'/'agent_usage' select path returns the given fixture rows. */
function mockOrgCreditsAndUsage(opts: {
  grants: Array<{ amount: number }>;
  usage: Array<{ cost: number }>;
}): HandlerDeps['supabase'] {
  return {
    from: vi.fn().mockImplementation((table: string) => {
      if (table === 'profiles') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({ data: { org_id: 'org-1', role: 'Engineer' }, error: null }),
            }),
          }),
        };
      }
      if (table === 'credits' || table === 'agent_usage') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              limit: vi.fn().mockResolvedValue(
                table === 'credits' ? { data: opts.grants, error: null } : { data: opts.usage, error: null },
              ),
            }),
          }),
        };
      }
      // All other tables — empty rows (no entity reads exercised in these tests).
      return {
        select: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue({ data: [], error: null }),
          eq: vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue({ data: [], error: null }) }),
        }),
      };
    }),
  } as unknown as HandlerDeps['supabase'];
}

/** profiles lookup works; agent_usage insert routed to insertSpy. */
function mockOrgAndUsageInsert(insertSpy: (row: object) => void): HandlerDeps['supabase'] {
  return {
    from: vi.fn().mockImplementation((table: string) => {
      if (table === 'profiles') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({ data: { org_id: 'org-1', role: 'Engineer' }, error: null }),
            }),
          }),
        };
      }
      if (table === 'agent_usage') {
        return {
          insert: (row: object) => {
            insertSpy(row);
            return { select: () => ({ single: () => Promise.resolve({ data: { id: 'u1' }, error: null }) }) };
          },
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

it('AC-AUC-016 zero-or-negative balance blocks before model call', async () => {
  const create = vi.fn();
  const supabase = mockOrgCreditsAndUsage({ grants: [], usage: [{ cost: 5 }] }); // balance = -5
  const events = await collect(
    agentChatHandler(REQ, {
      modelClient: { create },
      model: 'deepseek/deepseek-v4-flash',
      supabase,
      userId: 'user-1',
      rateGuard: createCreditRateGuard({ supabase }),
      now: () => new Date('2026-07-03T00:00:00Z'),
    }),
  );
  expect(events).toHaveLength(1);
  expect(events[0]).toMatchObject({
    type: 'status',
    payload: { status: 'errored', error: 'RATE_LIMITED', retryAfterSeconds: 0 },
  });
  expect(create).not.toHaveBeenCalled();
});

it('AC-AUC-018 usage recorded independent of persistence flag', async () => {
  const insertSpy = vi.fn();
  const supabase = mockOrgAndUsageInsert(insertSpy);
  const modelClient = {
    create: vi.fn().mockResolvedValue({
      finish_reason: 'stop',
      message: { role: 'assistant', content: 'Done.' },
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15, total_cost: 0.002 },
      model: 'deepseek/deepseek-v4-flash',
    }),
  };
  await collect(
    agentChatHandler(REQ, {
      modelClient,
      model: 'deepseek/deepseek-v4-flash',
      supabase,
      userId: 'user-1',
      usage: { supabase }, // usage dep present
      // persistence: undefined  — deliberately OMITTED (ADR-0043 flag off)
      now: () => new Date('2026-07-03T00:00:00Z'),
    }),
  );
  expect(insertSpy).toHaveBeenCalledWith(
    expect.objectContaining({
      run_id: null,
      model: 'deepseek/deepseek-v4-flash',
      prompt_tokens: 10,
      completion_tokens: 5,
      cost: 0.002,
    }),
  );
});
