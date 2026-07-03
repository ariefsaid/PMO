/**
 * Tests for agent-chat's widget emit path (ADR-0045 §1, DEC-2).
 * AC-ATC-001: valid DataTableWidget passes zod, emits artifact widget.
 * AC-ATC-002: malformed widget never emitted, falls back to assistant text.
 * AC-ATC-017 (unit slice): query_entity with as:'table' emits a data_table widget
 * that passes the SAME WIDGET_PAYLOAD_SCHEMA the client re-validates against.
 */
import { it, expect, vi } from 'vitest';
import { agentChatHandler } from '../../../../supabase/functions/agent-chat/handler';
import type { HandlerDeps } from '../../../../supabase/functions/agent-chat/handler';
import { WIDGET_PAYLOAD_SCHEMA } from './widgets/schema';
import type { AgentEvent } from './runtime/port';
import type { AgentChatRequest } from './runtime/transport';

async function collect(it: AsyncIterable<AgentEvent>): Promise<AgentEvent[]> {
  const out: AgentEvent[] = [];
  for await (const e of it) out.push(e);
  return out;
}

function mockSupabase(rowsFactory: () => { data: unknown[]; error: null }): HandlerDeps['supabase'] {
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
          limit: vi.fn().mockResolvedValue(rowsFactory()),
          eq: vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue(rowsFactory()) }),
        }),
      };
    }),
  } as unknown as HandlerDeps['supabase'];
}

function baseDeps(overrides: Partial<HandlerDeps> = {}): HandlerDeps {
  return {
    modelClient: {
      create: vi.fn().mockResolvedValue({
        finish_reason: 'stop',
        message: { role: 'assistant', content: 'Done.' },
        usage: {},
        model: 'deepseek/deepseek-v4-flash',
      }),
    },
    supabase: mockSupabase(() => ({ data: [], error: null })),
    userId: 'user-1',
    model: 'deepseek/deepseek-v4-flash',
    now: () => new Date('2026-07-03T00:00:00Z'),
    ...overrides,
  };
}

it('AC-ATC-001 query_entity with as:"table" emits a valid DataTableWidget artifact', async () => {
  const create = vi.fn()
    .mockResolvedValueOnce({
      finish_reason: 'tool_calls',
      message: {
        role: 'assistant',
        content: null,
        tool_calls: [
          {
            id: 'tu1',
            type: 'function',
            function: {
              name: 'query_entity',
              arguments: JSON.stringify({ entity: 'projects', columns: ['name', 'status'], as: 'table' }),
            },
          },
        ],
      },
      usage: {},
      model: 'deepseek/deepseek-v4-flash',
    })
    .mockResolvedValueOnce({
      finish_reason: 'stop',
      message: { role: 'assistant', content: 'Here are your over-budget projects.' },
      usage: {},
      model: 'deepseek/deepseek-v4-flash',
    });

  const supabase = mockSupabase(() => ({
    data: [{ name: 'Alpha', status: 'Active' }, { name: 'Beta', status: 'On Hold' }],
    error: null,
  }));

  const req: AgentChatRequest = {
    messages: [{ role: 'user', content: 'show me over-budget projects' }],
  };

  const events = await collect(agentChatHandler(req, baseDeps({ supabase, modelClient: { create } })));

  const artifactEvent = events.find((e) => e.type === 'artifact');
  expect(artifactEvent).toBeDefined();
  const payload = artifactEvent!.payload as { kind?: string; widget?: unknown };
  expect(payload.kind).toBe('widget');

  // Twice-validated boundary (ADR-0039): the SAME schema the client re-validates
  // against must accept the emitted widget.
  const parsed = WIDGET_PAYLOAD_SCHEMA.safeParse(payload.widget);
  expect(parsed.success).toBe(true);
  if (parsed.success && parsed.data.kind === 'data_table') {
    expect(parsed.data.rows).toEqual([{ name: 'Alpha', status: 'Active' }, { name: 'Beta', status: 'On Hold' }]);
    expect(parsed.data.columns.map((c) => c.key)).toEqual(['name', 'status']);
  }

  // A regular tool event is still emitted too (unchanged read-action shape).
  const toolEvent = events.find((e) => e.type === 'tool');
  expect(toolEvent).toBeDefined();
});

it('AC-ATC-002 query_entity WITHOUT as:"table" never emits a widget artifact (existing text path unchanged)', async () => {
  const create = vi.fn()
    .mockResolvedValueOnce({
      finish_reason: 'tool_calls',
      message: {
        role: 'assistant',
        content: null,
        tool_calls: [
          { id: 'tu1', type: 'function', function: { name: 'query_entity', arguments: JSON.stringify({ entity: 'projects' }) } },
        ],
      },
      usage: {},
      model: 'deepseek/deepseek-v4-flash',
    })
    .mockResolvedValueOnce({
      finish_reason: 'stop',
      message: { role: 'assistant', content: 'You have 2 active projects.' },
      usage: {},
      model: 'deepseek/deepseek-v4-flash',
    });

  const supabase = mockSupabase(() => ({ data: [{ id: '1' }, { id: '2' }], error: null }));

  const req: AgentChatRequest = {
    messages: [{ role: 'user', content: 'how many active projects?' }],
  };

  const events = await collect(agentChatHandler(req, baseDeps({ supabase, modelClient: { create } })));

  const artifactEvent = events.find((e) => e.type === 'artifact');
  expect(artifactEvent).toBeUndefined();
});

it('AC-ATC-002 an empty result set with as:"table" falls back — no malformed/empty widget emitted', async () => {
  const create = vi.fn()
    .mockResolvedValueOnce({
      finish_reason: 'tool_calls',
      message: {
        role: 'assistant',
        content: null,
        tool_calls: [
          { id: 'tu1', type: 'function', function: { name: 'query_entity', arguments: JSON.stringify({ entity: 'projects', as: 'table' }) } },
        ],
      },
      usage: {},
      model: 'deepseek/deepseek-v4-flash',
    })
    .mockResolvedValueOnce({
      finish_reason: 'stop',
      message: { role: 'assistant', content: 'No projects found.' },
      usage: {},
      model: 'deepseek/deepseek-v4-flash',
    });

  const supabase = mockSupabase(() => ({ data: [], error: null }));

  const req: AgentChatRequest = {
    messages: [{ role: 'user', content: 'show my projects as a table' }],
  };

  const events = await collect(agentChatHandler(req, baseDeps({ supabase, modelClient: { create } })));

  // Zero rows with no explicit `columns` in the tool call → no columns can be
  // derived (nothing to infer from) — the handler must not emit a malformed
  // widget (empty columns array), it falls back to the text-only path.
  const artifactEvent = events.find((e) => e.type === 'artifact');
  expect(artifactEvent).toBeUndefined();
});
