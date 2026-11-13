import { beforeEach, describe, expect, it, vi } from 'vitest';

// C13 (DS my-tasks #1/#4): the assignee queue's read must carry the two facts its rows render —
// the task's priority and its archive stamp. This test pins the SELECTED COLUMNS and the mapping,
// so a future narrowing of the read cannot silently re-hide them (reads only: no write path here).

const h = vi.hoisted(() => {
  const state = { select: '', eq: [] as Array<[string, ...unknown[]]>, fail: false, nullFacts: false };
  const from = vi.fn(() => {
    const q: Record<string, unknown> = {
      select: (cols: string) => { state.select = cols; return q; },
      eq: (...a: unknown[]) => { state.eq.push(['eq', ...a]); return q; },
      is: () => q,
      order: () => q,
      range: () => q,
      then: (resolve: (v: unknown) => void) => resolve(state.fail
        ? { data: null, error: { message: 'boom', code: 'XX001' } }
        : { data: [{
            id: 't1', name: 'Pour slab', status: 'To Do', assignee_id: 'u1', project_id: 'p1',
            meeting_id: null, start_date: null, end_date: '2026-11-12',
            priority: state.nullFacts ? null : 'High',
            archived_at: state.nullFacts ? null : '2026-10-01T00:00:00Z',
            project: { name: 'Tower A', short_name: null },
          }], error: null }),
    };
    return q;
  });
  return { state, from };
});
vi.mock('@/src/lib/supabase/client', () => ({ supabase: { from: h.from } }));

import { listMyTasks } from './tasks';

beforeEach(() => { h.state.select = ''; h.state.eq = []; h.state.fail = false; h.state.nullFacts = false; h.from.mockClear(); });

describe('listMyTasks — C13 facts on the row', () => {
  it('selects and maps the priority and archive stamp the queue renders', async () => {
    const [task] = await listMyTasks('u1');

    expect(h.state.select).toContain('priority');
    expect(h.state.select).toContain('archived_at');
    expect(h.state.eq).toEqual([['eq', 'assignee_id', 'u1']]);
    expect(task).toMatchObject({
      id: 't1',
      project_name: 'Tower A',
      priority: 'High',
      archived_at: '2026-10-01T00:00:00Z',
    });
  });

  it('keeps an unset priority and an unarchived task as null — never fabricated facts', async () => {
    h.state.nullFacts = true;
    const [task] = await listMyTasks('u1');
    expect(task.priority).toBeNull();
    expect(task.archived_at).toBeNull();
  });
});
