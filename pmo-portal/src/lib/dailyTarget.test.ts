import { describe, it, expect } from 'vitest';
import { asOfForMonth, monthEndOf, parseDailyTarget, parseProjectDailyTarget, shiftMonth, visibleDays, type DailyTargetDay } from './dailyTarget';

const day = (extra: Partial<DailyTargetDay> = {}): DailyTargetDay => ({
  date: '2026-12-01', working: true, listed: false, nonWorkingLabel: null, hasTarget: false, target: '0.00', actual: '0.00', gap: '0.00', pendingReports: 0, ...extra,
});

describe('dailyTarget (#2672)', () => {
  it('parses the work-order read, keeping amounts as exact two-decimal strings and a null projection', () => {
    const d = parseDailyTarget({
      work_order_id: 'w', currency: 'IDR', as_of: '2026-12-03', month: '2026-12-01', has_target: true, month_target: '230', mtd_target: '200', mtd_actual: '80', mtd_gap: '-120',
      elapsed_working_days: 3, remaining_working_days: 19, projection: null, projected_gap: null,
      days: [{ date: '2026-12-25', working: false, is_listed: true, non_working_label: 'Holiday', has_target: true, target: '30', actual: '0', gap: '-30', pending_reports: 0 }],
    });
    expect(d.mtdGap).toBe('-120.00');
    expect(d.projection).toBeNull();
    expect(d.projectedGap).toBeNull();
    expect(d.days[0]).toMatchObject({ listed: true, working: false, nonWorkingLabel: 'Holiday', target: '30.00' });
  });
  it('AC-WDT-007 keeps a projection of 4400.00 as given and never turns a missing one into 0', () => {
    const base = { work_order_id: 'w', currency: 'IDR', as_of: 'x', month: 'm', days: [] };
    expect(parseDailyTarget({ ...base, projection: '4400.00', projected_gap: '4170.00' }).projection).toBe('4400.00');
    expect(parseDailyTarget({ ...base }).projection).toBeNull();
  });
  it('AC-WDT-010 parses the project roll-up with one total per currency', () => {
    const p = parseProjectDailyTarget({
      as_of: '2026-12-03',
      rows: [{ work_order_id: 'a', wo_number: 'WO-A', title: 'A', status: 'Issued', currency: 'IDR', has_target: true, month_target: '230', mtd_target: '200', mtd_actual: '80', mtd_gap: '-120', projection: '613.33', projected_gap: '383.33' }],
      totals: [{ currency: 'IDR', month_target: '230', mtd_target: '200', mtd_actual: '80', mtd_gap: '-120', projection: null, targeted_count: 1 }, { currency: 'USD', month_target: '50', mtd_target: '50', mtd_actual: '0', mtd_gap: '-50', projection: '0.00', targeted_count: 1 }],
    });
    expect(p.rows[0]).toMatchObject({ woNumber: 'WO-A', projection: '613.33' });
    expect(p.totals.map((x) => x.currency)).toEqual(['IDR', 'USD']);
    expect(p.totals[0].projection).toBeNull();
  });
  it('visibleDays keeps working days and any day that carries something, and drops plain weekends', () => {
    const days = [
      day({ date: '1' }),
      day({ date: '2', working: false }),
      day({ date: '3', working: false, listed: true }),
      day({ date: '4', working: false, hasTarget: true, target: '10.00' }),
      day({ date: '5', working: false, actual: '5.00' }),
      day({ date: '6', working: false, pendingReports: 1 }),
    ];
    expect(visibleDays(days).map((d) => d.date)).toEqual(['1', '3', '4', '5', '6']);
  });
  it('shifts months across a year end and finds a month end', () => {
    expect(shiftMonth('2026-12-15', 1)).toBe('2027-01-01');
    expect(shiftMonth('2026-01-01', -1)).toBe('2025-12-01');
    expect(monthEndOf('2028-02-01')).toBe('2028-02-29');
  });
  it('asks for a past month whole, the current month as of today and a future month from its first day', () => {
    expect(asOfForMonth('2026-12-01', '2026-12-01')).toBeNull();
    expect(asOfForMonth('2026-11-01', '2026-12-01')).toBe('2026-11-30');
    expect(asOfForMonth('2027-01-01', '2026-12-01')).toBe('2027-01-01');
  });
});
