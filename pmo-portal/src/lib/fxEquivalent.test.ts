import { afterEach, describe, expect, it } from 'vitest';
import { formatFxEquivalent, orgDay } from './fxEquivalent';
import { resetActiveLocale, setActiveLocale } from './locale/activeLocale';
import type { FxRateMatch } from './repositories/types';

const match: FxRateMatch = { rate: 16234.56, rate_date: '2026-10-09' };

afterEach(resetActiveLocale);

describe('display-only JISDOR equivalent', () => {
  it('uses organization calendar date across UTC midnight without the viewer timezone', () => {
    const instant = new Date('2026-10-09T17:30:00.000Z');
    expect(orgDay(instant, 'Asia/Jakarta')).toBe('2026-10-10');
    expect(orgDay(instant, 'UTC')).toBe('2026-10-09');
    expect(orgDay(instant, 'America/New_York')).toBe('2026-10-09');
  });

  it('rounds the approximation once, keeps source/date explicit and does not mutate the amount', () => {
    const amount = 100;
    expect(formatFxEquivalent(amount, match)).toBe('≈ Rp 1,623,456 (JISDOR 2026-10-09)');
    expect(formatFxEquivalent(1.01, match)).toBe('≈ Rp 16,397 (JISDOR 2026-10-09)');
    expect(formatFxEquivalent(0, match)).toBe('≈ Rp 0 (JISDOR 2026-10-09)');
    expect(amount).toBe(100);
  });

  it('groups numbers with the viewer locale while preserving Rp and the ISO source date', () => {
    setActiveLocale({ locale: 'en', numberLocale: 'en-US', timezone: 'UTC' });
    expect(formatFxEquivalent(100, match)).toContain('Rp 1,623,456');
    setActiveLocale({ locale: 'id', numberLocale: 'id-ID', timezone: 'UTC' });
    expect(formatFxEquivalent(100, match)).toBe('≈ Rp 1.623.456 (JISDOR 2026-10-09)');
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
      expect(() => formatFxEquivalent(amount, rate)).toThrow(RangeError);
    },
  );
});
