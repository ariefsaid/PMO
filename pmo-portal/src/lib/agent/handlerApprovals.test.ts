import { describe, expect, it, vi } from 'vitest';
import {
  AGENT_APPROVAL_MONEY_THRESHOLD,
} from '../../../../supabase/functions/agent-chat/actions';
import {
  agentChatHandler,
  resolveNeedsApproval,
  type HandlerDeps,
} from '../../../../supabase/functions/agent-chat/handler';
import type { AgentAction, AgentEvent } from './runtime/port';
import type { AgentChatRequest } from './runtime/transport';

async function collect(it: AsyncIterable<AgentEvent>): Promise<AgentEvent[]> {
  const out: AgentEvent[] = [];
  for await (const e of it) out.push(e);
  return out;
}

function mockSupabase() {
  const updateEq = vi.fn().mockResolvedValue({ data: null, error: null });
  const update = vi.fn().mockReturnValue({ eq: updateEq });
  const from = vi.fn().mockImplementation((table: string) => {
    if (table === 'profiles') {
      return {
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({
              data: { org_id: 'org-1', role: 'Project Manager' },
              error: null,
            }),
            limit: vi.fn().mockResolvedValue({
              data: [{ org_id: 'org-1', role: 'Project Manager' }],
              error: null,
            }),
          }),
        }),
      };
    }
    if (table === 'tasks') {
      return {
        update,
        select: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue({ data: [], error: null }),
          eq: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue({ data: [], error: null }),
          }),
        }),
      };
    }
    return {
      select: vi.fn().mockReturnValue({
        limit: vi.fn().mockResolvedValue({ data: [], error: null }),
        eq: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue({ data: [], error: null }),
        }),
      }),
    };
  });
  return { supabase: { from } as unknown as HandlerDeps['supabase'], update, updateEq };
}

function baseDeps(overrides: Partial<HandlerDeps> = {}): HandlerDeps {
  const { supabase } = mockSupabase();
  return {
    modelClient: {
      create: vi.fn().mockResolvedValue({
        finish_reason: 'stop',
        message: { role: 'assistant', content: 'Done.' },
        usage: {},
        model: 'deepseek/deepseek-v4-flash',
      }),
    },
    supabase,
    userId: 'user-1',
    model: 'deepseek/deepseek-v4-flash',
    can: vi.fn().mockReturnValue(true),
    now: () => new Date('2026-07-05T00:00:00Z'),
    ...overrides,
  };
}

const REQ: AgentChatRequest = {
  messages: [{ role: 'user', content: 'mark task done' }],
};

describe('conditional approval predicates', () => {
  it('AC-AT2-011 sub-threshold write auto-approves; at/above chips', () => {
    const action: AgentAction = {
      name: 'set_budget',
      description: 'Set a budget value',
      inputSchema: {},
      confirm: true,
      needsApproval: (input) =>
        (input as { amount: number }).amount >= AGENT_APPROVAL_MONEY_THRESHOLD,
      run: vi.fn(),
    };
    const ctx = { jwt: '', userId: 'u1', orgId: 'org-1', supabase: {} } as Parameters<typeof resolveNeedsApproval>[2];

    expect(resolveNeedsApproval(action, { amount: 5_000 }, ctx)).toBe(false);
    expect(resolveNeedsApproval(action, { amount: 20_000 }, ctx)).toBe(true);
  });

  it('AC-AT2-012 destructive delete always chips regardless of args', () => {
    const action: AgentAction = {
      name: 'delete_thing',
      description: 'Delete something',
      inputSchema: {},
      confirm: true,
      needsApproval: () => false,
      run: vi.fn(),
    };
    const ctx = { jwt: '', userId: 'u1', orgId: 'org-1', supabase: {} } as Parameters<typeof resolveNeedsApproval>[2];

    expect(resolveNeedsApproval(action, {}, ctx)).toBe(true);
  });

  it('AC-AT2-013 action with no predicate keeps static behavior', () => {
    const ctx = { jwt: '', userId: 'u1', orgId: 'org-1', supabase: {} } as Parameters<typeof resolveNeedsApproval>[2];
    const staticChip = {
      name: 'create_activity',
      description: 'Create',
      inputSchema: {},
      confirm: true,
      run: vi.fn(),
    } satisfies AgentAction;
    const staticNoChip = {
      name: 'query_entity',
      description: 'Read',
      inputSchema: {},
      confirm: false,
      run: vi.fn(),
    } satisfies AgentAction;

    expect(resolveNeedsApproval(staticChip, {}, ctx)).toBe(true);
    expect(resolveNeedsApproval(staticNoChip, {}, ctx)).toBe(false);
  });

  it('AC-AT2-011 real update_task_status auto-approves with no needs-approval chip', async () => {
    const { supabase, update } = mockSupabase();
    const modelClient = {
      create: vi.fn()
        .mockResolvedValueOnce({
          finish_reason: 'tool_calls',
          message: {
            role: 'assistant',
            content: null,
            tool_calls: [
              {
                id: 'tu-update',
                type: 'function',
                function: {
                  name: 'update_task_status',
                  arguments: JSON.stringify({ taskId: 'task-1', status: 'Done' }),
                },
              },
            ],
          },
          usage: {},
          model: 'deepseek/deepseek-v4-flash',
        })
        .mockResolvedValueOnce({
          finish_reason: 'stop',
          message: { role: 'assistant', content: 'Marked done.' },
          usage: {},
          model: 'deepseek/deepseek-v4-flash',
        }),
    };

    const events = await collect(agentChatHandler(REQ, baseDeps({ modelClient, supabase })));

    expect(events.find((e) => (e.payload as { status?: string })?.status === 'needs-approval')).toBeUndefined();
    expect(events.find((e) => e.type === 'tool')).toMatchObject({
      payload: {
        name: 'update_task_status',
        input: { taskId: 'task-1', status: 'Done' },
        result: { taskId: 'task-1', status: 'Done' },
      },
    });
    expect(update).toHaveBeenCalledWith({ status: 'Done' });
    expect(modelClient.create).toHaveBeenCalledTimes(2);
  });
});
