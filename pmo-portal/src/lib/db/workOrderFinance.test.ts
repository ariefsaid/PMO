import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AppError } from '@/src/lib/appError';

/**
 * #2519 — plan versus actual DAL + repository. The money read is paged and validated (a malformed amount is an error,
 * never a figure); a refused money read becomes "restricted" (AC-WPVA-009); writes never send org_id.
 */
const h = vi.hoisted(() => {
  const queue: Array<{ data: unknown; error: unknown }> = [];
  const calls = { from: [] as string[], rpc: [] as Array<[string, unknown]>, insert: [] as unknown[], update: [] as unknown[], eq: [] as unknown[], range: [] as unknown[] };
  const next = () => queue.shift() ?? { data: [], error: null };
  const builder: Record<string, unknown> = {};
  const chain = (name?: keyof typeof calls) => (...a: unknown[]) => { if (name) (calls[name] as unknown[]).push(a.length === 1 ? a[0] : a); return builder; };
  for (const k of ['select', 'order', 'limit', 'delete'] as const) builder[k] = chain();
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
vi.mock('@/src/lib/db/workOrderBilling', () => ({
  listWorkOrderBilling: vi.fn(async () => [
    { workOrderId: 'A', currency: 'IDR', invoiced: 1000, figuresComplete: true },
    { workOrderId: 'B', currency: 'IDR', invoiced: 500, figuresComplete: true },
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

  it('a malformed amount or unknown reason is an error, never a figure', async () => {
    h.queue.push({ data: [row({ amount: '1e3' })], error: null });
    await expect(dal.listProjectCostAmounts('p1')).rejects.toBeInstanceOf(AppError);
    h.queue.push({ data: [row({ reason: 'whatever' })], error: null });
    await expect(dal.listProjectCostAmounts('p1')).rejects.toBeInstanceOf(AppError);
  });
});

describe('writes send no org_id', () => {
  it('creates a plan figure, or updates only value and note of an existing one', async () => {
    await dal.savePlanLine({ projectId: 'p1', workOrderId: 'A', disciplineId: null, kind: 'direct_budget', value: '100.50', note: 'tender' }, null);
    expect(h.calls.insert).toEqual([{ project_id: 'p1', work_order_id: 'A', discipline_id: null, kind: 'direct_budget', value: 100.5, note: 'tender' }]);
    await dal.savePlanLine({ projectId: 'p1', workOrderId: 'A', disciplineId: null, kind: 'direct_budget', value: '90', note: null }, 'pl1');
    expect(h.calls.update).toEqual([{ value: 90, note: null }]);
    expect(h.calls.eq).toContainEqual(['id', 'pl1']);
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
    expect(r.rollup.workOrders[0]).toMatchObject({ direct: '600.00', allocated: '60.00', result: { amount: '340.00', reason: null } });
    expect(r.rollup.restricted).toBe(false);
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
