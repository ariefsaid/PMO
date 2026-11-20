import { describe, it, expect, vi, beforeEach } from 'vitest';

// The tasks.workOrder.test.ts idiom: a chainable builder that records every call, plus `rpc`.
const h = vi.hoisted(() => {
  const calls: Array<[string, unknown[]]> = [];
  const result = { value: { data: [] as unknown, error: null as unknown } };
  const rpcCalls: Array<[string, unknown]> = [];
  const builder: Record<string, unknown> = {};
  for (const m of ['select', 'eq', 'neq', 'is', 'in', 'order', 'insert', 'update', 'single', 'limit', 'maybeSingle']) {
    builder[m] = (...args: unknown[]) => { calls.push([m, args]); return builder; };
  }
  builder.then = (resolve: (v: unknown) => unknown) => resolve(result.value);
  const rpc = vi.fn((name: string, args: unknown) => { rpcCalls.push([name, args]); return Promise.resolve(result.value); });
  return { calls, result, rpcCalls, rpc, from: vi.fn(() => builder) };
});
vi.mock('@/src/lib/supabase/client', () => ({ supabase: { from: h.from, rpc: h.rpc } }));
vi.mock('@/src/lib/adapterSeam/ownershipCache', () => ({ routeTaskWrite: () => 'pmo' }));
vi.mock('@/src/lib/adapterSeam/dispatchClient', () => ({ dispatchTaskCommand: vi.fn() }));

import {
  createTask, updateTask, taskLinkedRecords, findOpenTaskForRecord, recordLinkOf, closedReasonOf,
} from './tasks';

const has = (m: string, ...args: unknown[]) =>
  h.calls.some(([name, a]) => name === m && JSON.stringify(a) === JSON.stringify(args));

beforeEach(() => { h.calls.length = 0; h.rpcCalls.length = 0; h.result.value = { data: [], error: null }; });

describe('AC-RLT-014 linked status is one batched read per page (NFR-RLT-001)', () => {
  it('calls the read function once with the page ids, de-duplicated, and maps the rows', async () => {
    h.result.value = {
      data: [
        { task_id: 't1', link_type: 'expense_claim', record_id: 'c1', label: 'EXP-1', status: 'Approved', is_end_state: false, readable: true },
        { task_id: 't2', link_type: 'procurement', record_id: null, label: null, status: null, is_end_state: null, readable: false },
      ],
      error: null,
    };
    const rows = await taskLinkedRecords(['t1', 't2', 't1']);
    expect(h.rpcCalls).toEqual([['task_linked_records', { p_task_ids: ['t1', 't2'] }]]);
    expect(rows.get('t1')).toEqual({ taskId: 't1', linkType: 'expense_claim', recordId: 'c1', label: 'EXP-1', status: 'Approved', isEndState: false, readable: true });
    // FR-RLT-010: an unreadable record carries no number, status or end-state flag.
    expect(rows.get('t2')).toEqual({ taskId: 't2', linkType: 'procurement', recordId: null, label: null, status: null, isEndState: null, readable: false });
  });
  it('makes no request for an empty page', async () => {
    expect((await taskLinkedRecords([])).size).toBe(0);
    expect(h.rpc).not.toHaveBeenCalled();
  });
  it('splits a very large page into chunks', async () => {
    await taskLinkedRecords(Array.from({ length: 250 }, (_, i) => `t${i}`));
    expect(h.rpcCalls.length).toBe(3);
  });
});

describe('AC-RLT-015 the open task of a record (create-from-record opens it)', () => {
  it('asks for the open task of exactly that record: not Done, archived or tombstoned', async () => {
    h.result.value = { data: [{ id: 't9', name: 'Chase', project_id: null }], error: null };
    const found = await findOpenTaskForRecord('expense_claim', 'c1');
    expect(has('eq', 'expense_claim_id', 'c1')).toBe(true);
    expect(has('neq', 'status', 'Done')).toBe(true);
    expect(has('is', 'archived_at', null)).toBe(true);
    expect(has('is', 'tombstoned_at', null)).toBe(true);
    expect(JSON.stringify(h.calls)).not.toContain('org_id');
    expect(found).toEqual({ id: 't9', name: 'Chase', project_id: null });
  });
  it('returns null when there is none', async () => {
    expect(await findOpenTaskForRecord('procurement', 'p1')).toBeNull();
    expect(has('eq', 'procurement_id', 'p1')).toBe(true);
  });
});

describe('task writes carry the record link', () => {
  it('create sends a link only when stated', async () => {
    h.result.value = { data: { id: 'n' }, error: null };
    await createTask({ project_id: null, name: 'x', status: 'To Do', assignee_id: null, material_request_id: 'm1' });
    const ins = h.calls.find(([m]) => m === 'insert')![1][0] as Record<string, unknown>;
    expect(ins.material_request_id).toBe('m1');
    expect('procurement_id' in ins).toBe(false);
    expect('expense_claim_id' in ins).toBe(false);
    expect('closed_by_record_type' in ins).toBe(false);
  });
  it('update clears a link with null and never sends the close columns', async () => {
    h.result.value = { data: [{ id: 't1' }], error: null };
    await updateTask('t1', { procurement_id: null });
    const upd = h.calls.find(([m]) => m === 'update')![1][0] as Record<string, unknown>;
    expect(upd).toEqual({ procurement_id: null });
  });
});

describe('row helpers', () => {
  it('recordLinkOf names the single link of a task row', () => {
    expect(recordLinkOf({ procurement_id: null, expense_claim_id: 'c1', material_request_id: null })).toEqual({ type: 'expense_claim', id: 'c1' });
    expect(recordLinkOf({ procurement_id: null, expense_claim_id: null, material_request_id: null })).toBeNull();
  });
  it('closedReasonOf is present only for a system close', () => {
    expect(closedReasonOf({ closed_by_record_type: 'expense_claim', closed_by_record_status: 'Paid' })).toEqual({ type: 'expense_claim', status: 'Paid' });
    expect(closedReasonOf({ closed_by_record_type: null, closed_by_record_status: null })).toBeNull();
  });
});
