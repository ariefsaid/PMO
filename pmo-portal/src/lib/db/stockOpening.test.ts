import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({ rpc: vi.fn(), queue: [] as Array<{ data: unknown; error: unknown }> }));
h.rpc.mockImplementation(async () => h.queue.shift() ?? { data: null, error: null });
vi.mock('@/src/lib/supabase/client', () => ({ supabase: { rpc: h.rpc } }));

import { loadOpeningHistory, previewOpeningHistory } from './stockOpening';

const row = { date: '2026-01-15', location: 'WH-01', item: 'CEM-50', direction: 'in' as const, quantity: '10', unitCost: '', reference: '' };
beforeEach(() => { h.queue.length = 0; h.rpc.mockClear(); });

describe('stockOpening DAL', () => {
  it('AC-OSH-013 preview sends each row with blank cost and reference as null, and the go-live date', async () => {
    h.queue.push({ data: [], error: null });
    await previewOpeningHistory('2026-02-01', [row]);
    expect(h.rpc).toHaveBeenCalledWith('preview_stock_opening_history', {
      p_as_of: '2026-02-01',
      p_lines: [{ date: '2026-01-15', location: 'WH-01', item: 'CEM-50', direction: 'in', quantity: '10', unit_cost: null, reference: null }],
    });
  });
  it('AC-OSH-013 preview maps the verdict rows and keeps a refusal as its protocol text', async () => {
    h.queue.push({ data: [{
      row_no: 2, verdict: 'refused', message: 'OPN_OVER_ISSUE: row 2', location_code: 'WH-01', item_code: 'CEM-50', warehouse_id: 'w', item_id: 'i',
      occurred_on: '2026-01-16', direction: 'out', quantity: 9, unit_cost: null, reference: null, zero_cost: false, run_qty: 5, run_val: 10,
    }], error: null });
    const rows = await previewOpeningHistory('2026-02-01', [row]);
    expect(rows).toEqual([{
      rowNo: 2, verdict: 'refused', message: 'OPN_OVER_ISSUE: row 2', locationCode: 'WH-01', itemCode: 'CEM-50', occurredOn: '2026-01-16', direction: 'out',
      quantity: 9, unitCost: null, reference: null, zeroCost: false, runQty: 5, runVal: 10,
    }]);
  });
  it('AC-OSH-008 confirm sends the one request id and returns the opening ids', async () => {
    h.queue.push({ data: ['o-1'], error: null });
    const ids = await loadOpeningHistory('2026-02-01', [row], 'req-1', 'first load');
    expect(ids).toEqual(['o-1']);
    expect(h.rpc).toHaveBeenCalledWith('load_stock_opening_history', expect.objectContaining({ p_as_of: '2026-02-01', p_client_request_id: 'req-1', p_note: 'first load' }));
  });
  it('AC-OSH-003 a refusal from the database reaches the caller with its code in the message', async () => {
    h.queue.push({ data: null, error: { message: 'OPN_OVER_ISSUE: row 2', code: 'P0001' } });
    await expect(loadOpeningHistory('2026-02-01', [row], 'req-2')).rejects.toThrow('OPN_OVER_ISSUE: row 2');
  });
});
