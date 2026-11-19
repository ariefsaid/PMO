import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => {
  const queue: Array<{ data: unknown; error: unknown }> = [];
  const rpc = vi.fn(async () => queue.shift() ?? { data: null, error: null });
  return { rpc, queue };
});
vi.mock('@/src/lib/supabase/client', () => ({ supabase: { rpc: h.rpc } }));

import { archiveStockDocumentFile, getWorkOrderStockBalance } from './stockSiteWork';

beforeEach(() => { h.queue.length = 0; h.rpc.mockClear(); });

const row = (extra: Record<string, unknown> = {}) => ({
  work_order_id: 'wo1', item_id: 'i', item_code: 'FREE', item_name: 'Valve', unit_code: 'pc', warehouse_id: 'w', warehouse_code: 'YARD1', warehouse_kind: 'yard',
  tag_id: 't', tag_name: 'Owner supplied', zero_cost: true, received_qty: '6', moved_out_qty: '4', issued_qty: '0', on_site_qty: '2', ...extra,
});

describe('stockSiteWork DAL', () => {
  it('AC-SSW-010 a work order with no ledger rows reads as an empty list, not a zero row', async () => {
    h.queue.push({ data: [], error: null });
    expect(await getWorkOrderStockBalance({ workOrderId: 'wo1' })).toEqual([]);
    expect(h.rpc).toHaveBeenCalledWith('get_work_order_stock_balance', { p_work_order_id: 'wo1' });
  });

  it('AC-SSW-011 the org\'s own tag name travels through unchanged, with quantities as strings', async () => {
    h.queue.push({ data: [row()], error: null });
    const [r] = await getWorkOrderStockBalance({ workOrderId: 'wo1' });
    expect(r).toMatchObject({ tagName: 'Owner supplied', zeroCost: true, onSiteQty: '2', warehouseKind: 'yard' });
  });

  it('FR-SSW-031 value keys are absent when the server omitted them, present when it sent them', async () => {
    h.queue.push({ data: [row()], error: null });
    const [a] = await getWorkOrderStockBalance({ workOrderId: 'wo1' });
    expect('onSiteValue' in a).toBe(false);
    h.queue.push({ data: [row({ received_value: '0.00', moved_out_value: '0.00', issued_value: '0.00', on_site_value: '0.00' })], error: null });
    const [b] = await getWorkOrderStockBalance({ projectId: 'p1' });
    expect(b.onSiteValue).toBe('0.00');
    expect(h.rpc).toHaveBeenLastCalledWith('get_work_order_stock_balance', { p_project_id: 'p1' });
  });

  it('FR-SSW-032 an unassigned bucket keeps workOrderId null', async () => {
    h.queue.push({ data: [row({ work_order_id: null })], error: null });
    expect((await getWorkOrderStockBalance({ projectId: 'p1' }))[0].workOrderId).toBeNull();
  });

  it('a database refusal reaches the caller with its message', async () => {
    h.queue.push({ data: null, error: { message: 'STK_INVALID: archiving needs a reason', code: 'P0001' } });
    await expect(archiveStockDocumentFile('f1', ' ')).rejects.toMatchObject({ message: expect.stringContaining('archiving needs a reason') });
  });
});
