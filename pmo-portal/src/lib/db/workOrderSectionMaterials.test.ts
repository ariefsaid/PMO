import { beforeEach, describe, expect, it, vi } from 'vitest';

// Chainable PostgREST builder mock (the agentRuns.test.ts reference pattern, extended with the
// write chain, the paged-read terminal and an ordered result queue).
const h = vi.hoisted(() => {
  type Res = { data: unknown; error: unknown };
  const results: Res[] = [];
  const calls: Record<string, unknown[]> = {
    from: [], rpc: [], select: [], insert: [], update: [], delete: [], eq: [], is: [], order: [], limit: [], range: [], single: [], maybeSingle: [],
  };
  const next = (): Res => (results.length ? (results.shift() as Res) : { data: null, error: null });
  const builder: Record<string, unknown> = {};
  const rec = (name: keyof typeof calls) => (...args: unknown[]) => {
    calls[name].push(args.length <= 1 ? args[0] : args);
    return builder;
  };
  for (const m of ['select', 'insert', 'update', 'delete', 'eq', 'is', 'order', 'limit', 'range'] as const) builder[m] = rec(m);
  builder.maybeSingle = () => { calls.maybeSingle.push(true); return Promise.resolve(next()); };
  builder.single = () => { calls.single.push(true); return Promise.resolve(next()); };
  builder.then = (res: (v: Res) => unknown, rej: (e: unknown) => unknown) => Promise.resolve(next()).then(res, rej);
  const from = vi.fn((table: string) => { calls.from.push(table); return builder; });
  const rpc = vi.fn((fn: string, args?: unknown) => { calls.rpc.push(args ? [fn, args] : fn); return Promise.resolve(next()); });
  return { from, rpc, calls, results, push: (r: Res) => results.push(r) };
});

vi.mock('@/src/lib/supabase/client', () => ({ supabase: { from: h.from, rpc: h.rpc } }));

import {
  getMaterialCheck, getSectionLinePlans, listAllocations, listLiveSections, setAllocation,
} from './workOrderSectionMaterials';

beforeEach(() => {
  h.from.mockClear(); h.rpc.mockClear();
  for (const k of Object.keys(h.calls) as (keyof typeof h.calls)[]) h.calls[k].length = 0;
  h.results.length = 0;
});

describe('listLiveSections', () => {
  it('offers only the work order live sections in their own order', async () => {
    h.push({ data: [{ id: 's1', code: 'A', name: 'Earthworks' }], error: null });
    await expect(listLiveSections('wo1')).resolves.toEqual([{ id: 's1', code: 'A', name: 'Earthworks' }]);
    expect(h.calls.from).toEqual(['work_order_sections']);
    expect(h.calls.eq).toContainEqual(['work_order_id', 'wo1']);
    expect(h.calls.is).toContainEqual(['archived_at', null]);
    expect(h.calls.order).toContainEqual(['sort_order', { ascending: true }]);
  });

  it('a page error refuses the whole list rather than resolving a partial one', async () => {
    h.push({ data: null, error: { message: 'cancelled', code: '57014' } });
    await expect(listLiveSections('wo1')).rejects.toMatchObject({ code: '57014' });
  });
});

describe('getSectionLinePlans', () => {
  it('sends the three keys, plus the exclusion only when re-submitting over an existing request', async () => {
    h.push({ data: [{ item_id: 'i1', section_plan_qty: 10, section_prior_qty: null }], error: null });
    await expect(getSectionLinePlans('wo1', 's1', ['i1'])).resolves.toEqual([
      { itemId: 'i1', sectionPlanQty: 10, sectionPriorQty: null },
    ]);
    expect(h.calls.rpc).toEqual([['mrq_section_plan_for', { p_work_order_id: 'wo1', p_section_id: 's1', p_item_ids: ['i1'] }]]);

    h.push({ data: [], error: null });
    await getSectionLinePlans('wo1', 's1', ['i1'], 'req9');
    expect(h.calls.rpc.at(-1)).toEqual(['mrq_section_plan_for', { p_work_order_id: 'wo1', p_section_id: 's1', p_item_ids: ['i1'], p_exclude_request: 'req9' }]);
  });

  it('no items means no database call at all', async () => {
    await expect(getSectionLinePlans('wo1', 's1', [])).resolves.toEqual([]);
    expect(h.rpc).not.toHaveBeenCalled();
  });
});

describe('listAllocations', () => {
  it('reads the allocation rows with the quantity as text (money-honest exact figures)', async () => {
    h.push({ data: [{ id: 'a1', section_id: 's1', item_id: 'i1', quantity: '2.500' }], error: null });
    await expect(listAllocations('wo1')).resolves.toEqual([{ id: 'a1', sectionId: 's1', itemId: 'i1', quantity: '2.500' }]);
    expect(h.calls.select).toContainEqual('id, section_id, item_id, quantity::text');
  });
});

describe('setAllocation', () => {
  const existingRead = (id: string | null) => ({ data: id ? { id } : null, error: null });

  it('a quantity on an unallocated pair inserts a new allocation row', async () => {
    h.push(existingRead(null));
    h.push({ data: null, error: null });
    await setAllocation('wo1', 's1', 'i1', '3');
    expect(h.calls.insert).toEqual([{ work_order_id: 'wo1', section_id: 's1', item_id: 'i1', quantity: 3 }]);
  });

  it('a quantity on an already allocated pair updates that row', async () => {
    h.push(existingRead('a1'));
    h.push({ data: null, error: null });
    await setAllocation('wo1', 's1', 'i1', '4.5');
    expect(h.calls.update).toEqual([{ quantity: 4.5 }]);
    expect(h.calls.eq).toContainEqual(['id', 'a1']);
    expect(h.calls.insert).toEqual([]);
  });

  it('null removes an existing allocation and is a no-op when none exists', async () => {
    h.push(existingRead('a1'));
    h.push({ data: null, error: null });
    await setAllocation('wo1', 's1', 'i1', null);
    expect(h.calls.delete.length).toBe(1);
    expect(h.calls.eq).toContainEqual(['id', 'a1']);

    h.from.mockClear();
    h.push(existingRead(null));
    await setAllocation('wo1', 's1', 'i1', null);
    expect(h.from).toHaveBeenCalledTimes(1); // only the existence read
  });

  it('a failed write surfaces the database code', async () => {
    h.push(existingRead(null));
    h.push({ data: null, error: { message: 'over plan', code: 'P0001' } });
    await expect(setAllocation('wo1', 's1', 'i1', '99')).rejects.toMatchObject({ code: 'P0001' });
  });
});

describe('getMaterialCheck', () => {
  it('maps the check rows, keeping a null plan for the unsectioned remainder and the over-allocation flag', async () => {
    h.push({
      data: [
        { section_id: 's1', item_id: 'i1', plan_qty: 10, requested_qty: '4', remaining_qty: 6, work_order_plan_qty: '12', over_allocated: false },
        { section_id: null, item_id: 'i2', plan_qty: null, requested_qty: 0, remaining_qty: null, work_order_plan_qty: 5, over_allocated: true },
      ],
      error: null,
    });
    await expect(getMaterialCheck('wo1')).resolves.toEqual([
      { sectionId: 's1', itemId: 'i1', planQty: 10, requestedQty: 4, remainingQty: 6, workOrderPlanQty: 12, overAllocated: false },
      { sectionId: null, itemId: 'i2', planQty: null, requestedQty: 0, remainingQty: null, workOrderPlanQty: 5, overAllocated: true },
    ]);
    expect(h.calls.rpc).toEqual([['work_order_section_material_check', { p_work_order_id: 'wo1' }]]);
  });

  it('a refusal keeps its code', async () => {
    h.push({ data: null, error: { message: 'denied', code: '42501' } });
    await expect(getMaterialCheck('wo1')).rejects.toMatchObject({ code: '42501' });
  });
});
