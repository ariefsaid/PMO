import { beforeEach, describe, expect, it, vi } from 'vitest';

/** #2634 — the DAL for the Admin setting and the receipt and bill line writers (1018 §8-10, 1357). */
const h = vi.hoisted(() => {
  const result = { value: { data: null as unknown, error: null as unknown } };
  const chain: Record<string, unknown> = {};
  chain.select = vi.fn(() => chain);
  chain.eq = vi.fn(() => Object.assign(Promise.resolve(result.value), { order: () => Promise.resolve(result.value) }));
  return { rpc: vi.fn(() => Promise.resolve(result.value)), from: vi.fn(() => chain), result, chain };
});
vi.mock('@/src/lib/supabase/client', () => ({ supabase: { rpc: h.rpc, from: h.from } }));
import {
  getRecordedMatchLines, getThreeWayMatchHeldCount, listOrderedItems, recordBillMatchLines, recordReceiptMatchLines, setThreeWayMatchSettings,
} from './threeWayMatch';

beforeEach(() => { h.rpc.mockClear(); h.from.mockClear(); h.result.value = { data: null, error: null }; });

describe('three-way match DAL — setting and line editors (#2634)', () => {
  it('AC-TWM-022 saves on/off and both tolerances and nothing else (no org, no actor)', async () => {
    h.result.value = { data: { enabled: true, quantity_tolerance_pct: '5.00', amount_tolerance_pct: '2.00' }, error: null };
    await expect(setThreeWayMatchSettings({ enabled: true, quantityTolerancePct: 5, amountTolerancePct: 2 }))
      .resolves.toEqual({ enabled: true, quantityTolerancePct: '5.00', amountTolerancePct: '2.00' });
    expect(h.rpc).toHaveBeenCalledWith('set_three_way_match_settings', { p_enabled: true, p_quantity_tolerance_pct: 5, p_amount_tolerance_pct: 2 });
  });

  it('AC-TWM-022 a non-Admin refusal keeps its SQLSTATE for the screen to explain', async () => {
    h.result.value = { data: null, error: { message: 'only an Admin sets the three-way match', code: '42501', details: null } };
    await expect(setThreeWayMatchSettings({ enabled: true, quantityTolerancePct: 0, amountTolerancePct: 0 })).rejects.toMatchObject({ code: '42501' });
  });

  it('AC-TWM-022 reads the held count through its definer', async () => {
    h.result.value = { data: 3, error: null };
    await expect(getThreeWayMatchHeldCount()).resolves.toBe(3);
    expect(h.rpc).toHaveBeenCalledWith('three_way_match_held_count', {});
  });

  it('AC-TWM-023 sends exactly item, quantity (and rate for a bill) through the two writers', async () => {
    await recordReceiptMatchLines('r1', [{ itemId: 'i1', quantity: 60 }]);
    expect(h.rpc).toHaveBeenLastCalledWith('record_receipt_match_lines', { p_receipt_id: 'r1', p_lines: [{ item_id: 'i1', quantity: 60 }] });
    h.result.value = { data: { status: 'matched', reasons: [], lines: [] }, error: null };
    const m = await recordBillMatchLines('b1', [{ itemId: 'i1', quantity: 60, rate: 1000 }]);
    expect(h.rpc).toHaveBeenLastCalledWith('record_bill_match_lines', { p_invoice_id: 'b1', p_lines: [{ item_id: 'i1', quantity: 60, rate: 1000 }] });
    expect(m.status).toBe('matched');
  });

  it('AC-TWM-023 a posted-state refusal keeps its machine detail', async () => {
    h.result.value = { data: null, error: { message: 'this bill is paid', code: '23514', details: 'three-way-match-posted' } };
    await expect(recordBillMatchLines('b1', [{ itemId: 'i1', quantity: 1, rate: 1 }])).rejects.toMatchObject({ code: 'three-way-match-posted' });
  });

  it('AC-TWM-023 reads the ordered items and the lines already recorded', async () => {
    h.result.value = { data: [{ id: 'i1', name: 'Cement', quantity: 100, rate: 1000 }], error: null };
    await expect(listOrderedItems('p1')).resolves.toEqual([{ id: 'i1', name: 'Cement', quantity: '100', rate: '1000' }]);
    h.result.value = { data: [{ item_id: 'i1', quantity: 60, rate: 1000 }], error: null };
    await expect(getRecordedMatchLines('bill', 'b1')).resolves.toEqual([{ itemId: 'i1', quantity: '60', rate: '1000' }]);
    expect(h.from).toHaveBeenLastCalledWith('procurement_bill_match_lines');
    h.result.value = { data: [{ item_id: 'i1', quantity: 60 }], error: null };
    await expect(getRecordedMatchLines('receipt', 'r1')).resolves.toEqual([{ itemId: 'i1', quantity: '60' }]);
    expect(h.from).toHaveBeenLastCalledWith('procurement_receipt_lines');
  });
});
