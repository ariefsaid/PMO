import { afterEach, describe, expect, it } from 'vitest';
import { resetActiveLocale, setActiveLocale } from '@/src/lib/locale/activeLocale';
import {
  formatDateOnly,
  formatDateOnlyNumeric,
  formatDateTime,
  formatInstantDate,
  formatInstantDateNumeric,
  formatRelativeTime,
} from './format';

const EN = { locale: 'en', numberLocale: 'en-US', timezone: 'UTC' };

afterEach(() => resetActiveLocale());

describe('profile-timezone date formatting', () => {
  it('AC-PLC-005: uses the profile timezone for instant-derived date, time, and numeric date shapes', () => {
    const instant = '2026-06-14T23:30:00.000Z';
    setActiveLocale(EN);
    expect(formatInstantDate(instant)).toBe('Jun 14, 2026');
    expect(formatInstantDateNumeric(instant)).toBe('6/14/2026');
    expect(formatDateTime(new Date(instant))).toMatch(/11:30\s*PM/);

    setActiveLocale({ ...EN, timezone: 'Asia/Jakarta' });
    expect(formatInstantDate(instant)).toBe('Jun 15, 2026');
    expect(formatInstantDateNumeric(instant)).toBe('6/15/2026');
    expect(formatDateTime(new Date(instant))).toMatch(/06:30\s*AM/);
  });

  it('keeps ISO date-only values on their calendar day across profile timezones', () => {
    setActiveLocale({ ...EN, timezone: 'UTC' });
    const date = formatDateOnly('2026-06-14');
    const numericDate = formatDateOnlyNumeric('2026-06-14');
    setActiveLocale({ ...EN, timezone: 'Pacific/Honolulu' });

    expect(formatDateOnly('2026-06-14')).toBe(date);
    expect(formatDateOnlyNumeric('2026-06-14')).toBe(numericDate);
    expect(date).toBe('Jun 14, 2026');
    expect(numericDate).toBe('6/14/2026');
  });

  it('keeps elapsed relative time independent of timezone and rejects invalid date inputs', () => {
    const elapsed = new Date(Date.now() - 60_000).toISOString();
    setActiveLocale({ ...EN, timezone: 'UTC' });
    const relativeUtc = formatRelativeTime(elapsed);
    setActiveLocale({ ...EN, timezone: 'Asia/Jakarta' });

    expect(formatRelativeTime(elapsed)).toBe(relativeUtc);
    expect(formatDateOnly('not-a-date')).toBe('—');
    expect(formatInstantDate('not-a-date')).toBe('—');
    expect(formatInstantDateNumeric('')).toBe('—');
  });
});
