import { describe, it, expect, vi, beforeEach } from 'vitest';

// Chainable, thenable query-builder mock (the stockMaster.test.ts harness): each awaited builder shifts the next queued result.
const h = vi.hoisted(() => {
  const queue: Array<{ data: unknown; error: unknown }> = [];
  const calls: Record<string, unknown[]> = { from: [], select: [], eq: [], insert: [], update: [], delete: [] };
  const builder: Record<string, unknown> = {};
  for (const n of ['select', 'eq', 'insert', 'update', 'delete']) builder[n] = (...a: unknown[]) => { calls[n].push(a.length === 1 ? a[0] : a); return builder; };
  builder.order = () => builder;
  builder.then = (resolve: (v: unknown) => unknown) => resolve(queue.shift() ?? { data: [], error: null });
  const from = vi.fn((t: string) => { calls.from.push(t); return builder; });
  return { from, calls, queue };
});
vi.mock('@/src/lib/supabase/client', () => ({ supabase: { from: h.from } }));

import { clearAllowance, listAllowances, setAllowance } from './stockAllowances';

beforeEach(() => { h.queue.length = 0; h.from.mockClear(); for (const k of Object.keys(h.calls)) h.calls[k].length = 0; });

describe('stockAllowances DAL', () => {
  it('FR-STK-050 lists the project\'s allowances with the planned quantity as a decimal string', async () => {
    h.queue.push({ data: [{ id: 'a1', boq_item_id: 'b1', item_id: 'i1', planned_quantity: '60.5' }], error: null });
    const rows = await listAllowances('p1');
    expect(h.calls.from).toEqual(['boq_material_allowances']);
    expect(String(h.calls.select[0])).toContain('planned_quantity::text');
    expect(h.calls.eq).toContainEqual(['boq_items.project_id', 'p1']);
    expect(rows).toEqual([{ id: 'a1', boqItemId: 'b1', itemId: 'i1', plannedQuantity: '60.5' }]);
  });

  it('FR-STK-050 a new allowance is inserted with the quantity as typed and must land', async () => {
    h.queue.push({ data: [{ id: 'a1' }], error: null });
    await setAllowance({ boqItemId: 'b1', itemId: 'i1', plannedQuantity: '60.125' });
    expect(h.calls.insert[0]).toEqual({ boq_item_id: 'b1', item_id: 'i1', planned_quantity: '60.125' });
  });

  it('FR-STK-050 changing an allowance updates only its planned quantity', async () => {
    h.queue.push({ data: [{ id: 'a1' }], error: null });
    await setAllowance({ id: 'a1', boqItemId: 'b1', itemId: 'i1', plannedQuantity: '70' });
    expect(h.calls.update[0]).toEqual({ planned_quantity: '70' });
    expect(h.calls.eq).toContainEqual(['id', 'a1']);
    expect(h.calls.insert).toHaveLength(0);
  });

  it('AC-STK-024 a write RLS hid (zero rows) is a refusal, not a silent success', async () => {
    h.queue.push({ data: [], error: null });
    await expect(setAllowance({ id: 'a1', boqItemId: 'b1', itemId: 'i1', plannedQuantity: '70' })).rejects.toMatchObject({ code: '42501' });
    h.queue.push({ data: [], error: null });
    await expect(clearAllowance('a1')).rejects.toMatchObject({ code: '42501' });
  });

  it('AC-STK-024 a refused insert surfaces its code', async () => {
    h.queue.push({ data: null, error: { message: 'new row violates row-level security policy', code: '42501' } });
    await expect(setAllowance({ boqItemId: 'b1', itemId: 'i1', plannedQuantity: '1' })).rejects.toMatchObject({ code: '42501' });
  });

  it('FR-STK-050 clearing deletes by id', async () => {
    h.queue.push({ data: [{ id: 'a1' }], error: null });
    await clearAllowance('a1');
    expect(h.calls.delete).toHaveLength(1);
    expect(h.calls.eq).toContainEqual(['id', 'a1']);
  });
});
