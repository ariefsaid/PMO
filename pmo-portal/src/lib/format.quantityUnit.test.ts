import { describe, it, expect, afterEach } from 'vitest';
import { formatQuantityUnit } from './format';
import { resetActiveLocale, setActiveLocale } from './locale/activeLocale';

afterEach(() => resetActiveLocale());

describe('formatQuantityUnit', () => {
  it('names hours and days in the reader\'s language with the exact quantity', () => {
    setActiveLocale({ locale: 'en', numberLocale: 'en-US', timezone: 'UTC' });
    expect(formatQuantityUnit(9, 'hours')).toBe('9 hours');
    expect(formatQuantityUnit(1, 'hours')).toBe('1 hour');
    expect(formatQuantityUnit(2, 'days')).toBe('2 days');
    setActiveLocale({ locale: 'id', numberLocale: 'id-ID', timezone: 'Asia/Jakarta' });
    expect(formatQuantityUnit(7.5, 'hours')).toBe('7,5 jam');
    expect(formatQuantityUnit(3, 'days')).toBe('3 hari');
  });
  it('keeps any other unit as stored and shows a bare number without one', () => {
    setActiveLocale({ locale: 'id', numberLocale: 'id-ID', timezone: 'Asia/Jakarta' });
    expect(formatQuantityUnit(18000, 'm3')).toBe('18.000 m3');
    expect(formatQuantityUnit(4, null)).toBe('4');
  });
});
