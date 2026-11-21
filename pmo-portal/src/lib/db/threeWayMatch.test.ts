import { beforeEach, describe, expect, it, vi } from 'vitest';

/** #2622 — the three-way match DAL reads a bill's match and carries an exception approval (1018's RPCs only). */
const h = vi.hoisted(() => {
  const result = { value: { data: null as unknown, error: null as unknown } };
  const chain: Record<string, unknown> = {};
  for (const k of ['select', 'maybeSingle']) chain[k] = vi.fn(() => (k === 'maybeSingle' ? Promise.resolve(result.value) : chain));
  return { rpc: vi.fn(() => Promise.resolve(result.value)), from: vi.fn(() => chain), result, chain };
});
vi.mock('@/src/lib/supabase/client', () => ({ supabase: { rpc: h.rpc, from: h.from } }));
import { approveBillMatchException, getBillMatch, getThreeWayMatchSettings, parseBillMatch } from './threeWayMatch';

const HELD = {
  status: 'held', reasons: ['amount_mismatch'], quantity_tolerance_pct: 5, amount_tolerance_pct: 2, exception: null,
  lines: [{ item_id: 'i1', item_name: 'Cable', ordered: 100, order_rate: 10, received: 60, billed_to_date: 80,
    bill_quantity: 80, bill_rate: 10.5, bill_amount: 840, reasons: ['over_received'] }],
};

beforeEach(() => { h.rpc.mockClear(); h.from.mockClear(); h.result.value = { data: null, error: null }; });

describe('three-way match DAL (#2622)', () => {
  it('AC-TWM-014 reads one bill\'s match through get_bill_match and maps order, receipt and bill per line', async () => {
    h.result.value = { data: HELD, error: null };
    const m = await getBillMatch('inv-1');
    expect(h.rpc).toHaveBeenCalledWith('get_bill_match', { p_invoice_id: 'inv-1' });
    expect(m).toMatchObject({ status: 'held', reasons: ['amount_mismatch'], quantityTolerancePct: '5', amountTolerancePct: '2', exception: null });
    expect(m.lines[0]).toEqual({ itemId: 'i1', itemName: 'Cable', ordered: '100', orderRate: '10', received: '60', billedToDate: '80',
      billQuantity: '80', billRate: '10.5', billAmount: '840', reasons: ['over_received'] });
  });

  it('AC-TWM-014 a malformed or empty result is an error, never a plausible status', () => {
    expect(() => parseBillMatch(null)).toThrow();
    expect(() => parseBillMatch({ status: 'fine' })).toThrow();
  });

  it('AC-TWM-015 approves an exception with the reason and nothing else (the database stamps who and when)', async () => {
    h.result.value = { data: { ...HELD, status: 'exception_approved', exception: { approved_by: 'u2', approved_at: '2026-11-20T01:00:00Z', reason: 'Agreed price' } }, error: null };
    const m = await approveBillMatchException('inv-1', 'Agreed price');
    expect(h.rpc).toHaveBeenCalledWith('approve_bill_match_exception', { p_invoice_id: 'inv-1', p_reason: 'Agreed price' });
    expect(m.exception).toEqual({ approvedBy: 'u2', approvedAt: '2026-11-20T01:00:00Z', reason: 'Agreed price' });
  });

  it('AC-TWM-015 a separation-of-duties refusal keeps its detail for the screen to explain', async () => {
    h.result.value = { data: null, error: { message: 'separation of duties', code: '42501', details: 'three-way-match-own-bill' } };
    await expect(approveBillMatchException('inv-1', 'x')).rejects.toMatchObject({ code: 'three-way-match-own-bill' });
    h.result.value = { data: null, error: { message: 'already', code: '23505', details: null } };
    await expect(approveBillMatchException('inv-1', 'x')).rejects.toMatchObject({ code: '23505' });
  });

  it('reads the organisation\'s setting; none recorded means off', async () => {
    h.result.value = { data: { enabled: true, quantity_tolerance_pct: 5, amount_tolerance_pct: 2 }, error: null };
    await expect(getThreeWayMatchSettings()).resolves.toEqual({ enabled: true, quantityTolerancePct: '5', amountTolerancePct: '2' });
    expect(h.from).toHaveBeenCalledWith('org_three_way_match_settings');
    h.result.value = { data: null, error: null };
    await expect(getThreeWayMatchSettings()).resolves.toBeNull();
  });
});
