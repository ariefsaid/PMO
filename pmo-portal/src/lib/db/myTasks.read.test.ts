import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => {
  const state = { failSecond: false, filters: [] as unknown[][] };
  const rows = Array.from({ length: 1005 }, (_, i) => ({
    id: String(i).padStart(4, '0'), name: `Task ${i}`, status: 'To Do', assignee_id: 'u1',
    project_id: i ? null : 'p1', meeting_id: null, start_date: null, end_date: null,
    project: i ? null : { name: 'Contract title', short_name: 'Short' },
  }));
  const from = vi.fn(() => {
    let start = 0, end = 999;
    const q = {
      select: () => q, eq: (...args: unknown[]) => { state.filters.push(args); return q; },
      is: (...args: unknown[]) => { state.filters.push(args); return q; }, order: () => q,
      range: (a: number, b: number) => { start = a; end = b; return q; },
      then: (resolve: (v: unknown) => void) => resolve(state.failSecond && start > 0
        ? { data: null, error: { message: 'page unavailable', code: 'XX001' } }
        : { data: rows.slice(start, end + 1), error: null }),
    };
    return q;
  });
  return { state, from };
});
vi.mock('@/src/lib/supabase/client', () => ({ supabase: { from: h.from } }));
import { listMyTasks } from './tasks';

beforeEach(() => { h.state.failSecond = false; h.state.filters = []; h.from.mockClear(); });
describe('assignee task read', () => {
  it('returns every joined task and preserves names and projectless rows', async () => {
    const rows = await listMyTasks('u1');
    expect(rows).toHaveLength(1005);
    expect(rows[0]).toMatchObject({ project_name: 'Short', project_contractual_name: 'Contract title' });
    expect(rows[1004].project_name).toBeNull();
    expect(h.state.filters).toContainEqual(['assignee_id', 'u1']);
    expect(h.state.filters).toContainEqual(['tombstoned_at', null]);
  });
  it('rejects a later page error instead of returning a partial list', async () => {
    h.state.failSecond = true;
    await expect(listMyTasks('u1')).rejects.toMatchObject({ message: 'page unavailable', code: 'XX001' });
  });
});
