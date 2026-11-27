import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AppError } from '@/src/lib/appError';

/**
 * #2519 — plan versus actual DAL + repository. The money read is paged and validated (a malformed amount is an error,
 * never a figure); a refused money read becomes "restricted" (AC-WPVA-009); writes never send org_id.
 */
const h = vi.hoisted(() => {
  const queue: Array<{ data: unknown; error: unknown }> = [];
  const calls = { from: [] as string[], rpc: [] as Array<[string, unknown]>, insert: [] as unknown[], update: [] as unknown[], eq: [] as unknown[], range: [] as unknown[], select: [] as unknown[] };
  const next = () => queue.shift() ?? { data: [], error: null };
  const builder: Record<string, unknown> = {};
  const chain = (name?: keyof typeof calls) => (...a: unknown[]) => { if (name) (calls[name] as unknown[]).push(a.length === 1 ? a[0] : a); return builder; };
  for (const k of ['order', 'limit', 'delete'] as const) builder[k] = chain();
  builder.select = chain('select');
  builder.eq = chain('eq'); builder.range = chain('range'); builder.insert = chain('insert'); builder.update = chain('update');
  builder.then = (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) => Promise.resolve(next()).then(resolve, reject);
  const from = vi.fn((t: string) => { calls.from.push(t); return builder; });
  const rpc = vi.fn((n: string, a?: unknown) => { calls.rpc.push([n, a]); return builder; });
  return { from, rpc, calls, queue };
});
vi.mock('@/src/lib/supabase/client', () => ({ supabase: { from: h.from, rpc: h.rpc } }));
vi.mock('@/src/lib/db/workOrders', () => ({
  listProjectWorkOrders: vi.fn(async () => [
    { id: 'B', wo_number: 'WO-2', title: 'Two', status: 'Issued', currency: 'IDR' },
    { id: 'A', wo_number: 'WO-1', title: 'One', status: 'Issued', currency: 'IDR' },
  ]),
}));
vi.mock('@/src/lib/db/revenue', () => ({
  parseProjectFinances: (data: unknown) => data,
  getProjectFinances: vi.fn(async () => ({ invoices: [{ currency: 'IDR', work_revenue: '2000.00', missing_work: 0 }] })),
}));
vi.mock('@/src/lib/db/workOrderBilling', async (importOriginal) => ({
  ...await importOriginal<object>(),
  listWorkOrderBilling: vi.fn(async () => [
    { workOrderId: 'A', currency: 'IDR', invoiced: 1000, orderNet: 1500, figuresComplete: true },
    { workOrderId: 'B', currency: 'IDR', invoiced: 500, orderNet: 0, figuresComplete: true },
  ]),
}));

import * as dal from './workOrderFinance';
import { workOrderFinanceRepository } from '@/src/lib/repositories/workOrderFinance';

const row = (extra: Record<string, unknown>) => ({
  source: 'vendor_bill', record_id: `r${Math.random()}`, project_id: 'p1', work_order_id: null, discipline_id: null, occurred_on: '2026-11-16',
  reference: null, currency: 'IDR', amount: '0.00', reason: 'counted', quantity: null, quantity_unit: null, person_id: null, ...extra,
});

beforeEach(() => {
  h.from.mockClear(); h.rpc.mockClear(); h.queue.length = 0;
  for (const v of Object.values(h.calls)) (v as unknown[]).length = 0;
});

describe('listProjectCostAmounts', () => {
  it('reads the one money RPC by project, paged, and keeps exact amounts', async () => {
    h.queue.push({ data: [row({ amount: '600.00', work_order_id: 'A' })], error: null });
    const lines = await dal.listProjectCostAmounts('p1');
    expect(h.calls.rpc).toEqual([['work_order_cost_amounts', { p_project_id: 'p1' }]]);
    expect(h.calls.range).toEqual([[0, 999]]);
    expect(lines[0]).toMatchObject({ amount: '600.00', workOrderId: 'A', reason: 'counted' });
  });

  it('preserves unassigned and custom-split-only project actuals', async () => {
    h.queue.push({ data: [row({ reason: 'unassigned' }), row({ reason: 'split-when-custom' }), row({ reason: 'unresolved-direct' })], error: null });
    const lines = await dal.listProjectCostAmounts('p1');
    expect(lines.map((item) => item.reason)).toEqual(['unassigned', 'split-when-custom', 'unresolved-direct']);
  });

  it('accepts project actuals as a distinct cost source', async () => {
    h.queue.push({ data: [row({ source: 'project_actuals', reason: 'unassigned', amount: '10.00' }),
      row({ source: 'purchase_balance', reason: 'unassigned', amount: '5.00' }),
      row({ source: 'other_revenue', reason: 'other-revenue', amount: '3.00' })], error: null });
    const lines = await dal.listProjectCostAmounts('p1');
    expect(lines.map((item) => item.source)).toEqual(['project_actuals', 'purchase_balance', 'other_revenue']);
  });

  it('a malformed amount, quantity, or unknown reason is an error naming the field, never a blank or figure (#2983)', async () => {
    h.queue.push({ data: [row({ amount: '1e3' })], error: null });
    await expect(dal.listProjectCostAmounts('p1')).rejects.toMatchObject({ code: 'malformed-response', message: expect.stringMatching(/amount/) });
    h.queue.push({ data: [row({ reason: 'whatever' })], error: null });
    await expect(dal.listProjectCostAmounts('p1')).rejects.toMatchObject({ code: 'malformed-response', message: expect.stringMatching(/reason/) });
    h.queue.push({ data: [row({ quantity: 'bad' })], error: null });
    await expect(dal.listProjectCostAmounts('p1')).rejects.toMatchObject({ code: 'malformed-response', message: expect.stringMatching(/quantity/) });
  });

  it('labour money for a Project Manager is aggregate: no record id or date, the amounts stay (migration 1298)', async () => {
    h.queue.push({ data: [row({ source: 'timesheet_entry', record_id: null, occurred_on: null, person_id: null,
      labour_class_id: 'cls-direct', amount: '700000.00', quantity: 14, quantity_unit: 'hours', work_order_id: 'A' })], error: null });
    const lines = await dal.listProjectCostAmounts('p1');
    expect(lines[0]).toMatchObject({ source: 'timesheet_entry', recordId: null, labourClassId: 'cls-direct', amount: '700000.00' });
  });

  it('AC-NLL-012 an approved no-login attendance day parses, per row and as a Project Manager aggregate', async () => {
    h.queue.push({ data: [
      row({ source: 'attendance_day', record_id: 'att-1', person_id: 'worker-1', labour_class_id: 'cls-direct', amount: '320000.00', quantity: 8, quantity_unit: 'hours', work_order_id: 'A' }),
      row({ source: 'attendance_day', record_id: null, occurred_on: null, labour_class_id: null, amount: '440000.00', quantity: null, quantity_unit: 'hours', work_order_id: 'A' }),
      row({ source: 'attendance_day', record_id: 'att-2', reason: 'no-rate', currency: null, amount: null, quantity: 8, quantity_unit: 'hours', work_order_id: 'A' }),
    ], error: null });
    const lines = await dal.listProjectCostAmounts('p1');
    expect(lines.map((l) => [l.source, l.recordId, l.reason, l.amount])).toEqual([
      ['attendance_day', 'att-1', 'counted', '320000.00'],
      ['attendance_day', null, 'counted', '440000.00'],
      ['attendance_day', 'att-2', 'no-rate', null],
    ]);
    expect(lines[0]).toMatchObject({ personId: 'worker-1', labourClassId: 'cls-direct', quantity: 8 });
    // 1933: a Project Manager's aggregate carries no class and no quantity
    expect(lines[1]).toMatchObject({ quantity: null });
    expect(lines[1].labourClassId).toBeUndefined();
  });

  it('AC-HC-010 a daily head-count line parses, per row (no person) and as a Project Manager aggregate', async () => {
    h.queue.push({ data: [
      row({ source: 'headcount_day', record_id: 'hc-1', person_id: null, labour_class_id: 'cls-guard', amount: '960000.00', quantity: 24, quantity_unit: 'hours', work_order_id: 'A' }),
      row({ source: 'headcount_day', record_id: null, occurred_on: null, labour_class_id: null, amount: '1120000.00', quantity: null, quantity_unit: 'hours', work_order_id: 'A' }),
      row({ source: 'headcount_day', record_id: 'hc-2', reason: 'no-rate', currency: null, amount: null, quantity: null, quantity_unit: 'hours', work_order_id: 'A' }),
    ], error: null });
    const lines = await dal.listProjectCostAmounts('p1');
    expect(lines.map((l) => [l.source, l.recordId, l.reason, l.amount])).toEqual([
      ['headcount_day', 'hc-1', 'counted', '960000.00'],
      ['headcount_day', null, 'counted', '1120000.00'],
      ['headcount_day', 'hc-2', 'no-rate', null],
    ]);
    expect(lines[0]).toMatchObject({ personId: null, labourClassId: 'cls-guard', quantity: 24, quantityUnit: 'hours' });
  });

  it('a project with an expense claim naming a work order parses (a counted and a not-posted claim)', async () => {
    h.queue.push({ data: [
      row({ source: 'expense_claim', record_id: 'claim-1', amount: '150000.00', reference: 'EC-1', work_order_id: 'A' }),
      row({ source: 'expense_claim', record_id: 'claim-2', amount: null, reason: 'not-posted', work_order_id: 'A' }),
    ], error: null });
    const lines = await dal.listProjectCostAmounts('p1');
    expect(lines.map((l) => [l.source, l.reason, l.amount])).toEqual([['expense_claim', 'counted', '150000.00'], ['expense_claim', 'not-posted', null]]);
  });

  it('an unknown source is still an error, never a figure', async () => {
    h.queue.push({ data: [row({ source: 'payroll_run' })], error: null });
    await expect(dal.listProjectCostAmounts('p1')).rejects.toBeInstanceOf(AppError);
  });

  it('a row without a record id outside the aggregate labour shape is an error, never a figure', async () => {
    h.queue.push({ data: [row({ record_id: null })], error: null });
    await expect(dal.listProjectCostAmounts('p1')).rejects.toBeInstanceOf(AppError);
    h.queue.push({ data: [row({ source: 'timesheet_entry', reason: 'no-rate', record_id: null, labour_class_id: 'cls-direct' })], error: null });
    await expect(dal.listProjectCostAmounts('p1')).rejects.toBeInstanceOf(AppError);
    // a timesheet aggregate still names its class (the timesheet branch is unchanged by 1933)
    h.queue.push({ data: [row({ source: 'timesheet_entry', record_id: null, labour_class_id: null })], error: null });
    await expect(dal.listProjectCostAmounts('p1')).rejects.toBeInstanceOf(AppError);
  });
});

describe('plan figures', () => {
  it('preserves every cent in a large plan figure', async () => {
    h.queue.push({ data: [{ id: 'p', work_order_id: 'A', discipline_id: null, kind: 'direct_budget', value: '99999999999999.99', note: null }], error: null });
    const plans = await dal.listProjectPlanLines('p1');
    expect(plans[0].value).toBe('99999999999999.99');
    expect(h.calls.select).toContain('id, work_order_id, section_id, discipline_id, kind, value::text, note');
  });
});

describe('getSharedSplit', () => {
  it('reads every saved work-order share beyond the API page limit', async () => {
    h.queue.push({ data: Array.from({ length: 1000 }, (_, i) => ({ work_order_id: `wo-${i}`, percent: '0.1' })), error: null });
    h.queue.push({ data: [{ work_order_id: 'wo-last', percent: '0' }], error: null });
    const split = await dal.getSharedSplit('p1');
    expect(split).toHaveLength(1001);
    expect(split?.at(-1)).toEqual({ workOrderId: 'wo-last', percent: '0' });
  });
});

describe('writes send no org_id', () => {
  it('saves the plan in one scoped RPC without a client-supplied org', async () => {
    await dal.setWorkOrderPlan('p1', 'A', [{ kind: 'direct_budget', value: '99999999999999.99', note: null }]);
    expect(h.calls.rpc).toEqual([['set_work_order_plan', { p_project_id: 'p1', p_work_order_id: 'A',
      p_changes: [{ kind: 'direct_budget', value: '99999999999999.99', note: null }] }]]);
  });

  it('sets the split through its RPC and keeps a refusal\'s code', async () => {
    h.queue.push({ data: null, error: { message: 'WPVA_SPLIT_SUM: the percentages add up to 99, not 100', code: '23514' } });
    const err = await dal.setSharedSplit('p1', [{ workOrderId: 'A', percent: '99' }]).catch((e) => e);
    expect(h.calls.rpc[0]).toEqual(['set_shared_cost_split', { p_project_id: 'p1', p_split: [{ work_order_id: 'A', percent: '99' }] }]);
    expect(err.code).toBe('23514');
  });
});

describe('workOrderFinanceRepository.projectPlanVsActual', () => {
  it('rolls the reads up once: work orders by number, revenue from billing, shared cost allocated (AC-WPVA-004)', async () => {
    h.queue.push({ data: [row({ amount: '600.00', work_order_id: 'A' }), row({ amount: '400.00', work_order_id: 'B' }), row({ amount: '100.00' })], error: null });
    h.queue.push({ data: [], error: null });   // plan lines
    h.queue.push({ data: [], error: null });   // split
    const r = await workOrderFinanceRepository.projectPlanVsActual('p1');
    expect(r.workOrders.map((w) => w.id)).toEqual(['A', 'B']);
    expect(r.workOrders[0].orderValue).toBe('1500.00');
    expect(r.rollup.workOrders[0]).toMatchObject({ direct: '600.00', allocated: '60.00', result: { amount: '340.00', reason: null } });
    expect(r.rollup.restricted).toBe(false);
    expect(r.rollup.totals[0]).toMatchObject({ revenue: '2000.00', result: { amount: '900.00', reason: null } });
  });

  it('AC-WPVA-009 a refused money read is restricted — no figures, no margin, no plan read', async () => {
    h.queue.push({ data: null, error: { message: 'not authorized', code: '42501' } });
    const r = await workOrderFinanceRepository.projectPlanVsActual('p1');
    expect(r.rollup.restricted).toBe(true);
    expect(r.rollup.workOrders[0].direct).toBeNull();
    expect(r.rollup.workOrders[0].directMargin.reason).toBe('restricted-rows');
    expect(h.calls.from).not.toContain('work_order_plan_lines');
  });

  it('any other read failure is an error, not a restricted or empty screen', async () => {
    h.queue.push({ data: null, error: { message: 'boom', code: '500' } });
    await expect(workOrderFinanceRepository.projectPlanVsActual('p1')).rejects.toBeTruthy();
  });
});

const sources = () => ({
  orders: { data: [
    { id: 'B', wo_number: 'WO-2', title: 'Two', status: 'Issued', currency: 'IDR' },
    { id: 'A', wo_number: 'WO-1', title: 'One', status: 'Issued', currency: 'IDR' },
  ] },
  billing: { data: [
    { work_order_id: 'A', project_id: 'p1', status: 'Issued', currency: 'IDR', order_net: 1500, invoiced: 1000, pending: 0, paid: 0, remaining: 500, figures_complete: true, line_count: 1, unpaid_count: 1 },
    { work_order_id: 'B', project_id: 'p1', status: 'Issued', currency: 'IDR', order_net: 0, invoiced: 500, pending: 0, paid: 0, remaining: 0, figures_complete: true, line_count: 1, unpaid_count: 1 },
  ] },
  money: { data: [row({ record_id: 'fixed', amount: '600.00', work_order_id: 'A' })] },
  finances: { data: { invoices: [{ currency: 'IDR', work_revenue: '2000.00', missing_work: 0 }] } },
  plans: { data: [] }, split: { data: [] },
});
it('AC-Q9-006: 200 projects use one RPC, retaining exact source amounts beyond 1000 rows', async () => {
  const ids = Array.from({ length: 200 }, (_, i) => `p${i}`);
  const payload = Object.fromEntries(ids.map((id) => [id, sources()]));
  payload.p0.money.data = Array.from({ length: 1001 }, (_, i) => row({ record_id: `r${i}`, amount: '0.01', work_order_id: 'A' }));
  h.queue.push({ data: payload, error: null });
  const result = await workOrderFinanceRepository.projectsPlanVsActual(ids);
  expect(h.calls.rpc).toEqual([['get_projects_plan_actual_sources', { p_project_ids: ids }]]);
  expect(Object.keys(result)).toHaveLength(200);
  expect(result.p0).toMatchObject({ costLines: expect.any(Array) });
  expect((result.p0 as import('@/src/lib/repositories/workOrderFinance').ProjectPlanVsActual).costLines).toHaveLength(1001);
  expect(result.p0).toMatchObject({ rollup: { workOrders: [expect.objectContaining({ direct: '10.01' }), expect.anything()] } });
});
it('AC-Q9-007: a refused source remains restricted without blanking another project', async () => {
  const payload: Record<string, unknown> = { good: sources(), restricted: { ...sources(), money: { error: { code: '42501', message: 'not authorized' } } }, broken: { ...sources(), money: { error: { code: 'P0002', message: 'project not found' } } } };
  h.queue.push({ data: payload, error: null });
  const result = await workOrderFinanceRepository.projectsPlanVsActual(Object.keys(payload));
  expect(result.good).toMatchObject({ rollup: { restricted: false } });
  expect(result.restricted).toMatchObject({ rollup: { restricted: true }, plans: [], split: null });
  expect(result.broken).toMatchObject({ rollup: { restricted: true }, plans: [], split: null });
});

it('AC-Q9-008: the batch figures equal the existing single-project fixture', async () => {
  const payload = sources();
  h.queue.push({ data: payload.money.data, error: null }, { data: [], error: null }, { data: [], error: null });
  const single = await workOrderFinanceRepository.projectPlanVsActual('p1');
  h.queue.push({ data: { p1: payload }, error: null });
  const batch = await workOrderFinanceRepository.projectsPlanVsActual(['p1']);
  expect(batch.p1).toEqual(single);
});
it('AC-Q9-009: one failed billing source stays unknown beside another successful project', async () => {
  h.queue.push({ data: { good: sources(), unknown: { ...sources(), billing: { error: { code: 'XX000', message: 'unavailable' } }, finances: { error: { code: 'XX000', message: 'unavailable' } } } }, error: null });
  const batch = await workOrderFinanceRepository.projectsPlanVsActual(['good', 'unknown']);
  expect(batch.good).toMatchObject({ workOrders: [expect.objectContaining({ revenue: '1000.00' }), expect.anything()] });
  expect(batch.unknown).toMatchObject({ workOrders: [expect.objectContaining({ revenue: null }), expect.objectContaining({ revenue: null })], rollup: { restricted: false } });
});

it.each(['P0002','42501','P0001','XX000'])('AC-Q9-028 project source outcome %s', async (code) => {
  h.queue.push({ data: null, error: { message: 'unavailable', code } });
  const single = await workOrderFinanceRepository.projectPlanVsActual('p1');
  expect(single).toMatchObject({ rollup: { restricted: true }, plans: [], split: null });
  expect(h.calls.from).not.toContain('work_order_plan_lines');
  h.queue.push({ data: { p1: { ...sources(), money: { error: { message: 'unavailable', code } } } }, error: null });
  const batch = await workOrderFinanceRepository.projectsPlanVsActual(['p1']);
  expect(batch.p1).toEqual(single);
});
