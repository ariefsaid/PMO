import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock('@/src/lib/supabase/client', () => ({ supabase: { rpc: h.rpc, from: vi.fn() } }));

import { PLAN_LIMIT, getPlanCandidates, getUnacceptedProgressCandidates, saveMonthTarget, savePlanSettings } from './billingPlan';

beforeEach(() => { h.rpc.mockReset().mockResolvedValue({ data: [], error: null }); });

const row = (i: number) => ({
  kind: 'line', project_id: 'p', project_name: 'P', currency: 'IDR', work_order_id: 'w', wo_number: 'WO-1', boq_item_id: `b${i}`, item_code: 'I', description: 'D',
  unit: 'm', earning_basis: 'unit_rate', rate: 10, contract_quantity: '100', accepted_quantity: '12', claimed_quantity: '5', unclaimed_quantity: '7',
  value: '70.00', accepted_on: '2026-05-04', today: '2026-11-21',
});

describe('billing plan DAL (#2682)', () => {
  it('AC-MBP-014 maps rows, passes the project filter and says when the database cut the list', async () => {
    h.rpc.mockResolvedValue({ data: Array.from({ length: PLAN_LIMIT + 1 }, (_, i) => row(i)), error: null });
    const r = await getPlanCandidates('p1');
    expect(h.rpc).toHaveBeenCalledWith('billing_plan_candidates', { p_project: 'p1' });
    expect(r.truncated).toBe(true);
    expect(r.rows).toHaveLength(PLAN_LIMIT);
    expect(r.rows[0]).toMatchObject({ key: 'line:w:b0', value: 70, unclaimedQuantity: 7, acceptedOn: '2026-05-04' });
  });

  it('AC-MV-004 reads measured progress above client-accepted quantity through the bounded candidate RPC', async () => {
    h.rpc.mockResolvedValue({ data: [{ project_id: 'p1', project_name: 'P1', boq_item_id: 'b1', item_code: 'L1', description: 'Work', unit: 'm', quantity: '2.500', today: '2026-11-24' }], error: null });
    const r = await getUnacceptedProgressCandidates('p1');
    expect(h.rpc).toHaveBeenCalledWith('billing_unaccepted_progress', { p_project: 'p1' });
    expect(r).toEqual({ truncated: false, rows: [{ projectId: 'p1', projectName: 'P1', boqItemId: 'b1', itemCode: 'L1', description: 'Work', unit: 'm', quantity: '2.500', today: '2026-11-24' }] });
  });

  it('AC-MV-004 an empty or failed unaccepted-progress read remains distinct from a successful empty result', async () => {
    h.rpc.mockResolvedValueOnce({ data: [], error: null });
    await expect(getUnacceptedProgressCandidates(null)).resolves.toEqual({ rows: [], truncated: false });
    h.rpc.mockResolvedValueOnce({ data: null, error: { message: 'denied', code: '42501' } });
    await expect(getUnacceptedProgressCandidates(null)).rejects.toThrow('denied');
  });

  it('a failed read throws rather than returning an empty plan', async () => {
    h.rpc.mockResolvedValue({ data: null, error: { message: 'boom', code: '42501' } });
    await expect(getPlanCandidates(null)).rejects.toThrow('boom');
  });

  it('AC-MBP-015 the settings writers send every declared argument', async () => {
    await savePlanSettings({ monthlyTarget: 5000, targetCurrency: 'IDR', reminderOn: true });
    expect(h.rpc).toHaveBeenCalledWith('set_billing_plan_settings', { p_target: 5000, p_currency: 'IDR', p_reminder_on: true });
    await saveMonthTarget('2026-12-01', null);
    expect(h.rpc).toHaveBeenCalledWith('set_billing_plan_month_target', { p_month: '2026-12-01', p_target: null });
  });

  it('a refused write surfaces its reason code', async () => {
    h.rpc.mockResolvedValue({ data: null, error: { message: 'x', code: '23514', details: 'target-currency-missing' } });
    await expect(savePlanSettings({ monthlyTarget: 1, targetCurrency: null, reminderOn: false })).rejects.toMatchObject({ code: 'target-currency-missing' });
  });
});
