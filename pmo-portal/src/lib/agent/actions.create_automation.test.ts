/**
 * actions.create_automation.test.ts — the `create_automation` AgentAction (ADR-0044 §1,
 * FR-AAN-029/030/031).
 *
 * AC-AAN-030: validate mirrors the kind-conditional DB constraint (defense-in-depth).
 * AC-AAN-028: confirm:true — a valid proposal through the handler emits needs-approval, writes
 *   no row (approve-chip flow, identical shape to create_activity's).
 * AC-AAN-029: approving inserts the row via the caller-JWT client (never service_role), owned by
 *   the caller (no explicit owner_id sent).
 */
import { describe, it, expect, vi } from 'vitest';
import { createAutomationAction } from '../../../../supabase/functions/agent-chat/actions';
import { agentChatHandler } from '../../../../supabase/functions/agent-chat/handler';
import type { HandlerDeps } from '../../../../supabase/functions/agent-chat/handler';
import type { AgentEvent } from './runtime/port';
import type { AgentChatRequest } from './runtime/transport';

async function collect(it: AsyncIterable<AgentEvent>): Promise<AgentEvent[]> {
  const out: AgentEvent[] = [];
  for await (const e of it) out.push(e);
  return out;
}

function mockSupabase(opts: {
  profileData?: { org_id: string; role: string } | null;
  insertResult?: { data: unknown; error: unknown };
} = {}): HandlerDeps['supabase'] {
  const {
    profileData = { org_id: 'org-1', role: 'Project Manager' },
    insertResult = { data: { id: 'auto-1' }, error: null },
  } = opts;

  return {
    from: vi.fn().mockImplementation((table: string) => {
      if (table === 'profiles') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({ data: profileData, error: null }),
              limit: vi.fn().mockResolvedValue({ data: profileData ? [profileData] : [], error: null }),
            }),
          }),
        };
      }
      if (table === 'agent_automations') {
        return {
          insert: vi.fn().mockReturnValue({
            select: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue(insertResult),
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
    modelClient: {
      create: vi.fn().mockResolvedValue({
        finish_reason: 'stop',
        message: { role: 'assistant', content: 'All done.' },
        usage: {},
        model: 'deepseek/deepseek-v4-flash',
      }),
    },
    supabase: mockSupabase(),
    userId: 'user-1',
    model: 'deepseek/deepseek-v4-flash',
    can: vi.fn().mockReturnValue(true),
    now: () => new Date('2026-07-03T00:00:00Z'),
    ...overrides,
  };
}

describe('createAutomationAction.validate (AC-AAN-030)', () => {
  it('rejects kind=schedule with no schedule field', () => {
    const result = createAutomationAction.validate({ kind: 'schedule', prompt: 'x' }) as { ok: false; error: string };
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/schedule/);
  });

  it('rejects kind=trigger with no trigger_on field', () => {
    const result = createAutomationAction.validate({ kind: 'trigger', prompt: 'x' }) as { ok: false; error: string };
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/source and event/);
  });

  it('accepts a valid schedule automation', () => {
    const result = createAutomationAction.validate({
      kind: 'schedule',
      prompt: 'summarize overdue tasks',
      schedule: '0 8 * * 1',
    });
    expect(result.ok).toBe(true);
  });

  it('accepts a valid trigger automation', () => {
    const result = createAutomationAction.validate({
      kind: 'trigger',
      prompt: 'notify me',
      trigger_on: { source: 'procurement_status_events', event: 'Ordered' },
    });
    expect(result.ok).toBe(true);
  });

  it('rejects a malformed cron expression', () => {
    const result = createAutomationAction.validate({
      kind: 'schedule',
      prompt: 'x',
      schedule: 'not a cron',
    }) as { ok: false; error: string };
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/cron/);
  });

  it('rejects an unknown kind', () => {
    const result = createAutomationAction.validate({ kind: 'bogus', prompt: 'x' });
    expect(result.ok).toBe(false);
  });
});

it('an invalid-args create_automation proposal emits no needs-approval event (mirrors AC-AW-005)', async () => {
  const modelClient = {
    create: vi.fn()
      .mockResolvedValueOnce({
        finish_reason: 'tool_calls',
        message: {
          role: 'assistant',
          content: null,
          tool_calls: [
            {
              id: 'tu1',
              type: 'function',
              function: { name: 'create_automation', arguments: JSON.stringify({ kind: 'schedule', prompt: 'x' }) },
            },
          ],
        },
        usage: {},
        model: 'deepseek/deepseek-v4-flash',
      })
      .mockResolvedValueOnce({
        finish_reason: 'stop',
        message: { role: 'assistant', content: 'I need a schedule.' },
        usage: {},
        model: 'deepseek/deepseek-v4-flash',
      }),
  };

  const events = await collect(
    agentChatHandler(
      { messages: [{ role: 'user', content: 'watch for X' }] },
      baseDeps({ modelClient }),
    ),
  );

  expect(events.find((e) => (e.payload as { status?: string })?.status === 'needs-approval')).toBeUndefined();
});

it('AC-AAN-028 a valid create_automation proposal emits needs-approval and writes no row', async () => {
  const validArgs = { kind: 'schedule', prompt: 'summarize overdue tasks', schedule: '0 8 * * 1' };
  const modelClient = {
    create: vi.fn().mockResolvedValue({
      finish_reason: 'tool_calls',
      message: {
        role: 'assistant',
        content: null,
        tool_calls: [
          { id: 'tu1', type: 'function', function: { name: 'create_automation', arguments: JSON.stringify(validArgs) } },
        ],
      },
      usage: {},
      model: 'deepseek/deepseek-v4-flash',
    }),
  };
  const supabase = mockSupabase();

  const events = await collect(
    agentChatHandler(
      { runId: 'run-1', messages: [{ role: 'user', content: 'watch for X' }] },
      baseDeps({ modelClient, supabase }),
    ),
  );

  const needsApprovalEvent = events.find(
    (e) => e.type === 'status' && (e.payload as { status?: string })?.status === 'needs-approval',
  );
  expect(needsApprovalEvent).toBeDefined();
  expect((needsApprovalEvent!.payload as { actionName: string }).actionName).toBe('create_automation');
  expect((needsApprovalEvent!.payload as { structuredArgs: unknown }).structuredArgs).toMatchObject(validArgs);
  // No write during propose.
  expect((supabase.from as ReturnType<typeof vi.fn>).mock.calls.some((c) => c[0] === 'agent_automations')).toBe(false);
});

it('AC-AAN-029 approving create_automation writes the row under the caller-JWT client, owned by the caller', async () => {
  const validArgs = { kind: 'schedule', prompt: 'summarize overdue tasks', schedule: '0 8 * * 1' };
  const toolId = 'tool-use-id-1';

  const proposeModelClientCreate = vi.fn().mockResolvedValue({
    finish_reason: 'tool_calls',
    message: {
      role: 'assistant',
      content: null,
      tool_calls: [
        { id: toolId, type: 'function', function: { name: 'create_automation', arguments: JSON.stringify(validArgs) } },
      ],
    },
    usage: {},
    model: 'deepseek/deepseek-v4-flash',
  });

  const proposeEvents = await collect(
    agentChatHandler(
      { runId: 'run-1', messages: [{ role: 'user', content: 'watch for X' }] },
      baseDeps({ modelClient: { create: proposeModelClientCreate }, supabase: mockSupabase() }),
    ),
  );
  const needsApprovalEvent = proposeEvents.find(
    (e) => e.type === 'status' && (e.payload as { status?: string })?.status === 'needs-approval',
  );
  const pendingId = (needsApprovalEvent!.payload as { pendingId: string }).pendingId;

  const approveModelClientCreate = vi.fn().mockResolvedValue({
    finish_reason: 'stop',
    message: { role: 'assistant', content: 'Done — automation created.' },
    usage: {},
    model: 'deepseek/deepseek-v4-flash',
  });

  const approveSupabase = mockSupabase({ insertResult: { data: { id: 'auto-1' }, error: null } });

  const approveEvents = await collect(
    agentChatHandler(
      {
        runId: 'run-1',
        messages: [
          { role: 'user', content: 'watch for X' },
          {
            role: 'assistant',
            content: [{ type: 'tool_use', id: toolId, name: 'create_automation', input: validArgs }],
          },
        ],
        decision: { pendingId, verdict: 'approve' },
      },
      baseDeps({ modelClient: { create: approveModelClientCreate }, supabase: approveSupabase }),
    ),
  );

  const toolEvent = approveEvents.find((e) => e.type === 'tool');
  expect(toolEvent).toBeDefined();

  // The write went through the SAME caller-JWT-scoped supabase mock injected via deps.supabase
  // (never a separately-constructed service_role client) — dispatchActionForced (NFR-AW-SEC-001).
  const fromCalls = (approveSupabase.from as ReturnType<typeof vi.fn>).mock.calls;
  expect(fromCalls.some((c) => c[0] === 'agent_automations')).toBe(true);

  const insertCall = (approveSupabase.from as ReturnType<typeof vi.fn>).mock.results.find(
    (_r, i) => fromCalls[i][0] === 'agent_automations',
  );
  const insertFn = (insertCall!.value as { insert: ReturnType<typeof vi.fn> }).insert;
  expect(insertFn).toHaveBeenCalledTimes(1);
  const insertedRow = insertFn.mock.calls[0][0] as Record<string, unknown>;
  // Never sends an explicit owner_id — RLS column default pins the caller's own uid.
  expect(insertedRow).not.toHaveProperty('owner_id');
  expect(insertedRow.kind).toBe('schedule');
  expect(insertedRow.schedule).toBe('0 8 * * 1');
});
