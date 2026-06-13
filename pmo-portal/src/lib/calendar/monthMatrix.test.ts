import { describe, it, expect } from 'vitest';
import { buildMonthMatrix, parseLocalDate, monthLabel, addMonths, todayCursor } from './monthMatrix';

describe('monthMatrix', () => {
  it('AC-CAL-008: returns 6×7 days with adjacent-month days flagged and the 1st on the right weekday', () => {
    const weeks = buildMonthMatrix(2026, 5); // month is 0-based → June 2026
    expect(weeks).toHaveLength(6);
    expect(weeks.every((w) => w.length === 7)).toBe(true);
    const flat = weeks.flat();
    const june1 = flat.find((d) => d.iso === '2026-06-01')!;
    expect(june1.inMonth).toBe(true);
    expect(june1.weekdayIndex).toBe(1); // 2026-06-01 is a Monday (0=Sun)
    expect(flat.filter((d) => d.inMonth)).toHaveLength(30);
    expect(flat.some((d) => !d.inMonth)).toBe(true);
  });

  it('parseLocalDate does not TZ-shift a YYYY-MM-DD string', () => {
    expect(parseLocalDate('2026-06-03').getDate()).toBe(3);
  });

  it('monthLabel + addMonths cross year boundaries', () => {
    expect(monthLabel(2026, 5)).toBe('June 2026');
    expect(addMonths({ year: 2026, month: 11 }, 1)).toEqual({ year: 2027, month: 0 });
    expect(addMonths({ year: 2026, month: 0 }, -1)).toEqual({ year: 2025, month: 11 });
  });

  it('todayCursor returns the current year/month', () => {
    const now = new Date();
    expect(todayCursor()).toEqual({ year: now.getFullYear(), month: now.getMonth() });
  });
});
