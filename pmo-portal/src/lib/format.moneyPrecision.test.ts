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

// DD-I18N-10: a spreadsheet formula cell reaches the neutral parser as the shortest round-trip
// string of a binary double (`String(cell.text)`), so `=1234.5+0.06` arrives as
// `1234.5600000000002`. That tail is float noise, not user precision: within
// max(1e-9, 5e-16 × |value|) of a scale-2 value it snaps to that value. Genuine extra precision
// is still rejected — at |value| < 1e12 (the whole numeric(14,2) range) the tolerance stays
// below the 0.001 a real third decimal is away from its nearest cent.
describe('DD-I18N-10: neutral import float-noise tolerance', () => {
  it('AC-PLC-009: snaps binary float noise to the nearest scale-2 value under either viewer locale', () => {
    for (const locale of [ID, EN]) {
      setActiveLocale(locale);
      expect(parseNeutralMoneyInputAtScale('1234.5600000000002', 2)).toBe(1234.56);
      expect(parseNeutralMoneyInputAtScale(String(1234.5 + 0.06 + 1e-13), 2)).toBe(1234.56);
      expect(parseNeutralMoneyInputAtScale('0.30000000000000004', 2)).toBe(0.3);
      expect(parseNeutralMoneyInputAtScale('-1234.5600000000002', 2)).toBe(-1234.56);
      expect(parseNeutralMoneyInputAtScale('1,234.5600000000002', 2)).toBe(1234.56);
      expect(parseNeutralMoneyInputAtScale('12.000000000000002', 0)).toBe(12);
      // Noise that never goes negative-zero: a tiny negative residue lands on a clean 0.
      expect(Object.is(parseNeutralMoneyInputAtScale('-0.0000000000000001', 2), 0)).toBe(true);
    }
  });

  it('scales the tolerance with magnitude, so large-amount formula noise is still recognised', () => {
    setActiveLocale(EN);
    // `=10000000.1*3` — 3.7e-9 away from 30000000.30, beyond a flat 1e-9 but a handful of ULPs.
    const formula = String(10000000.1 * 3);
    expect(formula).toBe('30000000.299999997');
    expect(parseNeutralMoneyInputAtScale(formula, 2)).toBe(30000000.3);
  });

  it('still rejects genuine extra precision (no write) at every magnitude of a numeric(14,2) column', () => {
    for (const locale of [ID, EN]) {
      setActiveLocale(locale);
      expect(parseNeutralMoneyInputAtScale('1234.567', 2)).toBeNull();
      expect(parseNeutralMoneyInputAtScale('1234.561', 2)).toBeNull();
      expect(parseNeutralMoneyInputAtScale('1234.5600001', 2)).toBeNull();
      expect(parseNeutralMoneyInputAtScale('30000000.301', 2)).toBeNull();
      expect(parseNeutralMoneyInputAtScale('999999999999.991', 2)).toBeNull();
      expect(parseNeutralMoneyInputAtScale('999999999999.999', 2)).toBeNull();
    }
  });

  it('guarantees only the third decimal: a fourth is absorbed once the relative tolerance reaches it', () => {
    // DD-I18N-10's stated limit, pinned so the ruling cannot drift from the code.
    setActiveLocale(EN);
    expect(parseNeutralMoneyInputAtScale('1234.5601', 2)).toBeNull();
    expect(parseNeutralMoneyInputAtScale('100000000000.0001', 2)).toBeNull();
    expect(parseNeutralMoneyInputAtScale('300000000000.0001', 2)).toBe(300000000000);
    expect(parseNeutralMoneyInputAtScale('1234.5600000001', 2)).toBe(1234.56);
  });

  it('never extends the tolerance to on-screen entry, where every typed digit is the user\'s', () => {
    setActiveLocale(EN);
    expect(parseMoneyInputAtScale('1234.5600000000002', 2)).toBeNull();
  });
});
