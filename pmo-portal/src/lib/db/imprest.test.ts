import { describe, it, expect, vi, beforeEach } from 'vitest';

/** AC-IMP-080 — the imprest DAL sends only granted columns, never org/status/amount/number, and never a silently trimmed list. */
const h = vi.hoisted(() => {
  const result = { value: { data: null as unknown, error: null as unknown } };
  const calls = { from: [] as string[], rpc: [] as Array<[string, unknown]>, insert: [] as unknown[], upsert: [] as unknown[], update: [] as unknown[], in: [] as unknown[], limit: [] as unknown[], select: [] as unknown[], eq: [] as unknown[], deleted: 0 };
  const builder: Record<string, unknown> = {};
  const chain = (name?: 'insert' | 'upsert' | 'update' | 'in' | 'limit' | 'select' | 'eq') => (...a: unknown[]) => { if (name) calls[name].push(a.length === 1 ? a[0] : a); return builder; };
  for (const k of ['select', 'eq', 'limit', 'insert'] as const) builder[k] = chain(k);
  builder.upsert = chain('upsert');
  builder.is = chain(); builder.order = chain(); builder.single = chain(); builder.maybeSingle = chain(); builder.in = chain('in' as never);
  builder.update = chain('update' as never);
  builder.delete = () => { calls.deleted++; return builder; };
  builder.then = (resolve: (v: unknown) => unknown) => resolve(result.value);
  const from = vi.fn((t: string) => { calls.from.push(t); return builder; });
  const rpc = vi.fn((n: string, a?: unknown) => { calls.rpc.push([n, a]); return Promise.resolve(result.value); });
  return { from, rpc, calls, result };
});
vi.mock('@/src/lib/supabase/client', () => ({ supabase: { from: h.from, rpc: h.rpc } }));

import * as dal from './imprest';
const { LIST_LIMIT } = dal;

beforeEach(() => {
  h.from.mockClear(); h.rpc.mockClear();
  for (const k of Object.keys(h.calls) as (keyof typeof h.calls)[]) {
    if (typeof h.calls[k] === 'number') (h.calls[k] as unknown) = 0; else (h.calls[k] as unknown[]).length = 0;
  }
  h.result.value = { data: null, error: null };
});

describe('AC-IMP-080 one float by id', () => {
  it('AC-IMP-080 getFloat reads exactly that float, not the capped list', async () => {
    h.result.value = { data: { id: 'f1', custodian_id: 'c1' }, error: null };
    await expect(dal.getFloat('f1')).resolves.toMatchObject({ id: 'f1' });
    expect(h.calls.from).toEqual(['imprest_floats']);
    expect(h.calls.eq).toContainEqual(['id', 'f1']);
    expect(h.calls.limit).toEqual([]);
  });
});

describe('AC-IMP-080 table writes', () => {
  it('AC-IMP-080 createPlan sends only float_id and month', async () => {
    h.result.value = { data: { id: 'p1' }, error: null };
    await expect(dal.createPlan('f1', '2026-11-01')).resolves.toBe('p1');
    expect(h.calls.from).toEqual(['imprest_plans']);
    expect(Object.keys(h.calls.insert[0] as object).sort()).toEqual(['float_id', 'month']);
  });
  it('AC-IMP-080 savePlanLine sends only plan_id, budget_category, planned_amount', async () => {
    h.result.value = { data: [{ id: 'l1' }], error: null };
    await dal.savePlanLine('p1', 'Vehicle', 250000);
    expect(h.calls.upsert[0]).toEqual([{ plan_id: 'p1', budget_category: 'Vehicle', planned_amount: 250000 }, { onConflict: 'plan_id,budget_category' }]);
  });
  it('AC-IMP-080 a plan-line save or delete that lands no row is a 42501', async () => {
    h.result.value = { data: [], error: null };
    await expect(dal.savePlanLine('p1', 'Vehicle', 1)).rejects.toMatchObject({ code: '42501' });
    await expect(dal.deletePlanLine('l1')).rejects.toMatchObject({ code: '42501' });
    expect(h.calls.deleted).toBe(1);
  });
  it('AC-IMP-080 a database error surfaces as an AppError keeping its code', async () => {
    h.result.value = { data: null, error: { message: 'denied', code: '42501' } };
    await expect(dal.createPlan('f1', '2026-11-01')).rejects.toMatchObject({ message: 'denied', code: '42501' });
  });
});

describe('AC-IMP-080 RPC writes', () => {
  it('AC-IMP-080 RPC writes send no org_id, status, amount or number', async () => {
    h.result.value = { data: 'r1', error: null };
    await dal.requestReplenishment('f1');
    await dal.requestReplenishment('f1', 'funding');
    await dal.establishFloat('p1', 'u1', 1000000);
    await dal.proposeFloatAmount('f1', 2000000);
    await dal.decideFloatChange('c1', true);
    await dal.transitionPlan('pl1', 'Submitted');
    await dal.recordCount('f1', 5000, 'ok');
    await dal.setProcurementLimit(750000);
    expect(h.calls.rpc).toEqual([
      ['request_imprest_replenishment', { p_float: 'f1', p_kind: 'replenishment' }],
      ['request_imprest_replenishment', { p_float: 'f1', p_kind: 'funding' }],
      ['establish_imprest_float', { p_project: 'p1', p_custodian: 'u1', p_amount: 1000000 }],
      ['propose_imprest_float_amount', { p_float: 'f1', p_amount: 2000000 }],
      ['decide_imprest_float_change', { p_change: 'c1', p_approve: true, p_notes: null }],
      ['transition_imprest_plan', { p_id: 'pl1', p_to: 'Submitted', p_notes: null }],
      ['record_imprest_count', { p_float: 'f1', p_counted: 5000, p_note: 'ok' }],
      ['set_imprest_procurement_limit', { p_amount: 750000 }],
    ]);
  });
  it('AC-IMP-080 a payment reference travels only with Paid', async () => {
    await dal.transitionReplenishment('r1', 'Approved', { paymentReference: 'X' });
    await dal.transitionReplenishment('r1', 'Paid', { paymentReference: 'X', notes: 'n' });
    expect(h.calls.rpc[0][1]).toEqual({ p_id: 'r1', p_to: 'Approved', p_notes: null, p_payment_reference: null });
    expect(h.calls.rpc[1][1]).toEqual({ p_id: 'r1', p_to: 'Paid', p_notes: 'n', p_payment_reference: 'X' });
  });
  it('AC-IMP-080 an RPC error throws', async () => {
    h.result.value = { data: null, error: { message: 'separation of duties', code: '42501' } };
    await expect(dal.requestReplenishment('f1')).rejects.toMatchObject({ code: '42501' });
  });
});

describe('AC-IMP-080 reads', () => {
  it('AC-IMP-080 listFloats is bounded at 200 + 1 and reports truncated', async () => {
    h.result.value = { data: Array.from({ length: 201 }, (_, i) => ({ id: String(i) })), error: null };
    const r = await dal.listFloats();
    expect(r.rows).toHaveLength(200);
    expect(r.truncated).toBe(true);
    expect(h.calls.limit).toEqual([201]);
    expect(String(h.calls.select[0])).toContain('profiles!imprest_floats_custodian_id_fkey');
  });
  it('AC-IMP-080 a list at the limit is not truncated; a null result is empty', async () => {
    h.result.value = { data: Array.from({ length: 200 }, (_, i) => ({ id: String(i) })), error: null };
    expect((await dal.listReplenishments('f1')).truncated).toBe(false);
    h.result.value = { data: null, error: null };
    expect(await dal.listCounts('f1')).toEqual({ rows: [], truncated: false });
    expect(await dal.listPlanLines('p1')).toEqual([]);
  });
  it('AC-IMP-080 position, usage and choices call their read RPCs', async () => {
    h.result.value = { data: [{ float_id: 'f1' }], error: null };
    expect(await dal.getPosition('f1')).toEqual({ float_id: 'f1' });
    await dal.getPlanUsage('f1', '2026-11-01');
    await dal.floatChoices('p1', 'Vehicle');
    await dal.floatChoices('p1', null);
    expect(h.calls.rpc).toEqual([
      ['get_imprest_position', { p_float: 'f1' }],
      ['get_imprest_plan_usage', { p_float: 'f1', p_month: '2026-11-01' }],
      ['imprest_float_choices', { p_project: 'p1', p_category: 'Vehicle' }],
      ['imprest_float_choices', { p_project: 'p1', p_category: undefined }],
    ]);
    h.result.value = { data: [], error: null };
    expect(await dal.getPosition('f1')).toBeNull();
  });
  it('#1635 floatChoices returns the RPC row with the float currency and project name, no second read', async () => {
    h.calls.from.length = 0;
    const rows = [{ float_id: 'f1', custodian_name: 'Cass', remaining: 5, currency: 'USD', project_name: 'Harbour' }];
    h.result.value = { data: rows, error: null };
    expect(await dal.floatChoices('p1', null)).toEqual(rows);
    expect(h.calls.from).not.toContain('imprest_floats');
  });
});

describe('AC-IMP-084 form reads and the claim-to-float link', () => {
  it('AC-IMP-084 listFloatClaims reads the float\'s claims bounded at 200 + 1', async () => {
    h.result.value = { data: Array.from({ length: 201 }, (_, i) => ({ id: String(i) })), error: null };
    const r = await dal.listFloatClaims('f1');
    expect(r.rows).toHaveLength(200);
    expect(r.truncated).toBe(true);
    expect(h.calls.from).toEqual(['expense_claims']);
    expect(h.calls.eq).toContainEqual(['imprest_float_id', 'f1']);
    expect(h.calls.limit).toEqual([201]);
  });
  it('AC-IMP-084 setClaimFloat writes only imprest_float_id and a no-row result is a 42501', async () => {
    h.result.value = { data: [{ id: 'c1' }], error: null };
    await dal.setClaimFloat('c1', 'f1');
    expect(h.calls.from).toEqual(['expense_claims']);
    expect(h.calls.update[0]).toEqual({ imprest_float_id: 'f1' });
    h.result.value = { data: [], error: null };
    await expect(dal.setClaimFloat('c1', 'f1')).rejects.toMatchObject({ code: '42501' });
  });
  it('AC-IMP-084 getProcurementLimit reads the org row as a number and is null when none is set', async () => {
    h.result.value = { data: { procurement_limit: '750000.00' }, error: null };
    expect(await dal.getProcurementLimit()).toBe(750000);
    expect(h.calls.from).toEqual(['org_imprest_settings']);
    h.result.value = { data: null, error: null };
    expect(await dal.getProcurementLimit()).toBeNull();
  });
});

describe('FR-IMP-073 awaiting reads', () => {
  it('FR-IMP-073 listAwaitingImprest reads Submitted plans and Requested/Approved replenishments, each bounded', async () => {
    h.result.value = { data: [{ id: 'x' }], error: null };
    const out = await dal.listAwaitingImprest();
    expect(h.calls.from).toEqual(['imprest_plans', 'imprest_replenishments']);
    expect(h.calls.eq).toContainEqual(['status', 'Submitted']);
    expect(h.calls.in).toContainEqual(['status', ['Requested', 'Approved']]);
    expect(out.plans).toEqual([{ id: 'x' }]);
    expect(out.replenishments).toEqual([{ id: 'x' }]);
    expect(h.calls.limit).toEqual([LIST_LIMIT, LIST_LIMIT]);
  });
  it('FR-IMP-073 a failed awaiting read throws rather than returning an empty inbox', async () => {
    h.result.value = { data: null, error: { message: 'denied', code: '42501' } };
    await expect(dal.listAwaitingImprest()).rejects.toMatchObject({ code: '42501' });
  });
});

describe('FR-IMP-002 float amount changes', () => {
  it('FR-IMP-002 listFloatChanges reads the float\'s changes bounded at 200 + 1', async () => {
    h.result.value = { data: Array.from({ length: 201 }, (_, i) => ({ id: String(i) })), error: null };
    const r = await dal.listFloatChanges('f1');
    expect(r.truncated).toBe(true);
    expect(h.calls.from).toEqual(['imprest_float_changes']);
    expect(h.calls.eq).toContainEqual(['float_id', 'f1']);
  });
});
