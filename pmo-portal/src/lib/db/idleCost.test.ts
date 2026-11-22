import { beforeEach, describe, expect, it, vi } from 'vitest';

/** #2673: the idle cost read maps rows, rejects an unreadable one, and sums exactly. */
const h = vi.hoisted(() => ({ rpc: vi.fn(), single: vi.fn() }));
vi.mock('@/src/lib/supabase/client', () => ({
  supabase: { rpc: h.rpc, from: () => ({ select: () => ({ maybeSingle: h.single }) }) },
}));
import { getIdleCostEnabled, getIdleCostScope, listProjectIdleCost, setIdleCostEnabled, setIdleCostScope, totalIdleAmount, type IdleCostRow } from './idleCost';

const rawFull = { people_amount: '281250.00', equipment_amount: '50000.00', headcount_hours: '4.50' };
const raw = { work_order_id: 'w1', reason_id: 'r1', reason_label: 'Rain', minutes: 90, hours: '1.50', hourly_cost: '50000.00', amount: '75000.00', currency: 'IDR', reason: 'counted' };
beforeEach(() => { h.rpc.mockReset(); h.single.mockReset(); });

describe('idle cost DAL', () => {
  it('AC-IHC-003 maps a row, amounts stay exact text', async () => {
    h.rpc.mockResolvedValue({ data: [raw], error: null });
    const rows = await listProjectIdleCost('p1');
    expect(h.rpc).toHaveBeenCalledWith('work_order_idle_cost', { p_project_id: 'p1' });
    expect(rows[0]).toMatchObject({ workOrderId: 'w1', reasonLabel: 'Rain', minutes: 90, hours: '1.50', amount: '75000.00', reason: 'counted' });
  });
  it('AC-IHC-007 a no-rate row keeps hours and a null amount', async () => {
    h.rpc.mockResolvedValue({ data: [{ ...raw, hourly_cost: null, amount: null, reason: 'no-rate' }], error: null });
    expect((await listProjectIdleCost('p1'))[0]).toMatchObject({ amount: null, reason: 'no-rate' });
  });
  it('AC-IHC-005 a Project Manager reads the amount with no hourly cost (migration 1298 withholds it)', async () => {
    h.rpc.mockResolvedValue({ data: [{ ...raw, hourly_cost: null }], error: null });
    expect((await listProjectIdleCost('p1'))[0]).toMatchObject({ hourlyCost: null, amount: '75000.00', reason: 'counted' });
  });
  it('rejects an unreadable amount instead of showing a plausible figure', async () => {
    h.rpc.mockResolvedValue({ data: [{ ...raw, amount: '7.5e4' }], error: null });
    await expect(listProjectIdleCost('p1')).rejects.toThrow();
  });
  it('AC-IHC-009 a refusal keeps its code', async () => {
    h.rpc.mockResolvedValue({ data: null, error: { message: 'not authorized', code: '42501' } });
    await expect(listProjectIdleCost('p1')).rejects.toMatchObject({ code: '42501' });
  });
  it('AC-IHC-001 no setting row means off', async () => {
    h.single.mockResolvedValue({ data: null, error: null });
    expect(await getIdleCostEnabled()).toBe(false);
  });
  it('AC-IHC-008 the switch is written through the RPC', async () => {
    h.rpc.mockResolvedValue({ error: null });
    await setIdleCostEnabled(true);
    expect(h.rpc).toHaveBeenCalledWith('save_idle_cost_setting', { p_enabled: true });
  });
  it('AC-IHC-010 totals priced rows to the cent and ignores no-rate rows', () => {
    const r = (amount: string | null): IdleCostRow => ({ ...raw, workOrderId: 'w1', reasonId: amount ?? 'n', reasonLabel: 'x', minutes: 1, hours: '1.00', hourlyCost: null, amount, reason: amount ? 'counted' : 'no-rate', peopleAmount: null, equipmentAmount: null, headcountHours: null }) as IdleCostRow;
    expect(totalIdleAmount([r('0.10'), r('0.20'), r(null)])).toBe('0.30');
    expect(totalIdleAmount([r(null)])).toBeNull();
  });
  it('AC-IWR-001 a row from the default scope carries no people, equipment or head-count figure', async () => {
    h.rpc.mockResolvedValue({ data: [{ ...raw, people_amount: null, equipment_amount: null, headcount_hours: null }], error: null });
    expect((await listProjectIdleCost('p1'))[0]).toMatchObject({ peopleAmount: null, equipmentAmount: null, headcountHours: null });
  });
  it('AC-IWR-002 maps people, equipment and head-count hours as exact text', async () => {
    h.rpc.mockResolvedValue({ data: [{ ...raw, ...rawFull, amount: '331250.00' }], error: null });
    expect((await listProjectIdleCost('p1'))[0]).toMatchObject({ peopleAmount: '281250.00', equipmentAmount: '50000.00', headcountHours: '4.50', amount: '331250.00' });
  });
  it('AC-IWR-002 rejects an unreadable people or equipment figure', async () => {
    h.rpc.mockResolvedValue({ data: [{ ...raw, ...rawFull, equipment_amount: '5e4' }], error: null });
    await expect(listProjectIdleCost('p1')).rejects.toThrow();
    h.rpc.mockResolvedValue({ data: [{ ...raw, ...rawFull, people_amount: 'abc' }], error: null });
    await expect(listProjectIdleCost('p1')).rejects.toThrow();
  });
  it('AC-IWR-001 no setting row means the default scope, labour_average', async () => {
    h.single.mockResolvedValue({ data: null, error: null });
    expect(await getIdleCostScope()).toBe('labour_average');
    h.single.mockResolvedValue({ data: { scope: 'people_and_equipment' }, error: null });
    expect(await getIdleCostScope()).toBe('people_and_equipment');
  });
  it('AC-IWR-010 the scope is written through the RPC and a refusal keeps its code', async () => {
    h.rpc.mockResolvedValue({ error: null });
    await setIdleCostScope('people_and_equipment');
    expect(h.rpc).toHaveBeenCalledWith('save_idle_cost_scope', { p_scope: 'people_and_equipment' });
    h.rpc.mockResolvedValue({ error: { message: 'not authorized', code: '42501' } });
    await expect(setIdleCostScope('labour_average')).rejects.toMatchObject({ code: '42501' });
  });
});
