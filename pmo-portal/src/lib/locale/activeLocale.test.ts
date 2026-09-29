import { afterEach, describe, expect, it } from 'vitest';
import { getActiveLocale, getDateLocale, getNumberLocale, resetActiveLocale, setActiveLocale } from './activeLocale';
import { FALLBACK_LOCALE, FALLBACK_TIMEZONE } from './resolveLocale';
import { formatCurrency, formatDateTime, formatInstantDate, formatNumber } from '@/src/lib/format';

afterEach(() => resetActiveLocale());

const INSTANT = '2026-06-14T23:30:00.000Z';

describe('setActiveLocale falls back safely when a value is unusable (#684)', () => {
  it('an unusable timezone falls back to FALLBACK_TIMEZONE and instant formatting still renders', () => {
    setActiveLocale({ locale: 'en', numberLocale: 'en-US', timezone: 'Asia/Jakarta ' });
    expect(getActiveLocale().timezone).toBe(FALLBACK_TIMEZONE);
    expect(() => formatDateTime(new Date(INSTANT))).not.toThrow();
    // FALLBACK_TIMEZONE (Asia/Jakarta, UTC+7) puts this instant on the 15th.
    expect(formatInstantDate(INSTANT)).toBe('Jun 15, 2026');
  });

  it('an unusable number locale falls back to the language and money still renders', () => {
    setActiveLocale({ locale: 'en', numberLocale: 'en_US', timezone: 'UTC' });
    expect(getNumberLocale()).toBe('en-US');
    expect(formatCurrency(1234567, 'USD')).toBe('$1,234,567');
    expect(formatNumber(1234567)).toBe('1,234,567');
  });

  it('an unusable language falls back to FALLBACK_LOCALE for dates and numbers', () => {
    setActiveLocale({ locale: 'en ', numberLocale: 'en ', timezone: 'UTC' });
    expect(getActiveLocale().locale).toBe(FALLBACK_LOCALE);
    expect(getDateLocale()).toBe('en-US');
    expect(getNumberLocale()).toBe('en-US');
    expect(formatInstantDate(INSTANT)).toBe('Jun 14, 2026');
  });

  it('usable values pass through unchanged', () => {
    setActiveLocale({ locale: 'id', numberLocale: 'id-ID', timezone: 'UTC' });
    expect(getActiveLocale()).toEqual({ locale: 'id', numberLocale: 'id-ID', timezone: 'UTC' });
    expect(formatNumber(1234567)).toBe('1.234.567');
  });
});
