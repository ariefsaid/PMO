/**
 * Quality-gate tests on hand-shaped deepseek/deepseek-v4-flash-realistic fixtures
 * (MC-OD-008 — fixture provenance: hand-shaped to the OpenRouter/OpenAI schema;
 * not yet cross-checked against a live deepseek-v4-flash call — see this plan's
 * (docs/plans/2026-07-03-agent-model-client.md) §5 verification notes for live-run
 * status, recorded by the Director/Task 21).
 *
 * AC-MC-020: read-tool answer quality, deterministic fixture.
 * AC-MC-021: write-tool call correctness, approve-gated, deterministic fixture.
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

it('AC-MC-021 write-tool call correctness: update_task_status, approve-gated, deepseek-shaped fixture', async () => {
  const create = vi.fn().mockResolvedValueOnce({
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
  });

  const req: AgentChatRequest = { messages: [{ role: 'user', content: 'mark task-1 as done' }] };
  const events = await collect(agentChatHandler(req, {
    modelClient: { create },
    supabase: mockOrgSupabase([]),
    userId: 'user-1',
    model: 'deepseek/deepseek-v4-flash',
    can: vi.fn().mockReturnValue(true),
  }));

  const needsApproval = events.find((e) => e.type === 'status' && (e.payload as { status?: string })?.status === 'needs-approval');
  expect(needsApproval).toBeDefined();
  expect((needsApproval!.payload as { actionName: string }).actionName).toBe('update_task_status');
  expect((needsApproval!.payload as { humanSummary: string }).humanSummary).toContain('task-1');
  expect((needsApproval!.payload as { structuredArgs: { status: string } }).structuredArgs.status).toBe('Done');
  expect(events.find((e) => e.type === 'tool')).toBeUndefined(); // no write dispatched pre-approval
});
