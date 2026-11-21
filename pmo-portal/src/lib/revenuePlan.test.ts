import { describe, it, expect } from 'vitest';
import { monthRange, monthStartOf, parseFigures, parseProject, planAmountProblem, revenueGap, twoDecimals } from './revenuePlan';

describe('revenuePlan helpers (#2671)', () => {
  it('AC-WRP-008 the gap reads in words: negative is behind, positive ahead, zero on plan', () => {
    expect(revenueGap('-500.00')).toEqual({ state: 'behind', by: '500.00' });
    expect(revenueGap('12.50')).toEqual({ state: 'ahead', by: '12.50' });
    expect(revenueGap('0.00')).toEqual({ state: 'on-plan', by: '0.00' });
    expect(revenueGap('-0.00')).toEqual({ state: 'on-plan', by: '0.00' });
  });
  it('keeps amounts as exact two-decimal strings, never floats', () => {
    expect(twoDecimals('300')).toBe('300.00');
    expect(twoDecimals('0.1')).toBe('0.10');
    expect(twoDecimals(1000.01)).toBe('1000.01');
    expect(twoDecimals('abc')).toBeNull();
    expect(twoDecimals(null)).toBeNull();
  });
  it('validates a typed plan amount: zero or more, at most two decimals', () => {
    expect(planAmountProblem('')).toBe('required');
    expect(planAmountProblem('  ')).toBe('required');
    expect(planAmountProblem('-1')).toBe('format');
    expect(planAmountProblem('1.234')).toBe('format');
    expect(planAmountProblem('1000.01')).toBeNull();
    expect(planAmountProblem('0')).toBeNull();
  });
  it('lists first-of-month values around a date', () => {
    expect(monthStartOf('2026-12-15')).toBe('2026-12-01');
    const r = monthRange('2026-11-21', 1, 2);
    expect(r).toEqual(['2026-10-01', '2026-11-01', '2026-12-01', '2027-01-01']);
  });
  it('parses the work-order read', () => {
    const f = parseFigures({ work_order_id: 'w', currency: 'IDR', as_of: '2026-12-05', has_plan: true, plan_to_date: '800.00', actual_to_date: '300.00', gap: '-500.00', plan_total: '1200.00', pending_reports: 1,
      series: [{ date: '2026-12-01', plan: '0.00', actual: '0.00', cum_plan: '0.00', cum_actual: '0.00' }] });
    expect(f).toMatchObject({ hasPlan: true, gap: '-500.00', pendingReports: 1 });
    expect(f.series).toHaveLength(1);
  });
  it('AC-WRP-010 parses the project read with one total per currency', () => {
    const p = parseProject({ as_of: '2026-12-05', rows: [{ work_order_id: 'a', wo_number: 'WO-A', title: 'A', status: 'Issued', currency: 'IDR', has_plan: true, plan_to_date: '800', actual_to_date: '300', gap: '-500', plan_total: '1200', pending_reports: 0 }],
      totals: [{ currency: 'IDR', plan_to_date: '800', actual_to_date: '300', gap: '-500', plan_total: '1200', planned_count: 1 }, { currency: 'USD', plan_to_date: '50', actual_to_date: '0', gap: '-50', plan_total: '50', planned_count: 1 }] });
    expect(p.rows[0].planToDate).toBe('800.00');
    expect(p.totals.map((t) => t.currency)).toEqual(['IDR', 'USD']);
  });
});
