import { describe, it, expect, vi, beforeEach } from 'vitest';

// Chainable supabase builder that records every call (the tasks.test.ts idiom, plus `neq`).
const h = vi.hoisted(() => {
  const calls: Array<[string, unknown[]]> = [];
  const result = { value: { data: [] as unknown, error: null as unknown } };
  const builder: Record<string, unknown> = {};
  for (const m of ['select', 'eq', 'neq', 'is', 'in', 'order', 'insert', 'update', 'single']) {
    builder[m] = (...args: unknown[]) => { calls.push([m, args]); return builder; };
  }
  builder.range = () => builder;
  builder.then = (resolve: (v: unknown) => unknown) => resolve(result.value);
  return { calls, result, from: vi.fn(() => builder) };
});
vi.mock('@/src/lib/supabase/client', () => ({ supabase: { from: h.from } }));
vi.mock('@/src/lib/adapterSeam/ownershipCache', () => ({ routeTaskWrite: () => 'pmo' }));
vi.mock('@/src/lib/adapterSeam/dispatchClient', () => ({ dispatchTaskCommand: vi.fn() }));

import { listTasks, listOpenTasksByWorkOrder, createTask, updateTask } from './tasks';

const has = (m: string, ...args: unknown[]) =>
  h.calls.some(([name, a]) => name === m && JSON.stringify(a) === JSON.stringify(args));

beforeEach(() => { h.calls.length = 0; h.result.value = { data: [], error: null }; });

describe('AC-TWOP-007 tasks filtered by work order', () => {
  it('a work-order id filters to that work order', async () => {
    await listTasks('p1', { workOrderId: 'wo-1' });
    expect(has('eq', 'project_id', 'p1')).toBe(true);
    expect(has('eq', 'work_order_id', 'wo-1')).toBe(true);
  });
  it('"none" lists the tasks linked to no work order', async () => {
    await listTasks('p1', { workOrderId: 'none' });
    expect(has('is', 'work_order_id', null)).toBe(true);
    expect(h.calls.some(([m, a]) => m === 'eq' && a[0] === 'work_order_id')).toBe(false);
  });
  it('no filter leaves the work-order column alone', async () => {
    await listTasks('p1');
    expect(h.calls.some(([, a]) => a[0] === 'work_order_id')).toBe(false);
  });
});

describe('AC-TWOP-009 open tasks of a work order', () => {
  it('asks for that work order, excluding Done, archived and tombstoned tasks, and never sends org_id', async () => {
    h.result.value = { data: [{ id: 't1', assignee: null, dependencies: null }], error: null };
    const rows = await listOpenTasksByWorkOrder('wo-1');
    expect(has('eq', 'work_order_id', 'wo-1')).toBe(true);
    expect(has('neq', 'status', 'Done')).toBe(true);
    expect(has('is', 'archived_at', null)).toBe(true);
    expect(has('is', 'tombstoned_at', null)).toBe(true);
    expect(JSON.stringify(h.calls)).not.toContain('org_id');
    expect(rows[0].dependencies).toEqual([]);
  });
});

describe('task writes carry the work order and the proof flag', () => {
  it('create sends work_order_id and proof_required only when stated', async () => {
    h.result.value = { data: { id: 'new' }, error: null };
    await createTask({ project_id: 'p1', name: 'x', status: 'To Do', assignee_id: null, work_order_id: 'wo-1', proof_required: true });
    const ins = h.calls.find(([m]) => m === 'insert')![1][0] as Record<string, unknown>;
    expect(ins.work_order_id).toBe('wo-1');
    expect(ins.proof_required).toBe(true);
    h.calls.length = 0;
    await createTask({ project_id: 'p1', name: 'y', status: 'To Do', assignee_id: null });
    const ins2 = h.calls.find(([m]) => m === 'insert')![1][0] as Record<string, unknown>;
    expect('work_order_id' in ins2).toBe(false);
    expect('proof_required' in ins2).toBe(false);
  });
  it('update sends only the keys present; null clears the link', async () => {
    h.result.value = { data: [{ id: 't1' }], error: null };
    await updateTask('t1', { work_order_id: null });
    expect(h.calls.find(([m]) => m === 'update')![1][0]).toEqual({ work_order_id: null });
  });
});
