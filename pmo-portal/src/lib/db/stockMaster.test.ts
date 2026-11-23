import { describe, it, expect, vi, beforeEach } from 'vitest';

// Chainable, thenable query-builder mock: each awaited builder shifts the next queued result.
const h = vi.hoisted(() => {
  const queue: Array<{ data: unknown; error: unknown }> = [];
  const calls = { from: [] as string[], range: [] as unknown[], is: [] as unknown[], in: [] as unknown[], eq: [] as unknown[], insert: [] as unknown[], update: [] as unknown[], not: [] as unknown[] };
  const builder: Record<string, unknown> = {};
  const rec = (name: 'range' | 'is' | 'insert' | 'update' | 'in' | 'eq' | 'not') => (...a: unknown[]) => { calls[name].push(a.length === 1 ? a[0] : a); return builder; };
  for (const n of ['select', 'order', 'single']) builder[n] = () => builder;
  builder.range = rec('range'); builder.is = rec('is'); builder.insert = rec('insert'); builder.update = rec('update'); builder.in = rec('in'); builder.eq = rec('eq'); builder.not = rec('not');
  builder.then = (resolve: (v: unknown) => unknown) => resolve(queue.shift() ?? { data: [], error: null });
  const from = vi.fn((t: string) => { calls.from.push(t); return builder; });
  const rpc = vi.fn(async () => queue.shift() ?? { data: null, error: null });
  return { from, rpc, calls, queue };
});

vi.mock('@/src/lib/supabase/client', () => ({ supabase: { from: h.from, rpc: h.rpc } }));

import {
  archiveStockItem, createStockItem, listItemTagNames, listStockItems, setWarehouseKeeper, updateStockItem, updateStockUnit,
} from './stockMaster';

beforeEach(() => {
  h.queue.length = 0;
  h.from.mockClear(); h.rpc.mockClear();
  for (const k of Object.keys(h.calls) as Array<keyof typeof h.calls>) h.calls[k].length = 0;
});

describe('stockMaster DAL', () => {
  it('FR-STK-006 archiving sets archived_at and verifies the write landed', async () => {
    h.queue.push({ data: [], error: null }); // RLS-hidden: zero rows touched
    await expect(archiveStockItem('i1')).rejects.toMatchObject({ code: '42501' });
    expect(h.calls.update[0]).toMatchObject({ archived_at: expect.any(String) });
  });

  it('FR-STK-006 an update that touches no row is a refusal, not a silent success', async () => {
    h.queue.push({ data: [], error: null });
    await expect(updateStockUnit('u1', { code: 'kg', name: 'Kilogram', wholeOnly: false })).rejects.toMatchObject({ code: '42501' });
  });

  it('FR-STK-004 assigning a keeper calls the RPC and never writes the table', async () => {
    await setWarehouseKeeper({ warehouseId: 'w1', userId: 'u1', assigned: true });
    expect(h.rpc).toHaveBeenCalledWith('set_stock_warehouse_keeper', { p_warehouse_id: 'w1', p_user_id: 'u1', p_assigned: true });
    expect(h.from).not.toHaveBeenCalledWith('stock_warehouse_keepers');
  });

  it('FR-STK-004 a keeper RPC error surfaces as an AppError with its code', async () => {
    h.queue.push({ data: null, error: { message: 'only an Admin assigns warehouse keepers', code: '42501' } });
    await expect(setWarehouseKeeper({ warehouseId: 'w1', userId: 'u1', assigned: true })).rejects.toMatchObject({ code: '42501' });
  });

  it('FR-STK-001 lists page past the 1000-row cap (1,203 rows over three .range() pages, each once)', async () => {
    const rows = (n: number, from: number) => Array.from({ length: n }, (_, i) => ({ id: `r${from + i}` }));
    h.queue.push({ data: rows(500, 0), error: null }, { data: rows(500, 500), error: null }, { data: rows(203, 1000), error: null });
    const out = await listStockItems();
    expect(out).toHaveLength(1203);
    expect(new Set(out.map((r) => r.id)).size).toBe(1203);
    expect(h.calls.range).toEqual([[0, 499], [500, 999], [1000, 1499]]);
    expect(h.calls.is).toEqual([['archived_at', null], ['archived_at', null], ['archived_at', null]]);
  });

  it('FR-STK-001 listing refuses to truncate silently past the page ceiling', async () => {
    const full = Array.from({ length: 500 }, (_, i) => ({ id: `r${i}` }));
    for (let i = 0; i < 41; i++) h.queue.push({ data: full, error: null });
    await expect(listStockItems()).rejects.toMatchObject({ code: 'STK_TOO_MANY' });
  });

  it('FR-STK-001 listStockItems applies tagIds filter and limit to range', async () => {
    const rows = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `r${i}` }));
    h.queue.push({ data: rows(500), error: null });
    const out = await listStockItems({ tagIds: ['t1', 't2'], limit: 500 });
    expect(out).toHaveLength(500);
    expect(h.calls.in).toEqual([['tag_id', ['t1', 't2']]]);
    expect(h.calls.range).toEqual([[0, 499]]);
  });

  it('FR-SSW-010 reads only tagged items: the item id and the tag’s own configured name; an ordinary item is absent', async () => {
    h.queue.push({ data: [{ id: 'i1', tag: { name: 'Client supplied' } }, { id: 'i2', tag: null }], error: null });
    const out = await listItemTagNames();
    expect(out).toEqual([{ itemId: 'i1', tagName: 'Client supplied' }]);
    expect(h.calls.from).toEqual(['stock_items']);
    expect(h.calls.not).toEqual([['tag_id', 'is', null]]);
  });

  it('FR-SSW-010 a failed tag read is an error, never a silent empty list', async () => {
    h.queue.push({ data: null, error: { message: 'boom', code: '500' } });
    await expect(listItemTagNames()).rejects.toMatchObject({ code: '500' });
  });

  it('FR-STK-001 listStockItems with empty tagIds returns empty array without querying database', async () => {
    const out = await listStockItems({ tagIds: [] });
    expect(out).toEqual([]);
    expect(h.from).not.toHaveBeenCalledWith('stock_items');
  });

  it('FR-STK-002 creating an item trims text and never sends org_id', async () => {
    h.queue.push({ data: { id: 'i1' }, error: null });
    await createStockItem({ code: ' CEM ', name: ' Cement ', description: '  ', unitId: 'u1', leadTimeDays: 7 });
    expect(h.calls.insert[0]).toEqual({ code: 'CEM', name: 'Cement', description: null, unit_id: 'u1', lead_time_days: 7 });
  });

  it('AC-SKD-011 an item saves with its consumable flag on create and on edit, and a save that does not carry the flag does not send it', async () => {
    h.queue.push({ data: { id: 'i1' }, error: null });
    await createStockItem({ code: 'ROD', name: 'Welding rod', description: null, unitId: 'u1', leadTimeDays: null, consumable: true });
    expect(h.calls.insert[0]).toMatchObject({ code: 'ROD', consumable: true });
    h.queue.push({ data: [{ id: 'i1' }], error: null });
    await expect(updateStockItem('i1', { code: 'ROD', name: 'Welding rod', description: null, unitId: 'u1', leadTimeDays: null, consumable: false })).resolves.toBeUndefined();
    expect(h.calls.update[0]).toMatchObject({ consumable: false });
    h.queue.push({ data: [{ id: 'i1' }], error: null });
    await updateStockItem('i1', { code: 'ROD', name: 'Welding rod', description: null, unitId: 'u1', leadTimeDays: null });
    expect(h.calls.update[1]).not.toHaveProperty('consumable');
  });
});
