import { describe, it, expect, afterEach } from 'vitest';
import { setActiveLocale, resetActiveLocale } from '@/src/lib/locale/activeLocale';
import {
  formatDay,
  formatDayYear,
  formatMonthYearShort,
  daysOverdue,
  formatDaysOverdue,
  formatTileMoney,
  formatTableMoney,
  formatMoneyLines,
  type AgeTranslate,
} from './format';

const norm = (s: string) => s.replace(/[\u00a0\u202f]/g, ' ');
const EN = { locale: 'en', numberLocale: 'en-US', timezone: 'UTC' };
const ID = { locale: 'id', numberLocale: 'id-ID', timezone: 'Asia/Jakarta' };
const NOW = new Date('2026-11-10T12:00:00Z');

afterEach(() => resetActiveLocale());

describe('date vocabulary: 10 Nov 2026 / 10 Nov / Nov 2026', () => {
  it('formatDayYear always carries the year, day first', () => {
    setActiveLocale(EN);
    expect(formatDayYear('2026-11-10')).toBe('10 Nov 2026');
    expect(formatDayYear('2026-03-05')).toBe('5 Mar 2026');
  });

  it('formatDay drops the year only within the current year; the year boundary flips it', () => {
    setActiveLocale(EN);
    expect(formatDay('2026-11-10', NOW)).toBe('10 Nov');
    expect(formatDay('2026-01-01', NOW)).toBe('1 Jan');
    expect(formatDay('2025-12-31', NOW)).toBe('31 Dec 2025');
    expect(formatDay('2027-01-01', NOW)).toBe('1 Jan 2027');
  });

  it('the current year is the one in the viewer timezone, not UTC', () => {
    // 2026-12-31T20:00Z is already 2027-01-01 in Jakarta.
    const newYearJakarta = new Date('2026-12-31T20:00:00Z');
    setActiveLocale(ID);
    expect(formatDay('2026-12-31', newYearJakarta)).toBe('31 Des 2026');
    setActiveLocale(EN);
    expect(formatDay('2026-12-31', newYearJakarta)).toBe('31 Dec');
  });

  it('a date-only value never shifts a day; an instant follows the viewer timezone', () => {
    setActiveLocale({ ...EN, timezone: 'America/Los_Angeles' });
    expect(formatDayYear('2026-11-10')).toBe('10 Nov 2026');
    expect(formatDayYear('2026-11-10T02:00:00Z')).toBe('9 Nov 2026');
  });

  it('formatMonthYearShort is month + 4-digit year', () => {
    setActiveLocale(EN);
    expect(formatMonthYearShort('2026-11-10')).toBe('Nov 2026');
    expect(formatMonthYearShort(new Date(2026, 10, 10))).toBe('Nov 2026');
  });

  it('follows the UI language for month names, keeping the same shape', () => {
    setActiveLocale(ID);
    expect(formatDayYear('2026-08-17')).toBe('17 Agu 2026');
    expect(formatDay('2026-05-01', NOW)).toBe('1 Mei');
    expect(formatMonthYearShort('2026-11-10')).toBe('Nov 2026');
  });

  it('blank or invalid input is an em dash, never "Invalid Date"', () => {
    for (const bad of [null, undefined, '', 'nope', '2026-13-45', new Date('x')]) {
      expect(formatDay(bad as never, NOW)).toBe('—');
      expect(formatDayYear(bad as never)).toBe('—');
      expect(formatMonthYearShort(bad as never)).toBe('—');
    }
  });
});

describe('age helper', () => {
  it('counts whole calendar days past the due day', () => {
    setActiveLocale(EN);
    expect(daysOverdue('2026-11-09', NOW)).toBe(1);
    expect(daysOverdue('2026-07-15', NOW)).toBe(118);
    expect(daysOverdue('2026-11-10', NOW)).toBeNull(); // due today is not overdue
    expect(daysOverdue('2026-11-11', NOW)).toBeNull();
    expect(daysOverdue(null, NOW)).toBeNull();
  });

  it('crosses a year boundary by calendar days', () => {
    setActiveLocale(EN);
    expect(daysOverdue('2025-12-31', new Date('2026-01-02T09:00:00Z'))).toBe(2);
  });

  it('renders a number with a unit and says overdue, in both languages', () => {
    const t: AgeTranslate = (_key, o) => (o.count === 1 ? o.defaultValue_one : o.defaultValue_other).replace('{{n}}', o.n);
    setActiveLocale(EN);
    expect(formatDaysOverdue('2026-07-15', t, NOW)).toBe('118 days overdue');
    expect(formatDaysOverdue('2026-11-09', t, NOW)).toBe('1 day overdue');
    expect(formatDaysOverdue('2026-11-12', t, NOW)).toBeNull();
  });
});

describe('money vocabulary', () => {
  it('tile: 2-3 significant digits, always with currency', () => {
    setActiveLocale(EN);
    expect(norm(formatTileMoney(7_700_000_000, 'IDR')!)).toBe('IDR 7.7B');
    expect(norm(formatTileMoney(160_912_345_678, 'IDR')!)).toBe('IDR 161B');
    expect(norm(formatTileMoney(56_500, 'USD')!)).toBe('$56.5K');
    expect(norm(formatTileMoney(1_467_628_320, 'IDR')!)).toBe('IDR 1.47B');
    expect(norm(formatTileMoney(856, 'USD')!)).toBe('$856');
    expect(norm(formatTileMoney(-2_500_000, 'USD')!)).toBe('−$2.5M');
  });

  it('tile: unknown is null, never zero or a sentence', () => {
    expect(formatTileMoney(null, 'USD')).toBeNull();
    expect(formatTileMoney(Number.NaN, 'USD')).toBeNull();
    expect(norm(formatTileMoney(0, 'USD')!)).toBe('$0');
  });

  it('table: full whole-unit amount with currency; exact strings stay exact', () => {
    setActiveLocale(EN);
    expect(norm(formatTableMoney(1_467_628_320.47, 'IDR')!)).toBe('IDR 1,467,628,320');
    expect(norm(formatTableMoney('9007199254740993.00', 'USD')!)).toBe('$9,007,199,254,740,993');
    expect(norm(formatTableMoney(-1234, 'USD')!)).toBe('−$1,234');
    expect(formatTableMoney(null, 'USD')).toBeNull();
    setActiveLocale(ID);
    expect(norm(formatTableMoney(1_467_628_320, 'IDR')!)).toBe('Rp 1.467.628.320');
  });

  it('lines: home currency is the figure, other currencies are second lines, never summed or joined', () => {
    setActiveLocale(EN);
    const lines = formatMoneyLines(
      [{ currency: 'USD', amount: 5_300 }, { currency: 'IDR', amount: 7_700_000_000 }, { currency: 'SGD', amount: 1_200_000 }],
      'IDR',
      'tile',
    );
    expect(lines.lines.map(norm)).toEqual(['IDR 7.7B', '+ USD 5.3K', '+ SGD 1.2M']);
    expect(formatMoneyLines(
      [{ currency: 'USD', amount: 5_300 }, { currency: 'IDR', amount: 7_700_000_000 }],
      'IDR',
      'tile',
      { prefixOtherCurrencies: false },
    ).lines.map(norm)).toEqual(['IDR 7.7B', 'USD 5.3K']);
    expect(formatMoneyLines([{ currency: 'USD', amount: 5_300 }], 'IDR', 'table').lines.map(norm)).toEqual(['+ USD 5,300']);
    expect(formatMoneyLines([], 'IDR', 'table')).toEqual({ lines: [], unknown: true });
    expect(formatMoneyLines([{ currency: 'IDR', amount: 0 }], 'IDR', 'table').lines.map(norm)).toEqual(['IDR 0']);
    const partial = formatMoneyLines([{ currency: 'USD', amount: null }, { currency: 'IDR', amount: 5 }], 'IDR', 'table');
    expect(partial.lines.map(norm)).toEqual(['IDR 5']);
    expect(partial.unknown).toBe(true);
    expect(formatMoneyLines([{ currency: 'IDR', amount: 5 }, { currency: 'IDR', amount: 7 }], 'IDR', 'table').lines.map(norm)).toEqual(['IDR 12']);
  });
});
