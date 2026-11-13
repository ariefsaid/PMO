import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => {
  const state = { calls: [] as Array<[string, ...unknown[]]>, select: '', fail: false };
  const from = vi.fn(() => {
    const q: Record<string, unknown> = {
      select: (cols: string) => { state.select = cols; return q; },
      eq: (...a: unknown[]) => { state.calls.push(['eq', ...a]); return q; },
      gte: (...a: unknown[]) => { state.calls.push(['gte', ...a]); return q; },
      lt: (...a: unknown[]) => { state.calls.push(['lt', ...a]); return q; },
      is: (...a: unknown[]) => { state.calls.push(['is', ...a]); return q; },
      order: () => q, range: () => q,
      then: (resolve: (v: unknown) => void) => resolve(state.fail
        ? { data: null, error: { message: 'boom', code: 'XX001' } }
        : { data: [{
            id: 't1', name: 'Pour slab', status: 'To Do', project_id: 'p1', start_date: null,
            end_date: '2026-11-12', assignee_id: 'u1', created_by: 'u2',
            assignee: { full_name: 'Sam Member' },
            project: { name: 'Tower A', short_name: null },
          }], error: null }),
    };
    return q;
  });
  return { state, from };
});
vi.mock('@/src/lib/supabase/client', () => ({ supabase: { from: h.from } }));
import { listCalendarTasks } from './tasks';

beforeEach(() => { h.state.calls = []; h.state.fail = false; h.from.mockClear(); });

describe('listCalendarTasks (#1982)', () => {
  it('reads live dated tasks in the window in ONE query (no per-project fan-out)', async () => {
    const out = await listCalendarTasks({ from: '2026-11-01', to: '2026-12-01' });
    expect(h.from).toHaveBeenCalledTimes(1);
    expect(h.state.calls).toEqual(expect.arrayContaining([
      ['gte', 'end_date', '2026-11-01'], ['lt', 'end_date', '2026-12-01'],
      ['is', 'tombstoned_at', null], ['is', 'archived_at', null],
    ]));
    expect(out).toEqual([{
      id: 't1', name: 'Pour slab', status: 'To Do', project_id: 'p1', project_name: 'Tower A',
      start_date: null, end_date: '2026-11-12', assignee_id: 'u1', created_by: 'u2',
      // C13 (DS calendar #4): the chip can say whose task it is — the read carries the assignee's name.
      assignee_name: 'Sam Member',
    }]);
  });
  it('C13 selects the assignee’s name so a chip can say whose task it is', async () => {
    await listCalendarTasks({ from: '2026-11-01', to: '2026-12-01' });
    expect(h.state.select).toContain('profiles');
    expect(h.state.select).toContain('full_name');
  });
  it('scopes to one project when asked', async () => {
    await listCalendarTasks({ from: '2026-11-01', to: '2026-12-01', projectId: 'p1' });
    expect(h.state.calls).toContainEqual(['eq', 'project_id', 'p1']);
  });
  it('throws instead of returning a partial set', async () => {
    h.state.fail = true;
    await expect(listCalendarTasks({ from: '2026-11-01', to: '2026-12-01' })).rejects.toMatchObject({ message: 'boom' });
  });
});
