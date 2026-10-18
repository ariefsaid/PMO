import { afterEach, describe, expect, it } from 'vitest';
import { getActiveLocale, setActiveLocale } from '@/src/lib/locale/activeLocale';
import { formatNativeStatementAmount } from './nativeStatementPresentation';

const localeBeforeTest = getActiveLocale();

afterEach(() => setActiveLocale(localeBeforeTest));

describe('formatNativeStatementAmount', () => {
  it('AC-008 preserves every decimal digit while applying en-US grouping and decimal symbols', () => {
    expect(formatNativeStatementAmount('9007199254740993.1234567890123456789', 'en-US'))
      .toBe('9,007,199,254,740,993.1234567890123456789');
  });

  it('AC-008 uses number preference independently from UI language and preserves fractional scale', () => {
    setActiveLocale({ locale: 'en', numberLocale: 'id-ID', timezone: 'UTC' });
    expect(formatNativeStatementAmount('1234567.12000000000000000009')).toBe('1.234.567,12000000000000000009');
    expect(formatNativeStatementAmount('1234567.12000000000000000009', 'en-US'))
      .toBe('1,234,567.12000000000000000009');
  });

  it('AC-008 preserves nine fractional digits as well as longer native scales', () => {
    expect(formatNativeStatementAmount('123.123456789', 'en-US')).toBe('123.123456789');
    expect(formatNativeStatementAmount('123.1234567890123456789012', 'id-ID')).toBe('123,1234567890123456789012');
  });

  it('AC-008 preserves the sign and explicit scale of positive and negative zero', () => {
    expect(formatNativeStatementAmount('0', 'en-US')).toBe('0');
    expect(formatNativeStatementAmount('-0.0', 'en-US')).toBe('-0.0');
    expect(formatNativeStatementAmount('-0.0', 'id-ID')).toBe('-0,0');
  });

  it('AC-008 localizes fractional digits and keeps exponent spelling and digits without expansion', () => {
    expect(formatNativeStatementAmount('9.007199254740993123456789e+010', 'id-ID'))
      .toBe('9,007199254740993123456789e+010');
    expect(formatNativeStatementAmount('1.20E-004', 'en-US')).toBe('1.20E-004');
  });

  it('AC-008 follows locale grouping conventions instead of assuming groups of three', () => {
    expect(formatNativeStatementAmount('123456789.25', 'hi-IN')).toBe('12,34,56,789.25');
  });

  it('AC-008 localizes non-Latin digits without converting the amount through Number', () => {
    expect(formatNativeStatementAmount('1234.50', 'ar-EG')).toBe('١٬٢٣٤٫٥٠');
  });

  it.each(['', '+1', '01', '1.', '.1', '1e', 'NaN', ' 1', '1_000'])('rejects malformed decimal token %j', (token) => {
    expect(() => formatNativeStatementAmount(token, 'en-US')).toThrow(TypeError);
  });

  it('rejects tokens outside the parser’s established lexical bound', () => {
    expect(() => formatNativeStatementAmount(`1.${'2'.repeat(128)}`, 'en-US')).toThrow(TypeError);
  });

  it('lets Intl report an invalid explicit locale as a RangeError', () => {
    expect(() => formatNativeStatementAmount('1.20', 'not_a_locale')).toThrow(RangeError);
  });
});
