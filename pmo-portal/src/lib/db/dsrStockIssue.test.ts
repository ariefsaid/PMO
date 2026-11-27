import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => {
  const queue: Array<{ data: unknown; error: unknown }> = [];
  const rpc = vi.fn(async () => queue.shift() ?? { data: null, error: null });
  const maybeSingle = vi.fn(async () => queue.shift() ?? { data: null, error: null });
  const update = vi.fn();
  const query: Record<string, unknown> = {};
  Object.assign(query, {
    select: () => query, order: () => query, eq: () => query, range: () => query, in: () => query, is: () => query, limit: () => query, maybeSingle,
    update: (v: unknown) => { update(v); return query; },
    then: (r: (v: unknown) => void) => r(queue.shift() ?? { data: [], error: null }),
  });
  return { rpc, queue, query, update };
});
vi.mock('@/src/lib/supabase/client', () => ({ supabase: { rpc: h.rpc, from: () => h.query } }));

import { getDsrStockSettings, getDsrStockStatus, isFlaggedLine, listDsrStockFlags, setDsrStockSettings, setWorkOrderSiteLocation } from './dsrStockIssue';

beforeEach(() => { h.queue.length = 0; h.rpc.mockClear(); h.update.mockClear(); });

describe('dsrStockIssue DAL', () => {
  it('AC-DRS-020 the setting reads off unless the organisation turned it on, and a failed read counts as off', async () => {
    h.queue.push({ data: null, error: null });
    expect(await getDsrStockSettings()).toEqual({ enabled: false, items: 'all' });
    h.queue.push({ data: null, error: { message: 'nope' } });
    expect(await getDsrStockSettings()).toEqual({ enabled: false, items: 'all' });
    h.queue.push({ data: [{ dsr_stock_issue: true, dsr_stock_issue_items: 'consumables' }], error: null });
    expect(await getDsrStockSettings()).toEqual({ enabled: true, items: 'consumables' });
  });

  it('AC-DRS-020 the setting is written only through the Admin RPC', async () => {
    await setDsrStockSettings(true, 'consumables');
    expect(h.rpc).toHaveBeenCalledWith('set_dsr_stock_issue', { p_on: true, p_items: 'consumables' });
    h.queue.push({ data: null, error: { message: 'STK_FORBIDDEN: only an Admin changes whether site reports post stock', code: '42501' } });
    await expect(setDsrStockSettings(false, 'all')).rejects.toBeTruthy();
  });

  it('AC-DRS-020 the status read maps states, quantities as strings and the short-by', async () => {
    h.queue.push({ data: {
      state: 'partial', reason: null, occurred_on: '2026-11-18', reversed: false, location: 'Site one', document_number: 'ISS-0001',
      lines: [{ consumable_id: 'c1', position: 1, item_code: 'ROD', item_name: 'Rod', unit: 'pc', quantity: '50', state: 'short', short_by: '43', reason: null },
              { consumable_id: 'c2', position: 2, item_code: 'FLG', item_name: 'Flange', unit: 'pc', quantity: '2', state: 'posted', short_by: null, reason: null }],
    }, error: null });
    const s = await getDsrStockStatus('r1');
    expect(h.rpc).toHaveBeenCalledWith('dsr_stock_status', { p_report: 'r1' });
    expect(s?.documentNumber).toBe('ISS-0001');
    expect(s?.lines[0]).toMatchObject({ state: 'short', shortBy: '43', quantity: '50' });
    expect(s?.lines.filter((l) => isFlaggedLine(l.state)).map((l) => l.itemCode)).toEqual(['ROD']);
  });

  it('AC-DRS-020 no posting reads as null', async () => {
    h.queue.push({ data: null, error: null });
    expect(await getDsrStockStatus('r1')).toBeNull();
  });

  it('AC-DRS-018 the list flags come back as a set and an empty list asks nothing', async () => {
    expect((await listDsrStockFlags([])).size).toBe(0);
    h.queue.push({ data: [{ report_id: 'r1' }], error: null });
    expect([...(await listDsrStockFlags(['r1', 'r2']))]).toEqual(['r1']);
  });

  it('AC-DRS-015 the site location is written only through the RPC; the database guard decides', async () => {
    await setWorkOrderSiteLocation('wo', 'wh');
    expect(h.rpc).toHaveBeenCalledWith('set_work_order_site_location', { p_work_order_id: 'wo', p_warehouse_id: 'wh' });
    await setWorkOrderSiteLocation('wo', null);
    expect(h.rpc).toHaveBeenLastCalledWith('set_work_order_site_location', { p_work_order_id: 'wo', p_warehouse_id: null });
    expect(h.update).not.toHaveBeenCalled();
  });
});
