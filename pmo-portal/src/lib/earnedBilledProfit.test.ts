import { describe, expect, it } from 'vitest';
import { earnedBilledProfit, projectEarnedBilled, type WorkOrderEarnedBilledRow } from './earnedBilledProfit';
import { rollupProject, type CostAmountLine, type PvaWorkOrder } from './workOrderPlanVsActual';

/** Layer-1 money gate-tests for earned and billed revenue (#2733, docs/specs/earned-billed-revenue.spec.md). */
const wo = (id: string, currency = 'USD', revenue = '60.00'): PvaWorkOrder => ({
  id, woNumber: id, title: id, status: 'Issued', currency, revenue, revenueComplete: true,
});
let seq = 0;
const line = (extra: Partial<CostAmountLine>): CostAmountLine => ({
  source: 'vendor_bill', recordId: `r${++seq}`, projectId: 'p1', workOrderId: 'A', disciplineId: null,
  occurredOn: '2026-11-01', reference: null, currency: 'USD', amount: '70.00', reason: 'counted',
  quantity: null, quantityUnit: null, personId: null, ...extra,
});
const rollup = (lines: CostAmountLine[], workOrders = [wo('A')], restricted = false) =>
  rollupProject({ workOrders, lines, plans: [], split: null, restricted, projectRevenue: [{ currency: 'USD', work_revenue: '60.00', missing_work: 0 }] });
const row = (extra: Partial<WorkOrderEarnedBilledRow> = {}): WorkOrderEarnedBilledRow => ({
  workOrderId: 'A', currency: 'USD', earned: '100.00', earnedLines: 1, unratedLines: 0, billed: '60.00', billedComplete: true, ...extra,
});

describe('earnedBilledProfit', () => {
  it('AC-EBR-008 earned 100, billed 60, cost 70: gap 40, margin 30 on earned and a loss of 10 on billed', () => {
    const [c] = earnedBilledProfit(rollup([line({})]), [row()]).currencies;
    const a = c.rows[0];
    expect(a.gap.amount).toBe('40.00');
    expect(a.marginEarned.amount).toBe('30.00');
    expect(a.marginBilled.amount).toBe('-10.00');
    expect(c.total.gap.amount).toBe('40.00');
    expect(c.total.marginBilled.amount).toBe('-10.00');
  });

  it('AC-EBR-004 no validated progress reads not available on the earned side, never zero; billed still shows', () => {
    const [c] = earnedBilledProfit(rollup([line({})]), [row({ earned: null, earnedLines: 0 })]).currencies;
    const a = c.rows[0];
    expect(a.earned).toEqual({ amount: null, reason: 'not-available' });
    expect(a.gap.reason).toBe('not-available');
    expect(a.marginEarned.reason).toBe('not-available');
    expect(a.billed.amount).toBe('60.00');
    expect(a.marginBilled.amount).toBe('-10.00');
    expect(c.total.earned.reason).toBe('not-available');
    expect(c.total.withoutProgress).toBe(1);
  });

  it('AC-EBR-004 a project where only some work orders lack progress reads incomplete, with the count, not a partial sum', () => {
    const r = rollup([line({}), line({ workOrderId: 'B' })], [wo('A'), wo('B')]);
    const [c] = earnedBilledProfit(r, [row(), row({ workOrderId: 'B', earned: null, earnedLines: 0 })]).currencies;
    expect(c.total.earned).toEqual({ amount: null, reason: 'incomplete' });
    expect(c.total.marginEarned.reason).toBe('incomplete');
    expect(c.total.withoutProgress).toBe(1);
    expect(c.total.workOrders).toBe(2);
  });

  it('AC-EBR-009 a validated line without a rate reads incomplete; another currency reads not comparable', () => {
    const [c] = earnedBilledProfit(rollup([line({})]), [row({ unratedLines: 1 })]).currencies;
    expect(c.rows[0].earned.reason).toBe('incomplete');
    expect(c.rows[0].marginEarned.reason).toBe('incomplete');
    const mixed = rollup([line({}), line({ currency: 'EUR', amount: '5.00' })]);
    const [u] = earnedBilledProfit(mixed, [row()]).currencies.filter((x) => x.currency === 'USD');
    expect(u.rows[0].marginEarned.reason).toBe('not-comparable');
    expect(u.rows[0].marginBilled.reason).toBe('not-comparable');
  });

  it('AC-EBR-009 an unknown billed total reads not available, not zero', () => {
    const [c] = earnedBilledProfit(rollup([line({})]), [row({ billedComplete: false })]).currencies;
    expect(c.rows[0].billed.reason).toBe('not-available');
    expect(c.rows[0].marginBilled.reason).toBe('not-available');
  });

  it('AC-EBR-010 a caller who cannot see revenue reads restricted, on both bases', () => {
    expect(earnedBilledProfit(rollup([line({})]), 'restricted')).toEqual({ restricted: true, currencies: [] });
    expect(earnedBilledProfit(rollup([line({})], [wo('A')], true), [row()]).restricted).toBe(true);
  });

  it('AC-EBR-012 the project total cost is the roll-up project figure, so the pack and the tab agree', () => {
    const r = rollup([line({}), line({ workOrderId: null, amount: '10.00' })]);
    const t = projectEarnedBilled(r, 'USD', { earned: '100.00', unratedLines: 0, workOrders: 1, withoutProgress: 0 });
    expect(t.marginEarned.amount).toBe('20.00');
    expect(t.marginBilled.amount).toBe('-20.00');
  });

  it('a project with cost unknown reads cost unknown on both bases', () => {
    const r = rollup([line({ amount: null })]);
    const t = projectEarnedBilled(r, 'USD', { earned: '100.00', unratedLines: 0, workOrders: 1, withoutProgress: 0 });
    expect(t.marginEarned.reason).toBe('cost-unknown');
    expect(t.marginBilled.reason).toBe('cost-unknown');
  });

  it('a currency with no work order, revenue or cost is not listed (no empty panel)', () => {
    const r = rollupProject({ workOrders: [wo('A')], lines: [line({})], plans: [], split: null, restricted: false,
      projectRevenue: [{ currency: 'USD', work_revenue: '60.00', missing_work: 0 }, { currency: 'EUR', work_revenue: '0.00', missing_work: 0 }] });
    expect(earnedBilledProfit(r, [row()]).currencies.map((c) => c.currency)).toEqual(['USD']);
  });
});
