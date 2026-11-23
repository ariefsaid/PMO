import { describe, expect, it } from 'vitest';
import { disciplineProfit, type DisciplineRevenueRow } from './disciplineProfit';
import { rollupProject, type CostAmountLine, type PvaWorkOrder } from './workOrderPlanVsActual';

/** Layer-1 money gate-tests for profit per discipline (#2669, docs/specs/discipline-profit.spec.md). */

const wo = (id: string, currency = 'USD'): PvaWorkOrder => ({
  id, woNumber: id, title: id, status: 'Issued', currency, revenue: '0.00', revenueComplete: true,
});
let seq = 0;
const line = (extra: Partial<CostAmountLine>): CostAmountLine => ({
  source: 'vendor_bill', recordId: `r${++seq}`, projectId: 'p1', workOrderId: null, disciplineId: null,
  occurredOn: '2026-11-01', reference: null, currency: 'USD', amount: '0.00', reason: 'counted',
  quantity: null, quantityUnit: null, personId: null, ...extra,
});
const rollup = (lines: CostAmountLine[], workOrders = [wo('A')]) =>
  rollupProject({ workOrders, lines, plans: [], split: null, restricted: false });
const rev = (disciplineId: string | null, revenue: string, extra: Partial<DisciplineRevenueRow> = {}): DisciplineRevenueRow =>
  ({ basis: 'validated_progress', disciplineId, currency: 'USD', revenue, validatedLines: 1, unratedLines: 0, ...extra });

// Civil direct 60, electrical direct 40, shared 10 → allocated 6 and 4.
const base = () => rollup([
  line({ workOrderId: 'A', disciplineId: 'civil', amount: '60.00' }),
  line({ workOrderId: 'A', disciplineId: 'elec', amount: '40.00' }),
  line({ workOrderId: null, amount: '10.00' }),
]);

describe('disciplineProfit', () => {
  it('AC-DPR-009 shows margin before and after shared cost, and a loss as a negative amount', () => {
    const p = disciplineProfit(base(), [rev('civil', '100.00'), rev('elec', '30.00')]);
    const [c] = p.currencies;
    const civil = c.rows.find((r) => r.disciplineId === 'civil')!;
    expect(civil.marginBefore.amount).toBe('40.00');
    expect(civil.marginAfter.amount).toBe('34.00');
    const elec = c.rows.find((r) => r.disciplineId === 'elec')!;
    expect(elec.marginBefore.amount).toBe('-10.00');
    expect(elec.marginAfter.amount).toBe('-14.00');
  });

  it('AC-DPR-010 lists a discipline with cost only and one with revenue only; the total equals the project cost', () => {
    const r = base();
    const p = disciplineProfit(r, [rev('civil', '100.00'), rev('survey', '25.00')]);
    const [c] = p.currencies;
    expect(c.rows.map((x) => x.disciplineId)).toEqual(['civil', 'elec', 'survey']);
    const survey = c.rows.find((x) => x.disciplineId === 'survey')!;
    expect(survey.direct).toBe('0.00');
    expect(survey.marginAfter.amount).toBe('25.00');
    const projectTotal = r.totals.find((t) => t.currency === 'USD')!.total;
    expect(c.total.revenue).toBe('125.00');
    expect(c.total.marginAfter.amount).toBe('15.00'); // 125 - 110
    expect(projectTotal).toBe('110.00');
  });

  it('AC-DPR-010 cost held by no discipline shows as Not assigned and the total still equals the project cost', () => {
    // No positive direct cost to weigh by: the shared 90 stays unassigned.
    const r = rollup([line({ workOrderId: null, amount: '90.00' })]);
    const p = disciplineProfit(r, [rev('civil', '50.00')]);
    const [c] = p.currencies;
    const unassigned = c.rows.find((x) => x.kind === 'unassigned')!;
    expect(unassigned.allocated).toBe('90.00');
    expect(c.total.marginAfter.amount).toBe('-40.00');
  });

  it('AC-DPR-011 revenue and cost in different currencies are never blended: margin is not comparable', () => {
    const p = disciplineProfit(base(), [rev('civil', '100.00', { currency: 'EUR' })]);
    const usd = p.currencies.find((c) => c.currency === 'USD')!;
    const civilUsd = usd.rows.find((r) => r.disciplineId === 'civil')!;
    expect(civilUsd.marginAfter).toEqual({ amount: null, reason: 'not-comparable' });
    expect(civilUsd.direct).toBe('60.00');
    expect(usd.total.marginAfter.reason).toBe('not-comparable');
    const eur = p.currencies.find((c) => c.currency === 'EUR')!;
    expect(eur.rows[0].revenue).toBe('100.00');
    expect(eur.rows[0].marginAfter.reason).toBe('not-comparable');
  });

  it('AC-DPR-008 an unrated validated line makes the margin incomplete, never a number', () => {
    const p = disciplineProfit(base(), [rev('civil', '100.00', { unratedLines: 1 }), rev('elec', '50.00')]);
    const [c] = p.currencies;
    expect(c.rows.find((r) => r.disciplineId === 'civil')!.marginAfter).toEqual({ amount: null, reason: 'incomplete' });
    expect(c.rows.find((r) => r.disciplineId === 'elec')!.marginAfter.amount).toBe('6.00');
    expect(c.total.marginAfter.reason).toBe('incomplete');
  });

  it('AC-DPR-012 a restricted revenue read or roll-up gives restricted, never zero', () => {
    expect(disciplineProfit(base(), 'restricted')).toEqual({ restricted: true, currencies: [] });
    const r = { ...base(), restricted: true };
    expect(disciplineProfit(r, [rev('civil', '1.00')]).restricted).toBe(true);
  });

  it('ignores a revenue basis it was not asked for, so another basis can sit beside it', () => {
    const p = disciplineProfit(base(), [rev('civil', '100.00'), { ...rev('civil', '999.00'), basis: 'billed' }]);
    expect(p.currencies[0].rows.find((r) => r.disciplineId === 'civil')!.revenue).toBe('100.00');
  });

  it('keeps cents exact', () => {
    const r = rollup([line({ workOrderId: 'A', disciplineId: 'civil', amount: '0.10' }), line({ workOrderId: 'A', disciplineId: 'civil', amount: '0.20' })]);
    expect(disciplineProfit(r, [rev('civil', '0.30')]).currencies[0].total.marginBefore.amount).toBe('0.00');
  });

  it('AC-DPC-001 shared people and equipment cost reaches disciplines by direct share and the margins reconcile to the project', () => {
    // A: civil 300 + elec 100; B: civil 200. Shared: priced timesheet 30 + equipment 60 = 90, split 400:200 -> A 60, B 30.
    const r = rollup([
      line({ workOrderId: 'A', disciplineId: 'civil', amount: '300.00' }),
      line({ workOrderId: 'A', disciplineId: 'elec', amount: '100.00' }),
      line({ workOrderId: 'B', disciplineId: 'civil', amount: '200.00' }),
      line({ source: 'timesheet_entry', workOrderId: null, amount: '30.00' }),
      line({ source: 'equipment_usage', workOrderId: null, amount: '60.00' }),
    ], [wo('A'), wo('B')]);
    const p = disciplineProfit(r, [rev('civil', '700.00'), rev('elec', '150.00')]);
    const [c] = p.currencies;
    const civil = c.rows.find((x) => x.disciplineId === 'civil')!;
    const elec = c.rows.find((x) => x.disciplineId === 'elec')!;
    expect([civil.direct, civil.allocated, civil.marginAfter.amount]).toEqual(['500.00', '75.00', '125.00']);
    expect([elec.direct, elec.allocated, elec.marginAfter.amount]).toEqual(['100.00', '15.00', '35.00']);
    const cents = (v: string | null) => BigInt(Math.round(Number(v) * 100));
    const rowsSum = c.rows.filter((x) => x.kind !== 'total').reduce((t, x) => t + cents(x.marginAfter.amount), 0n);
    const projectCost = cents(r.totals.find((t) => t.currency === 'USD')!.total);
    expect(projectCost).toBe(69000n);
    expect(rowsSum).toBe(85000n - projectCost);
    expect(c.total.marginAfter.amount).toBe('160.00');
  });
});
