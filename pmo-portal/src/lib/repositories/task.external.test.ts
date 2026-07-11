import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * AC-CUA-001 — the byte-for-byte regression net (Slice C, EARLY per the plan's binding ORDERING).
 *
 * With the ADR-0056 ownership cache EMPTY (`clearOwnershipCache()`), every task write must keep
 * hitting the EXISTING direct DAL — never `supabase.functions.invoke('adapter-dispatch', ...)` —
 * and produce byte-for-byte the same shape/thrown-error as pre-P1 (FR-CUA-030). Only once the cache
 * is loaded AND positively asserts `tasks`→`clickup` does a native-field write route externally
 * (FR-CUA-031); enhancement writes (`addDependency`, milestone re-assignment) are NEVER branched
 * (FR-CUA-024) — they stay on the direct DAL regardless of ownership.
 *
 * This test MUST land before the tasks.ts wiring (C4) — see the plan's binding ORDERING.
 */

// A flexible chainable mock of the supabase query builder (mirrors tasks.test.ts) PLUS a spy on
// `functions.invoke` (the dispatch transport) so both halves of the invariant are observable.
const h = vi.hoisted(() => {
  const result = { value: { data: null as unknown, error: null as unknown } };
  const calls = {
    from: [] as unknown[],
    select: [] as unknown[],
    eq: [] as unknown[],
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
  const invoke = vi.fn(async () => ({
    data: { externalRecordId: 'cu-1', canonical: { id: 'pmo-1', name: 'Routed' } },
    error: null,
  }));
  return { from, invoke, calls, result };
});

vi.mock('@/src/lib/supabase/client', () => ({
  supabase: { from: h.from, functions: { invoke: h.invoke } },
}));

import {
  createTask,
  updateTask,
  updateTaskStatus,
  deleteTask,
  addDependency,
} from '@/src/lib/db/tasks';
import { updateTaskMilestone } from '@/src/lib/db/milestones';
import { setTaskOwnership, clearOwnershipCache } from '@/src/lib/adapterSeam/ownershipCache';
import { AppError } from '@/src/lib/appError';

beforeEach(() => {
  h.from.mockClear();
  h.invoke.mockClear();
  for (const k of Object.keys(h.calls) as (keyof typeof h.calls)[]) {
    if (typeof h.calls[k] === 'number') (h.calls[k] as unknown) = 0;
    else (h.calls[k] as unknown[]).length = 0;
  }
  h.result.value = { data: null, error: null };
  clearOwnershipCache();
});

describe('AC-CUA-001 empty ownership cache — every task write stays on the direct DAL', () => {
  it('AC-CUA-001 createTask never calls functions.invoke and returns the direct-DAL row', async () => {
    h.result.value = { data: { id: 'new', name: 'Mobilise', status: 'To Do' }, error: null };
    const row = await createTask({ project_id: 'p1', name: 'Mobilise', status: 'To Do', assignee_id: null });
    expect(h.invoke).not.toHaveBeenCalled();
    expect(h.calls.from).toEqual(['tasks']);
    expect(row.id).toBe('new');
  });

  it('AC-CUA-001 updateTask never calls functions.invoke', async () => {
    h.result.value = { data: null, error: null };
    await updateTask('t1', { name: 'Renamed' });
    expect(h.invoke).not.toHaveBeenCalled();
    expect(h.calls.from).toEqual(['tasks']);
  });

  it('AC-CUA-001 updateTaskStatus never calls functions.invoke', async () => {
    h.result.value = { data: null, error: null };
    await updateTaskStatus('t1', 'Done');
    expect(h.invoke).not.toHaveBeenCalled();
    expect(h.calls.from).toEqual(['tasks']);
  });

  it('AC-CUA-001 deleteTask never calls functions.invoke', async () => {
    h.result.value = { data: null, error: null };
    await deleteTask('t1');
    expect(h.invoke).not.toHaveBeenCalled();
    expect(h.calls.from).toEqual(['tasks']);
    expect(h.calls.delete).toBe(1);
  });

  it('AC-CUA-001 addDependency never calls functions.invoke (enhancement, FR-CUA-024)', async () => {
    h.result.value = { data: null, error: null };
    await addDependency('t2', 't1');
    expect(h.invoke).not.toHaveBeenCalled();
    expect(h.calls.from).toEqual(['task_dependencies']);
  });

  it('AC-CUA-001 a thrown DAL error keeps its exact pre-P1 shape (AppError, code preserved)', async () => {
    h.result.value = { data: null, error: { message: 'denied', code: '42501' } };
    await expect(updateTaskStatus('t1', 'Done')).rejects.toBeInstanceOf(AppError);
    await expect(updateTaskStatus('t1', 'Done')).rejects.toMatchObject({ code: '42501' });
    expect(h.invoke).not.toHaveBeenCalled();
  });
});

describe('AC-CUA-001 loaded cache asserting tasks→clickup — native writes route externally, enhancements never do', () => {
  beforeEach(() => {
    setTaskOwnership([{ domain: 'tasks', externalTier: 'clickup' }]);
  });

  it('AC-CUA-001 createTask routes to dispatchTaskCommand (functions.invoke) instead of the direct insert', async () => {
    const row = await createTask({ project_id: 'p1', name: 'Mobilise', status: 'To Do', assignee_id: null });
    expect(h.invoke).toHaveBeenCalledTimes(1);
    const [fnName, opts] = h.invoke.mock.calls[0] as unknown as [string, { body: { domain: string; operation: string } }];
    expect(fnName).toBe('adapter-dispatch');
    expect(opts.body.domain).toBe('tasks');
    expect(opts.body.operation).toBe('create');
    expect(row.name).toBe('Routed');
    // the direct insert path is bypassed entirely
    expect(h.calls.insert).toEqual([]);
  });

  it('AC-CUA-001 updateTask (a native field) routes to dispatchTaskCommand', async () => {
    await updateTask('t1', { name: 'Renamed' });
    expect(h.invoke).toHaveBeenCalledTimes(1);
    const [, opts] = h.invoke.mock.calls[0] as unknown as [string, { body: { operation: string } }];
    expect(opts.body.operation).toBe('update');
    expect(h.calls.update).toEqual([]);
  });

  it('AC-CUA-001 updateTaskStatus routes to dispatchTaskCommand as a transition', async () => {
    await updateTaskStatus('t1', 'Done');
    expect(h.invoke).toHaveBeenCalledTimes(1);
    const [, opts] = h.invoke.mock.calls[0] as unknown as [string, { body: { operation: string } }];
    expect(opts.body.operation).toBe('transition');
  });

  it('AC-CUA-001 deleteTask routes to dispatchTaskCommand', async () => {
    await deleteTask('t1');
    expect(h.invoke).toHaveBeenCalledTimes(1);
    const [, opts] = h.invoke.mock.calls[0] as unknown as [string, { body: { operation: string } }];
    expect(opts.body.operation).toBe('delete');
    expect(h.calls.delete).toBe(0);
  });

  it('AC-CUA-001 addDependency (enhancement) still takes the direct DAL — FR-CUA-024', async () => {
    h.result.value = { data: null, error: null };
    await addDependency('t2', 't1');
    expect(h.invoke).not.toHaveBeenCalled();
    expect(h.calls.from).toEqual(['task_dependencies']);
  });

  it('AC-CUA-001 milestone re-assignment (updateTaskMilestone) still takes the direct DAL — FR-CUA-024', async () => {
    h.result.value = { data: null, error: null };
    await updateTaskMilestone('t1', 'm2');
    expect(h.invoke).not.toHaveBeenCalled();
    expect(h.calls.from).toEqual(['tasks']);
    expect(h.calls.update).toEqual([{ milestone_id: 'm2' }]);
  });
});
