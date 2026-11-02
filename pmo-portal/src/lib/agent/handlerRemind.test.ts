import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { agentChatHandler, type HandlerDeps } from '../../../../supabase/functions/agent-chat/handler';
import type { AgentEvent } from './runtime/port';
import { fakeSupabase, type FakeCall } from './testing/fakeSupabase';

const P1 = '11111111-1111-4111-8111-111111111111';
const T1 = '00000000-0000-4000-8000-000000000001';
async function collect(it: AsyncIterable<AgentEvent>) { const out: AgentEvent[] = []; for await (const e of it) out.push(e); return out; }
const toolCall = (name: string, args: object) => ({
  finish_reason: 'tool_calls', usage: {}, model: 'm',
  message: { role: 'assistant', content: null, tool_calls: [{ id: 'tc-1', type: 'function', function: { name, arguments: JSON.stringify(args) } }] },
});
function respond(c: FakeCall) {
  if (c.table === 'profiles' && c.columns === 'org_id, role') return { data: { org_id: 'org-1', role: 'Project Manager' }, error: null };
  if (c.table === 'profiles' && c.columns === 'timezone') return { data: { timezone: 'UTC' }, error: null };
  if (c.table === 'profiles') return { data: [{ id: 'u-2', full_name: 'Site engineer' }], error: null };
  if (c.table === 'organizations') return { data: { default_timezone: 'UTC', default_locale: 'en-US', default_number_locale: 'en-US' }, error: null };
  if (c.table === 'org_features') return { data: { enabled: false }, error: null };
  if (c.table === 'projects' && c.columns === 'id') return { data: [{ id: P1 }], error: null };
  if (c.table === 'projects') return { data: [{ id: P1, name: 'Harbor Tower' }], error: null };
  if (c.table === 'tasks') return { data: [{ id: T1, name: 'Pour foundation', end_date: '2026-10-01', project_id: P1, assignee_id: 'u-2' }], error: null };
  return { data: null, error: null };
}

describe('remind_overdue through the handler (#1639)', () => {
  beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-10-06T03:00:00Z')); });
  afterEach(() => vi.useRealTimers());

  it('AC-RMD-018 the call always ends in needs-approval and nothing is sent before approval', async () => {
    const { client } = fakeSupabase(respond);
    client.rpc.mockResolvedValueOnce({ data: { remaining: 20, items: [{ task_id: T1, outcome: 'eligible', recipient_name: 'Site engineer' }] }, error: null } as never);
    const create = vi.fn().mockResolvedValueOnce(toolCall('remind_overdue', {}));
    const deps: HandlerDeps = { modelClient: { create }, model: 'm', userId: 'u-me', can: () => true, supabase: client as unknown as HandlerDeps['supabase'] };
    const events = await collect(agentChatHandler({ messages: [{ role: 'user', content: 'Remind whoever is late.' }] }, deps));
    const chip = events.find((e) => (e.payload as { status?: string } | undefined)?.status === 'needs-approval');
    expect(chip?.payload).toMatchObject({ actionName: 'remind_overdue', structuredArgs: { kind: 'prepared-reminders', reminders: [{ taskId: T1 }] } });
    expect((client.rpc.mock.calls as unknown[][]).map((c) => c[0])).toEqual(['preview_task_reminders']);
  });

  it('simulates the approve decision for remind_overdue proving no send happens before approve and a send happens after', async () => {
    const { client } = fakeSupabase(respond);
    client.rpc
      .mockResolvedValueOnce({ data: { remaining: 20, items: [{ task_id: T1, outcome: 'eligible', recipient_name: 'Site engineer' }] }, error: null } as never)
      .mockResolvedValueOnce({ data: { remaining: 19, items: [{ task_id: T1, outcome: 'sent', recipient_name: 'Site engineer', task_name: 'Pour foundation' }] }, error: null } as never);
    const stop = (text: string) => ({ finish_reason: 'stop', usage: {}, model: 'm', message: { role: 'assistant', content: text } });
    const create = vi.fn()
      .mockResolvedValueOnce(toolCall('remind_overdue', {}))
      .mockResolvedValueOnce(stop('I have sent the reminder to Site engineer.'));
    const deps: HandlerDeps = { modelClient: { create }, model: 'm', userId: 'u-me', can: () => true, supabase: client as unknown as HandlerDeps['supabase'] };

    // Initial turn: proposes remind_overdue via preview_task_reminders; no send_task_reminders is called before approval
    const turn1Events = await collect(agentChatHandler({ runId: 'run-1', messages: [{ role: 'user', content: 'Remind whoever is late.' }] }, deps));
    const chip = turn1Events.find((e) => (e.payload as { status?: string } | undefined)?.status === 'needs-approval');
    const chipPayload = chip?.payload as { pendingId: string; actionName: string; structuredArgs: Record<string, unknown> };
    expect(chipPayload?.actionName).toBe('remind_overdue');
    expect((client.rpc.mock.calls as unknown[][]).map((c) => c[0])).toEqual(['preview_task_reminders']);
    expect((client.rpc.mock.calls as unknown[][]).map((c) => c[0])).not.toContain('send_task_reminders');

    // Follow-up turn: caller approves the chip
    const turn2Events = await collect(agentChatHandler({
      runId: 'run-1',
      decision: { pendingId: chipPayload.pendingId, verdict: 'approve' },
      messages: [
        { role: 'user', content: 'Remind whoever is late.' },
        { role: 'assistant', content: [{ type: 'tool_use', id: chipPayload.pendingId, name: 'remind_overdue', input: chipPayload.structuredArgs }] },
      ],
    }, deps));

    // send_task_reminders called after approval with the approved task IDs
    expect((client.rpc.mock.calls as unknown[][]).map((c) => c[0])).toEqual(['preview_task_reminders', 'send_task_reminders']);
    expect(client.rpc).toHaveBeenLastCalledWith('send_task_reminders', { p_task_ids: [T1] });
    const toolEvent = turn2Events.find((e) => e.type === 'tool');
    expect(toolEvent?.payload).toMatchObject({
      name: 'remind_overdue',
      result: {
        ok: true,
        sent: [{ to: 'Site engineer', task: 'Pour foundation' }],
        remainingToday: 19,
      },
    });
  });
});
