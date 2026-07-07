/**
 * AC-USE-002 (ops-admin-surface S5, FR-USE-001): agentChatHandler threads deps.usageAction
 * through to the agent_usage insert. The interactive path (agent-chat/index.ts) defaults to
 * 'chat' (unchanged); the agent-dispatch fired-run path sets deps.usageAction = 'automation'
 * so the fired run's usage rows are distinguishable in the aggregate view from an interactive turn.
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

const REQ: AgentChatRequest = { messages: [{ role: 'user', content: 'summarize my overdue tasks' }] };

function mockUsageSupabase(insertSpy: (row: object) => void): HandlerDeps['supabase'] {
  return {
    from: vi.fn().mockImplementation(() => ({
      insert: (row: object) => {
        insertSpy(row);
        return { select: () => ({ single: () => Promise.resolve({ data: { id: 'u1' }, error: null }) }) };
      },
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({ data: { org_id: 'org-1', role: 'Engineer' }, error: null }),
        }),
      }),
    })),
  } as unknown as HandlerDeps['supabase'];
}

it("AC-USE-002 agentChatHandler records action='automation' when deps.usageAction is set (the fired-run path)", async () => {
  const insertSpy = vi.fn();
  const supabase = mockUsageSupabase(insertSpy);
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
      usage: { supabase },
      usageAction: 'automation',
      now: () => new Date('2026-07-05T00:00:00Z'),
    }),
  );
  expect(insertSpy).toHaveBeenCalledWith(expect.objectContaining({ action: 'automation' }));
});

it("AC-USE-002 agentChatHandler defaults to action='chat' when deps.usageAction is omitted (interactive path unchanged)", async () => {
  const insertSpy = vi.fn();
  const supabase = mockUsageSupabase(insertSpy);
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
      usage: { supabase },
      now: () => new Date('2026-07-05T00:00:00Z'),
    }),
  );
  expect(insertSpy).toHaveBeenCalledWith(expect.objectContaining({ action: 'chat' }));
});
