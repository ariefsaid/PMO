import { readFileSync } from 'node:fs';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AppError } from '@/src/lib/appError';

const h = vi.hoisted(() => {
  const queue: Array<{ data: unknown; error: unknown }> = [];
  const rpc = vi.fn(async () => queue.shift() ?? { data: null, error: null });
  return { rpc, queue };
});
vi.mock('@/src/lib/supabase/client', () => ({ supabase: { rpc: h.rpc } }));

import { getStockLedgerAll, getStockLedgerPage, getStockOnHand } from './stockReports';

const row = (seq: number) => ({ seq, id: `id${seq}`, document_id: 'd', document_number: 'R-1', document_status: 'Posted', kind: 'receive', posted_at: 't', occurred_on: '2026-10-01', posted_by: 'u', actor_name: 'A', item_id: 'i', item_code: 'C', item_name: 'N', unit_code: 'bag', warehouse_id: 'w', warehouse_code: 'W', project_id: null, project_name: null, boq_item_id: null, boq_item_code: null, qty_delta: '1', qty_after: '1' });

beforeEach(() => { h.queue.length = 0; h.rpc.mockClear(); });

describe('stockReports DAL', () => {
  it('FR-STK-040 on hand maps rows to camelCase and omits cost keys the server omitted', async () => {
    h.queue.push({ data: [{ item_id: 'i', item_code: 'C', item_name: 'N', unit_code: 'bag', whole_only: true, warehouse_id: 'w', warehouse_code: 'W', warehouse_name: 'Wh', warehouse_kind: 'site', qty_on_hand: '70' }], error: null });
    const rows = await getStockOnHand({ warehouseId: 'w' });
    expect(h.rpc).toHaveBeenCalledWith('get_stock_on_hand', { p_warehouse_id: 'w' });
    expect(rows[0]).toMatchObject({ itemCode: 'C', qtyOnHand: '70', wholeOnly: true });
    expect('valueOnHand' in rows[0]).toBe(false);
  });

  it('FR-STK-041 the trace follows next_before_seq until null and returns every page once', async () => {
    h.queue.push({ data: { rows: [row(9), row(8)], next_before_seq: 8 }, error: null });
    h.queue.push({ data: { rows: [row(7), row(6)], next_before_seq: 6 }, error: null });
    h.queue.push({ data: { rows: [row(5)], next_before_seq: null }, error: null });
    const all = await getStockLedgerAll({ itemId: 'i' });
    expect(all.map((r) => r.seq)).toEqual([9, 8, 7, 6, 5]);
    expect(h.rpc).toHaveBeenCalledTimes(3);
    expect(h.rpc.mock.calls[1]).toEqual(['get_stock_ledger', expect.objectContaining({ p_before_seq: 8, p_item_id: 'i' })]);
  });

  it('a page carries its cursor', async () => {
    h.queue.push({ data: { rows: [row(3)], next_before_seq: 3 }, error: null });
    const p = await getStockLedgerPage({ projectId: 'p', limit: 50 });
    expect(p.nextBeforeSeq).toBe(3);
    expect(h.rpc.mock.calls[0]).toEqual(['get_stock_ledger', { p_project_id: 'p', p_limit: 50 }]);
  });

  it('FR-STK-044 the trace throws STK_TOO_MANY at the page cap instead of truncating', async () => {
    for (let i = 0; i < 5; i++) h.queue.push({ data: { rows: [row(100 - i)], next_before_seq: 100 - i }, error: null });
    await expect(getStockLedgerAll({}, { maxPages: 3 })).rejects.toMatchObject({ code: 'STK_TOO_MANY' });
  });

  it('FR-STK-044 a failed report RPC throws; it never resolves to an empty array', async () => {
    h.queue.push({ data: null, error: { message: 'boom', code: '500' } });
    await expect(getStockOnHand({})).rejects.toBeInstanceOf(AppError);
  });

  it('NFR-STK-007 the report DAL never turns a quantity into a JS number', () => {
    expect(readFileSync('src/lib/db/stockReports.ts', 'utf8')).not.toMatch(/parseFloat|Number\(/);
  });
});
