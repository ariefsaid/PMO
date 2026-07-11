import { describe, it, expect, vi, beforeEach } from 'vitest';

// A flexible chainable mock of the supabase query builder (mirrors companies.test.ts).
// Each terminal call (the awaited one) resolves the queued result; we assert the recorded calls.
const h = vi.hoisted(() => {
  const result = { value: { data: null as unknown, error: null as unknown } };
  const calls = {
    from: [] as unknown[],
    select: [] as unknown[],
    eq: [] as unknown[],
    in: [] as unknown[],
    is: [] as unknown[],
    order: [] as unknown[],
    insert: [] as unknown[],
    update: [] as unknown[],
    match: [] as unknown[],
    delete: 0,
    single: 0,
    maybeSingle: 0,
  };
  const builder: Record<string, unknown> = {};
  const chain = (name: keyof typeof calls) => (...args: unknown[]) => {
    if (name === 'delete' || name === 'single' || name === 'maybeSingle') {
      (calls[name] as number)++;
    } else {
      (calls[name] as unknown[]).push(args.length === 1 ? args[0] : args);
    }
    return builder;
  };
  builder.select = chain('select');
  builder.eq = chain('eq');
  builder.in = chain('in');
  builder.is = chain('is');
  builder.order = chain('order');
  builder.insert = chain('insert');
  builder.update = chain('update');
  builder.match = chain('match');
  builder.delete = chain('delete');
  builder.single = chain('single');
  builder.maybeSingle = chain('maybeSingle');
  builder.then = (resolve: (v: unknown) => unknown) => resolve(result.value);
  const from = vi.fn((table: string) => {
    calls.from.push(table);
    return builder;
  });
  return { from, calls, result };
});

vi.mock('@/src/lib/supabase/client', () => ({ supabase: { from: h.from } }));

import {
  listTasks,
  getTask,
  createTask,
  updateTask,
  updateTaskStatus,
  deleteTask,
  addDependency,
  removeDependency,
} from './tasks';
import { AppError } from '@/src/lib/appError';

beforeEach(() => {
  h.from.mockClear();
  for (const k of Object.keys(h.calls) as (keyof typeof h.calls)[]) {
    if (typeof h.calls[k] === 'number') (h.calls[k] as unknown) = 0;
    else (h.calls[k] as unknown[]).length = 0;
  }
  h.result.value = { data: null, error: null };
});

describe('AC-TASK-001 listTasks (per-project, with assignee + deps)', () => {
  it('AC-TASK-001: selects tasks for one project, never sends org_id, ordered by created_at', async () => {
    h.result.value = {
      data: [
        {
          id: 't1',
          project_id: 'p1',
          name: 'Survey site',
          status: 'To Do',
          assignee_id: 'u1',
          assignee: { id: 'u1', full_name: 'Dana Eng' },
          dependencies: [],
        },
      ],
      error: null,
    };
    const result = await listTasks('p1');
    expect(h.calls.from).toEqual(['tasks']);
    expect(h.calls.eq).toContainEqual(['project_id', 'p1']);
    expect(JSON.stringify(h.calls)).not.toContain('org_id');
    expect(result[0].name).toBe('Survey site');
    expect(result[0].assignee?.full_name).toBe('Dana Eng');
  });

  it('AC-TASK-001: returns [] when supabase returns null data', async () => {
    h.result.value = { data: null, error: null };
    await expect(listTasks('p1')).resolves.toEqual([]);
  });

  it('AC-TASK-001: throws AppError preserving the PG code on a read error', async () => {
    h.result.value = { data: null, error: { message: 'denied', code: '42501' } };
    await expect(listTasks('p1')).rejects.toMatchObject({ message: 'denied', code: '42501' });
    await expect(listTasks('p1')).rejects.toBeInstanceOf(AppError);
  });
});

describe('AC-TASK-002 getTask', () => {
  it('AC-TASK-002: selects a single task by id, no org_id', async () => {
    h.result.value = { data: { id: 't1', name: 'Survey', status: 'To Do' }, error: null };
    const row = await getTask('t1');
    expect(h.calls.from).toEqual(['tasks']);
    expect(h.calls.eq).toContainEqual(['id', 't1']);
    expect(h.calls.maybeSingle).toBe(1);
    expect(row?.name).toBe('Survey');
  });

  it('AC-TASK-002: returns null when no row found', async () => {
    h.result.value = { data: null, error: null };
    await expect(getTask('missing')).resolves.toBeNull();
  });
});

describe('AC-TASK-003 createTask', () => {
  it('AC-TASK-003: inserts project_id/name/status/assignee/dates, NEVER org_id, returns the new row', async () => {
    h.result.value = { data: { id: 'new', name: 'Mobilise', status: 'To Do' }, error: null };
    const row = await createTask({
      project_id: 'p1',
      name: 'Mobilise',
      status: 'To Do',
      assignee_id: 'u1',
      start_date: '2026-06-10',
      end_date: '2026-06-20',
    });
    expect(h.calls.from).toEqual(['tasks']);
    expect(h.calls.insert).toEqual([
      {
        project_id: 'p1',
        name: 'Mobilise',
        status: 'To Do',
        assignee_id: 'u1',
        start_date: '2026-06-10',
        end_date: '2026-06-20',
        milestone_id: null,
      },
    ]);
    expect(JSON.stringify(h.calls.insert)).not.toContain('org_id');
    expect(h.calls.single).toBe(1);
    expect(row.id).toBe('new');
  });

  it('AC-TASK-003: normalises empty assignee/dates to null', async () => {
    h.result.value = { data: { id: 'new' }, error: null };
    await createTask({ project_id: 'p1', name: 'X', status: 'To Do', assignee_id: null });
    const insert = h.calls.insert[0] as Record<string, unknown>;
    expect(insert.assignee_id).toBeNull();
    expect(insert.start_date).toBeNull();
    expect(insert.end_date).toBeNull();
  });

  it('AC-TASK-003: throws AppError preserving code 42501 when RLS denies the insert', async () => {
    h.result.value = { data: null, error: { message: 'new row violates RLS', code: '42501' } };
    await expect(
      createTask({ project_id: 'p1', name: 'X', status: 'To Do', assignee_id: null }),
    ).rejects.toMatchObject({ code: '42501' });
  });
});

describe('AC-TASK-004 updateTask (structure)', () => {
  it('AC-TASK-004: updates name/assignee/dates/status by id, NEVER org_id/project_id', async () => {
    h.result.value = { data: null, error: null };
    await updateTask('t1', {
      name: 'Renamed',
      assignee_id: 'u2',
      status: 'In Progress',
      start_date: '2026-06-11',
      end_date: null,
    });
    expect(h.calls.from).toEqual(['tasks']);
    const patch = h.calls.update[0] as Record<string, unknown>;
    expect(patch).toMatchObject({
      name: 'Renamed',
      assignee_id: 'u2',
      status: 'In Progress',
      start_date: '2026-06-11',
      end_date: null,
    });
    expect(patch).not.toHaveProperty('org_id');
    expect(patch).not.toHaveProperty('project_id');
    expect(h.calls.eq).toContainEqual(['id', 't1']);
  });

  it('AC-TASK-004: throws AppError with code on a denied update', async () => {
    h.result.value = { data: null, error: { message: 'denied', code: '42501' } };
    await expect(updateTask('t1', { name: 'Y' })).rejects.toMatchObject({ code: '42501' });
  });

  it('AC-TASK-004: milestone_id present in patch is threaded into the DB update (edit-to-reassign)', async () => {
    h.result.value = { data: null, error: null };
    await updateTask('t1', { milestone_id: 'm2' });
    const patch = h.calls.update[0] as Record<string, unknown>;
    expect(patch).toHaveProperty('milestone_id', 'm2');
    expect(patch).not.toHaveProperty('org_id');
    expect(patch).not.toHaveProperty('project_id');
  });

  it('AC-TASK-004: milestone_id: null in patch explicitly clears the milestone (ungroup)', async () => {
    h.result.value = { data: null, error: null };
    await updateTask('t1', { milestone_id: null });
    const patch = h.calls.update[0] as Record<string, unknown>;
    expect(patch).toHaveProperty('milestone_id', null);
  });

  it('AC-TASK-004: omitting milestone_id from patch leaves milestone_id untouched (absent key not sent)', async () => {
    h.result.value = { data: null, error: null };
    await updateTask('t1', { name: 'Only rename' });
    const patch = h.calls.update[0] as Record<string, unknown>;
    expect(patch).not.toHaveProperty('milestone_id');
  });
});

describe('AC-TASK-005 updateTaskStatus (the column-pinned own-task path)', () => {
  it('AC-TASK-005: updates ONLY the status column by id (never any structure column)', async () => {
    h.result.value = { data: null, error: null };
    await updateTaskStatus('t1', 'Done');
    expect(h.calls.from).toEqual(['tasks']);
    const patch = h.calls.update[0] as Record<string, unknown>;
    // Status-only: exactly one key, and it is `status`.
    expect(Object.keys(patch)).toEqual(['status']);
    expect(patch.status).toBe('Done');
    expect(h.calls.eq).toContainEqual(['id', 't1']);
  });

  it('AC-TASK-005: surfaces an RLS denial (Engineer not own task) as AppError code 42501', async () => {
    h.result.value = { data: null, error: { message: 'denied', code: '42501' } };
    await expect(updateTaskStatus('t1', 'Done')).rejects.toMatchObject({ code: '42501' });
  });
});

describe('AC-TASK-006 deleteTask', () => {
  it('AC-TASK-006: deletes by id, NEVER org_id', async () => {
    h.result.value = { data: null, error: null };
    await deleteTask('t1');
    expect(h.calls.from).toEqual(['tasks']);
    expect(h.calls.delete).toBe(1);
    expect(h.calls.eq).toContainEqual(['id', 't1']);
    expect(JSON.stringify(h.calls.eq)).not.toContain('org_id');
  });

  it('AC-TASK-006: throws AppError with code 42501 when RLS denies the delete', async () => {
    h.result.value = { data: null, error: { message: 'denied', code: '42501' } };
    await expect(deleteTask('t1')).rejects.toMatchObject({ code: '42501' });
  });
});

describe('AC-TASK-007 task dependencies add / remove', () => {
  it('AC-TASK-007: addDependency inserts (task_id, depends_on_id), NEVER org_id', async () => {
    h.result.value = { data: null, error: null };
    await addDependency('t2', 't1');
    expect(h.calls.from).toEqual(['task_dependencies']);
    expect(h.calls.insert).toEqual([{ task_id: 't2', depends_on_id: 't1' }]);
    expect(JSON.stringify(h.calls.insert)).not.toContain('org_id');
  });

  it('AC-TASK-007: removeDependency deletes the matching (task_id, depends_on_id) pair', async () => {
    h.result.value = { data: null, error: null };
    await removeDependency('t2', 't1');
    expect(h.calls.from).toEqual(['task_dependencies']);
    expect(h.calls.delete).toBe(1);
    expect(h.calls.match).toContainEqual({ task_id: 't2', depends_on_id: 't1' });
  });

  it('AC-TASK-007: addDependency surfaces the self/duplicate guard as AppError (code preserved)', async () => {
    h.result.value = { data: null, error: { message: 'duplicate key', code: '23505' } };
    await expect(addDependency('t1', 't1')).rejects.toMatchObject({ code: '23505' });
  });
});
