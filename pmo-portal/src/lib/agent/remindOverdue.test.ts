import { describe, expect, it } from 'vitest';
import {
  prepareRemindOverdue, validatePreparedReminders, runRemindOverdue, REMINDER_BATCH_CAP,
} from '../../../../supabase/functions/agent-chat/remindOverdue';
import type { PreparedReminders } from '../../../../supabase/functions/agent-chat/remindOverdue';
import { fakeSupabase, type FakeCall } from './testing/fakeSupabase';

const NOW = new Date('2026-10-06T03:00:00Z');
const P1 = '11111111-1111-4111-8111-111111111111';
const T = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const ids = (out: { ok: boolean; value?: object }) => (out.ok ? (out.value as PreparedReminders).reminders.map((r) => r.taskId) : null);
const ctx = (client: unknown) => ({ jwt: '', userId: 'u-me', orgId: 'org-1', role: 'Project Manager', supabase: client as never });

type TaskRow = { id: string; name: string; end_date: string; project_id: string; assignee_id: string | null };
function world(tasks: TaskRow[]) {
  return (c: FakeCall) => {
    if (c.table === 'profiles' && c.columns === 'timezone') return { data: { timezone: 'UTC' }, error: null };
    if (c.table === 'profiles') return { data: [{ id: 'u-2', full_name: 'Site engineer' }, { id: 'u-3', full_name: 'Planner' }], error: null };
    if (c.table === 'organizations') return { data: { default_timezone: 'UTC', default_locale: 'en-US', default_number_locale: 'en-US' }, error: null };
    if (c.table === 'org_features') return { data: { enabled: false }, error: null };
    if (c.table === 'projects' && c.columns === 'id') return { data: [{ id: P1 }], error: null };
    if (c.table === 'projects') return { data: [{ id: P1, name: 'Harbor Tower' }], error: null };
    if (c.table === 'tasks') return { data: tasks, error: null };
    return { data: [], error: null };
  };
}
const eligible = (ids: string[], remaining = 20) => ({
  data: { remaining, items: ids.map((id) => ({ task_id: id, outcome: 'eligible', recipient_name: 'Site engineer', task_name: 'x', due_date: '2026-10-01' })) },
  error: null,
});
const TASKS: TaskRow[] = [
  { id: T(1), name: 'Pour foundation', end_date: '2026-10-01', project_id: P1, assignee_id: 'u-2' },
  { id: T(2), name: 'My own task', end_date: '2026-10-02', project_id: P1, assignee_id: 'u-me' },
  { id: T(3), name: 'Nobody owns this', end_date: '2026-10-02', project_id: P1, assignee_id: null },
  { id: T(4), name: 'Rebar check', end_date: '2026-10-03', project_id: P1, assignee_id: 'u-3' },
];

describe('prepareRemindOverdue (#1639)', () => {
  it('AC-RMD-013 with no argument proposes exactly the overdue tasks assigned to other people', async () => {
    const { client } = fakeSupabase(world(TASKS));
    client.rpc.mockResolvedValueOnce(eligible([T(1), T(4)]) as never);
    const out = await prepareRemindOverdue({}, ctx(client), NOW);
    expect(client.rpc).toHaveBeenCalledWith('preview_task_reminders', { p_task_ids: [T(1), T(4)] });
    expect(ids(out)).toEqual([T(1), T(4)]);
    expect(out.ok && out.summary).toMatch(/^Send 2 reminders: Site engineer about Pour foundation \(due /);
  });

  it('AC-RMD-014 a task name matching two remindable tasks returns candidates and no chip', async () => {
    const { client } = fakeSupabase(world([
      { ...TASKS[0], name: 'Pour slab A' }, { ...TASKS[3], name: 'Pour slab B' },
    ]));
    const out = await prepareRemindOverdue({ task: 'pour' }, ctx(client), NOW);
    expect(out).toMatchObject({ ok: false, error: { needs: 'choice' } });
    expect(out.ok === false && (out.error.candidates as unknown[])).toHaveLength(2);
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it('AC-RMD-014 a task name matching nothing remindable is a plain refusal', async () => {
    const { client } = fakeSupabase(world(TASKS));
    const out = await prepareRemindOverdue({ task: 'My own task' }, ctx(client), NOW);
    expect(out).toEqual({ ok: false, error: { error: 'No overdue task named "My own task" belongs to someone else.' } });
  });

  it('AC-RMD-015 proposes only as many as remain today, oldest due first, and says how many were left out', async () => {
    const { client } = fakeSupabase(world(TASKS));
    client.rpc.mockResolvedValueOnce(eligible([T(1), T(4)], 1) as never);
    const out = await prepareRemindOverdue({}, ctx(client), NOW);
    expect(ids(out)).toEqual([T(1)]);
    expect(out.ok && out.summary).toMatch(/1 left out: daily reminder limit\.$/);
  });

  it('AC-RMD-015 with nothing remaining there is no chip', async () => {
    const { client } = fakeSupabase(world(TASKS));
    client.rpc.mockResolvedValueOnce(eligible([T(1)], 0) as never);
    expect(await prepareRemindOverdue({}, ctx(client), NOW))
      .toEqual({ ok: false, error: { error: "You have reached today's reminder limit. Try again tomorrow." } });
  });

  const ONE = { kind: 'prepared-reminders', reminders: [{ taskId: T(1), taskName: 'Pour foundation', recipientName: 'Site engineer', dueDate: '2026-10-01' }] };

  it.each([
    ['an extra field', { ...ONE, recipientIds: ['u-2'] }],
    ['an extra reminder field', { ...ONE, reminders: [{ ...ONE.reminders[0], recipientId: 'u-9' }] }],
    ['a non-uuid id', { ...ONE, reminders: [{ ...ONE.reminders[0], taskId: 'x' }] }],
    ['a duplicate', { ...ONE, reminders: [ONE.reminders[0], ONE.reminders[0]] }],
    ['11 items', { ...ONE, reminders: Array.from({ length: REMINDER_BATCH_CAP + 1 }, (_, i) => ({ ...ONE.reminders[0], taskId: T(i + 1) })) }],
  ])('AC-RMD-016 the replayed value is rejected with %s', (_label, value) => {
    expect(validatePreparedReminders(value).ok).toBe(false);
  });

  it('AC-RMD-017 run sends task ids only and reports each outcome with the names the server read', async () => {
    const { client } = fakeSupabase(world([]));
    client.rpc.mockResolvedValueOnce({ data: { remaining: 19, items: [
      { task_id: T(1), outcome: 'sent', task_name: 'Pour foundation', recipient_name: 'Site engineer' },
    ] }, error: null } as never);
    const replayed = { ...ONE, reminders: [{ ...ONE.reminders[0], recipientName: 'Edited name', taskName: 'Edited task' }] };
    const out = await runRemindOverdue(replayed, ctx(client));
    expect(client.rpc).toHaveBeenCalledWith('send_task_reminders', { p_task_ids: [T(1)] });
    expect(out).toEqual(expect.objectContaining({
      ok: true, sent: [{ to: 'Site engineer', task: 'Pour foundation' }], skipped: [], remainingToday: 19,
    }));
  });
});
