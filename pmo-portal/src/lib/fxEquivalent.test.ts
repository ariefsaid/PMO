import { afterEach, describe, expect, it } from 'vitest';
import { formatCalendarDayInTimeZone } from './format';
import type { TFunction } from 'i18next';
import { formatFxEquivalent, formatFxRate, formatIdrApprox, fxRateCaption, fxRateSourceNote } from './fxEquivalent';
import en from '../../public/locales/en/finance.json';
import id from '../../public/locales/id/finance.json';
import { resetActiveLocale, setActiveLocale } from './locale/activeLocale';
import type { FxRateMatch } from './repositories/types';

// A tiny catalogue-backed translator: interpolates {{x}} from the shipped locale files.
const translator = (catalogue: { fx: Record<string, string> }): TFunction =>
  ((key: string, _default: string, vars: Record<string, string> = {}) =>
    catalogue.fx[key.replace(/^finance:fx\./, '')].replace(/\{\{(\w+)\}\}/g, (_m, name: string) => vars[name])) as unknown as TFunction;
const t = translator(en);
const tId = translator(id);

const match: FxRateMatch = { rate: 16234.56, rate_date: '2026-10-09' };

afterEach(resetActiveLocale);

describe('display-only JISDOR equivalent', () => {
  it('the FX org day uses the organization calendar date across UTC midnight without the viewer timezone', () => {
    const instant = new Date('2026-10-09T17:30:00.000Z');
    expect(formatCalendarDayInTimeZone(instant, 'Asia/Jakarta')).toBe('2026-10-10');
    expect(formatCalendarDayInTimeZone(instant, 'UTC')).toBe('2026-10-09');
    expect(formatCalendarDayInTimeZone(instant, 'America/New_York')).toBe('2026-10-09');
  });

  it('formats amount and rate as "≈ IDR … (using IDR … rate)" and leaves the amount untouched', () => {
    const amount = 100;
    expect(formatFxEquivalent(amount, match, t)).toBe('≈ IDR 1,623,456 (using IDR 16,234.56 rate)');
    expect(formatFxEquivalent(1.01, match, t)).toBe('≈ IDR 16,397 (using IDR 16,234.56 rate)');
    expect(formatFxEquivalent(0, match, t)).toBe('≈ IDR 0 (using IDR 16,234.56 rate)');
    expect(amount).toBe(100);
  });

  it('prints a whole rate with thousands separators and no decimals, a fractional rate with at most two', () => {
    expect(formatFxEquivalent(100000, { rate: 18500, rate_date: '2026-10-09' }, t)).toBe('≈ IDR 1,850,000,000 (using IDR 18,500 rate)');
    expect(formatFxRate(16234.567)).toBe('16,234.57');
    expect(formatFxRate(16234.5)).toBe('16,234.5');
  });

  it('keeps the publication date out of the visible text and in the source note', () => {
    expect(formatFxEquivalent(100, match, t)).not.toContain('2026-10-09');
    expect(fxRateSourceNote(match, t)).toBe('JISDOR rate of 2026-10-09');
  });

  it('a total of rows converted at their own date says so instead of naming one rate', () => {
    expect(formatFxEquivalent(100, match, t, { eachDate: true })).toBe('≈ IDR 1,623,456 (using IDR rate of each date)');
  });

  it('writes the Indonesian form with the viewer number locale', () => {
    setActiveLocale({ locale: 'id', numberLocale: 'id-ID', timezone: 'UTC' });
    expect(formatFxEquivalent(100000, { rate: 18500, rate_date: '2026-10-09' }, tId)).toBe('≈ IDR 1.850.000.000 (kurs IDR 18.500)');
    expect(formatFxEquivalent(100, match, tId)).toBe('≈ IDR 1.623.456 (kurs IDR 16.234,56)');
    expect(formatFxEquivalent(100, match, tId, { eachDate: true })).toBe('≈ IDR 1.623.456 (kurs IDR tiap tanggal)');
  });

  it('the card caption names the rate and the rupiah figure carries ≈ IDR', () => {
    expect(fxRateCaption({ rate: 18500, rate_date: '2026-10-09' }, t)).toBe('using IDR 18,500 rate');
    expect(formatIdrApprox(1070000000)).toBe('≈ IDR 1,070,000,000');
  });

  it.each([
    [Number.NaN, match],
    [Infinity, match],
    [100, { ...match, rate: Infinity }],
    [100, { ...match, rate: -1 }],
    // S-38: a zero rate is an unknown rate, not a free conversion — it must refuse, never format.
    [100, { ...match, rate: 0 }],
  ] as const)(
    'refuses an invalid amount or rate rather than formatting a false number',
    (amount, rate) => {
      expect(() => formatFxEquivalent(amount, rate, t)).toThrow(RangeError);
    },
  );
});
