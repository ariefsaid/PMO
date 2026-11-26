import { describe, it, expect, vi } from 'vitest';
import { formatCalendarDayInTimeZone } from '@/src/lib/format';
import { buildMonthMatrix, parseLocalDate, monthLabel, addMonths, todayCursor } from './monthMatrix';

describe('monthMatrix', () => {
  it('AC-CAL-008: returns 6×7 days with adjacent-month days flagged and the 1st on the right weekday', () => {
    const weeks = buildMonthMatrix(2026, 5, 0, '2026-06-15'); // month is 0-based → June 2026
    expect(weeks).toHaveLength(6);
    expect(weeks.every((w) => w.length === 7)).toBe(true);
    const flat = weeks.flat();
    const june1 = flat.find((d) => d.iso === '2026-06-01')!;
    expect(june1.inMonth).toBe(true);
    expect(weeks[0].indexOf(june1)).toBe(1); // 2026-06-01 is a Monday (Sunday-first column 1)
    expect(flat.filter((d) => d.inMonth)).toHaveLength(30);
    expect(flat.some((d) => !d.inMonth)).toBe(true);
  });

  it('weekStartsOn=1 lays the grid out Monday-first (the Bahasa calendar)', () => {
    const weeks = buildMonthMatrix(2026, 5, 1, '2026-06-15'); // June 2026: the 1st is a Monday
    expect(weeks).toHaveLength(6);
    expect(weeks[0][0].iso).toBe('2026-06-01');
    const nov = buildMonthMatrix(2026, 10, 1, '2026-11-15'); // November 2026: the 1st is a Sunday
    expect(nov[0][0].iso).toBe('2026-10-26');
    expect(nov[0][6].iso).toBe('2026-11-01');
  });

  it('parseLocalDate does not TZ-shift a YYYY-MM-DD string', () => {
    expect(parseLocalDate('2026-06-03').getDate()).toBe(3);
  });

  it('monthLabel + addMonths cross year boundaries', () => {
    expect(monthLabel(2026, 5)).toBe('June 2026');
    expect(addMonths({ year: 2026, month: 11 }, 1)).toEqual({ year: 2027, month: 0 });
    expect(addMonths({ year: 2026, month: 0 }, -1)).toEqual({ year: 2025, month: 11 });
  });

  it('#1126 the today cell is the day the caller passes, not the clock\'s', () => {
    const weeks = buildMonthMatrix(2026, 10, 0, '2026-11-26'); // November 2026, Sunday-first
    const flat = weeks.flat();
    expect(flat.find((d) => d.iso === '2026-11-26')?.isToday).toBe(true);
    expect(flat.filter((d) => d.isToday)).toHaveLength(1);
    // A different passed day marks a different cell (the helper reads no clock).
    const other = buildMonthMatrix(2026, 10, 1, '2026-11-01');
    expect(other.flat().find((d) => d.iso === '2026-11-01')?.isToday).toBe(true);
    expect(other.flat().find((d) => d.iso === '2026-11-26')?.isToday).toBe(false);
  });

  it('AC-2911-007: the cursor follows the organisation across month-end midnight', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      vi.setSystemTime(new Date('2026-11-30T16:59:59Z'));
      expect(todayCursor(formatCalendarDayInTimeZone(new Date(), 'Asia/Jakarta'))).toEqual({ year: 2026, month: 10 });
      vi.setSystemTime(new Date('2026-11-30T17:00:00Z'));
      expect(todayCursor(formatCalendarDayInTimeZone(new Date(), 'Asia/Jakarta'))).toEqual({ year: 2026, month: 11 });
    } finally {
      vi.useRealTimers();
    }
  });
});
