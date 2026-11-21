import { describe, expect, it } from 'vitest';
import { addMonths, candidateKey, groupByProject, monthOf, overClaimWarning, planTotals, resolveTarget, type PlanCandidate } from './billingPlan';

const cand = (over: Partial<PlanCandidate> & { key: string; value: number }): PlanCandidate => ({
  kind: 'line', projectId: 'p1', projectName: 'One', currency: 'IDR', workOrderId: 'w1', woNumber: 'WO-1', boqItemId: 'b1', itemCode: 'I-1',
  description: 'Item', unit: 'm', earningBasis: 'unit_rate', contractQuantity: 100, acceptedQuantity: 12, claimedQuantity: 5, unclaimedQuantity: 7,
  acceptedOn: '2026-05-04', today: '2026-11-21', ...over,
});

describe('billingPlan', () => {
  const rows = [cand({ key: 'a', value: 7000 }), cand({ key: 'b', value: 2500.1 }), cand({ key: 'c', value: 100, currency: 'USD' })];
  const target = { amount: 10000, currency: 'IDR', source: 'default' as const };

  it('AC-MBP-010 totals the picked value in the target currency in cents and reports the remaining', () => {
    const t = planTotals(rows, new Set(['a', 'b']), target);
    expect(t).toMatchObject({ pickedCount: 2, counted: 9500.1, countedCurrency: 'IDR', remaining: 499.9, aboveTarget: false, otherCurrencies: [] });
  });
  it('AC-MBP-010 above target is negative remaining and flagged; exactly on target is not above', () => {
    expect(planTotals(rows, new Set(['a', 'b']), { ...target, amount: 9000 })).toMatchObject({ remaining: -500.1, aboveTarget: true });
    expect(planTotals(rows, new Set(['a']), { ...target, amount: 7000 })).toMatchObject({ remaining: 0, aboveTarget: false });
  });
  it('AC-MBP-010 another currency is listed apart, never converted or counted', () => {
    const t = planTotals(rows, new Set(['a', 'c']), target);
    expect(t.counted).toBe(7000);
    expect(t.otherCurrencies).toEqual([{ currency: 'USD', total: 100 }]);
  });
  it('AC-MBP-010 empty picks total zero; without a target the remaining is null', () => {
    expect(planTotals(rows, new Set(), target)).toMatchObject({ pickedCount: 0, counted: 0, remaining: 10000 });
    expect(planTotals(rows, new Set(['a']), null)).toMatchObject({ counted: 7000, countedCurrency: 'IDR', remaining: null, aboveTarget: false });
  });
  it('AC-MBP-011 warns when claimed plus the picked quantity passes the contract quantity, never otherwise', () => {
    expect(overClaimWarning(cand({ key: 'x', value: 1, contractQuantity: 10, claimedQuantity: 5, unclaimedQuantity: 7 }))).toBe(true);
    expect(overClaimWarning(cand({ key: 'x', value: 1, contractQuantity: 12, claimedQuantity: 5, unclaimedQuantity: 7 }))).toBe(false);
    expect(overClaimWarning(cand({ key: 'o', value: 1, kind: 'order', contractQuantity: null, claimedQuantity: null, unclaimedQuantity: null }))).toBe(false);
  });
  it('AC-MBP-012 a month override wins, the default covers other months, neither means no target', () => {
    const settings = { monthlyTarget: 5000, targetCurrency: 'IDR' };
    const overrides = [{ month: '2026-12-01', target: 8000 }];
    expect(resolveTarget(settings, overrides, '2026-12-01')).toEqual({ amount: 8000, currency: 'IDR', source: 'month' });
    expect(resolveTarget(settings, overrides, '2027-01-01')).toEqual({ amount: 5000, currency: 'IDR', source: 'default' });
    expect(resolveTarget({ monthlyTarget: null, targetCurrency: 'IDR' }, [], '2026-12-01')).toBeNull();
    expect(resolveTarget(null, [], '2026-12-01')).toBeNull();
  });
  it('months come from the server day and step across a year', () => {
    expect(monthOf('2026-11-21')).toBe('2026-11-01');
    expect(addMonths('2026-12-01', 1)).toBe('2027-01-01');
    expect(addMonths('2026-01-01', -1)).toBe('2025-12-01');
  });
  it('keys and grouping', () => {
    expect(candidateKey({ kind: 'order', workOrderId: 'w', boqItemId: null })).toBe('order:w:-');
    const g = groupByProject([cand({ key: 'a', value: 1 }), cand({ key: 'b', value: 1, projectId: 'p2', projectName: 'Two' }), cand({ key: 'c', value: 1 })]);
    expect(g.map((x) => [x.projectId, x.candidates.length])).toEqual([['p1', 2], ['p2', 1]]);
  });
});
