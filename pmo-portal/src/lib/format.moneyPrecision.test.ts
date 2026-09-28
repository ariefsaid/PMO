import { afterEach, describe, expect, it } from 'vitest';
import { resetActiveLocale, setActiveLocale } from '@/src/lib/locale/activeLocale';
import {
  formatMoneyInputValue,
  parseMoneyInputAtScale,
  parseNeutralMoneyInput,
  parseNeutralMoneyInputAtScale,
} from './format';

const EN = { locale: 'en', numberLocale: 'en-US', timezone: 'UTC' };
const ID = { locale: 'id', numberLocale: 'id-ID', timezone: 'Asia/Jakarta' };

afterEach(() => resetActiveLocale());

describe('money target precision', () => {
  it('AC-PLC-009: applies the target scale after locale parsing without rounding', () => {
    setActiveLocale(ID);
    expect(parseMoneyInputAtScale('1.234', 2)).toBe(1234);
    expect(parseMoneyInputAtScale('0,29', 2)).toBe(0.29);
    expect(parseMoneyInputAtScale('1,2300', 2)).toBe(1.23);
    expect(parseMoneyInputAtScale('123,456', 2)).toBeNull();

    setActiveLocale(EN);
    expect(parseMoneyInputAtScale('1.234', 2)).toBeNull();
    expect(parseMoneyInputAtScale('1e-3', 2)).toBeNull();
    expect(parseMoneyInputAtScale('1e-2', 2)).toBe(0.01);
    // Number()-accepted hexadecimal stays an integer contract, so it fits any scale.
    expect(parseMoneyInputAtScale('0x10', 2)).toBe(16);
  });

  it('keeps neutral import values dot-decimal and independent of the active locale', () => {
    for (const locale of [ID, EN]) {
      setActiveLocale(locale);
      expect(parseNeutralMoneyInput('1.234')).toBe(1.234);
      expect(parseNeutralMoneyInput('1,234.56')).toBe(1234.56);
      expect(parseNeutralMoneyInput('12,34')).toBeNull();
      expect(parseNeutralMoneyInputAtScale('1.234', 2)).toBeNull();
      expect(parseNeutralMoneyInputAtScale('1.2300', 2)).toBe(1.23);
      expect(parseNeutralMoneyInputAtScale('1,234.56', 2)).toBe(1234.56);
    }
  });

  it('AC-PLC-009: seeds an edit draft from a stored number that round-trips in the viewer convention', () => {
    setActiveLocale(ID);
    expect(formatMoneyInputValue(1234.5)).toBe('1.234,5');
    expect(formatMoneyInputValue(5000000)).toBe('5.000.000');
    expect(parseMoneyInputAtScale(formatMoneyInputValue(1234.56), 2)).toBe(1234.56);

    setActiveLocale(EN);
    expect(formatMoneyInputValue(1234.5)).toBe('1,234.5');
    expect(formatMoneyInputValue(-0.25)).toBe('-0.25');
    expect(parseMoneyInputAtScale(formatMoneyInputValue(1234.56), 2)).toBe(1234.56);
  });
});
