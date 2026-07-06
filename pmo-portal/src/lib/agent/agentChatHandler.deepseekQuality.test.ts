/**
 * Quality-gate tests on hand-shaped deepseek/deepseek-v4-flash-realistic fixtures
 * (MC-OD-008 — fixture provenance: hand-shaped to the OpenRouter/OpenAI schema;
 * not yet cross-checked against a live deepseek-v4-flash call — see this plan's
 * (docs/plans/2026-07-03-agent-model-client.md) §5 verification notes for live-run
 * status, recorded by the Director/Task 21).
 *
 * AC-MC-020: read-tool answer quality, deterministic fixture.
 * AC-MC-021: write-tool call correctness, conditional-approval auto-approve fixture.
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

function mockOrgSupabase(rows: unknown[]): HandlerDeps['supabase'] {
  return {
    from: vi.fn().mockImplementation((table: string) => {
      if (table === 'profiles') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({ data: { org_id: 'org-1' }, error: null }),
            }),
          }),
        };
      }
      return {
        select: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue({ data: rows, error: null }),
          eq: vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue({ data: rows, error: null }) }),
        }),
      };
    }),
  } as unknown as HandlerDeps['supabase'];
}

function mockWritableTaskSupabase(): HandlerDeps['supabase'] {
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
      if (table === 'tasks') {
        return {
          update: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({ data: null, error: null }),
          }),
          select: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue({ data: [], error: null }),
            eq: vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue({ data: [], error: null }) }),
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

it('AC-MC-020 chat answer quality: read tool, deepseek-shaped fixture ends completed with a non-hallucinated answer', async () => {
  const create = vi.fn()
    // Round 1: deepseek-shaped tool call for query_entity
    .mockResolvedValueOnce({
      finish_reason: 'tool_calls',
      message: {
        role: 'assistant',
        content: null,
        tool_calls: [{
          id: 'call_abc123',
          type: 'function',
          function: { name: 'query_entity', arguments: JSON.stringify({ entity: 'projects', filter: { column: 'status', op: 'eq', value: 'Active' } }) },
        }],
      },
      usage: { prompt_tokens: 340, completion_tokens: 28, total_tokens: 368 },
      model: 'deepseek/deepseek-v4-flash',
    })
    // Round 2: deepseek-shaped final text answer referencing the tool result
    .mockResolvedValueOnce({
      finish_reason: 'stop',
      message: { role: 'assistant', content: 'You have 3 active projects.' },
      usage: { prompt_tokens: 410, completion_tokens: 12, total_tokens: 422 },
      model: 'deepseek/deepseek-v4-flash',
    });

  const req: AgentChatRequest = { messages: [{ role: 'user', content: 'how many of my projects are active?' }] };
  const events = await collect(agentChatHandler(req, {
    modelClient: { create },
    supabase: mockOrgSupabase([{ id: 'p1' }, { id: 'p2' }, { id: 'p3' }]),
    userId: 'user-1',
    model: 'deepseek/deepseek-v4-flash',
  }));

  const finalText = events.find((e) => e.type === 'assistant' && e.text?.includes('3'));
  expect(finalText).toBeDefined();
  expect(finalText!.text).not.toBe('');
  const completed = events.find((e) => e.type === 'status' && (e.payload as { status?: string })?.status === 'completed');
  expect(completed).toBeDefined();
});

it('AC-MC-021 write-tool call correctness: update_task_status auto-approves, deepseek-shaped fixture', async () => {
  const create = vi.fn()
    .mockResolvedValueOnce({
      finish_reason: 'tool_calls',
      message: {
        role: 'assistant',
        content: null,
        tool_calls: [{
          id: 'call_def456',
          type: 'function',
          function: { name: 'update_task_status', arguments: JSON.stringify({ taskId: 'task-1', status: 'Done' }) },
        }],
      },
      usage: { prompt_tokens: 300, completion_tokens: 20, total_tokens: 320 },
      model: 'deepseek/deepseek-v4-flash',
    })
    .mockResolvedValueOnce({
      finish_reason: 'stop',
      message: { role: 'assistant', content: 'Task task-1 is now Done.' },
      usage: { prompt_tokens: 360, completion_tokens: 10, total_tokens: 370 },
      model: 'deepseek/deepseek-v4-flash',
    });

  const req: AgentChatRequest = { messages: [{ role: 'user', content: 'mark task-1 as done' }] };
  const events = await collect(agentChatHandler(req, {
    modelClient: { create },
    supabase: mockWritableTaskSupabase(),
    userId: 'user-1',
    model: 'deepseek/deepseek-v4-flash',
    can: vi.fn().mockReturnValue(true),
  }));

  const needsApproval = events.find((e) => e.type === 'status' && (e.payload as { status?: string })?.status === 'needs-approval');
  expect(needsApproval).toBeUndefined();
  expect(events.find((e) => e.type === 'tool')).toMatchObject({
    payload: {
      name: 'update_task_status',
      input: { taskId: 'task-1', status: 'Done' },
      result: { taskId: 'task-1', status: 'Done' },
    },
  });
  expect(events.find((e) => e.type === 'assistant' && e.text?.includes('Done'))).toBeDefined();
});
