import { afterEach, describe, expect, it, vi } from 'vitest';
import { resetActiveLocale, setActiveLocale } from '@/src/lib/locale/activeLocale';
import { formatCurrency, formatExactMoney, formatNumberMax2 } from '@/src/lib/format';
import { milli } from '@/src/lib/progressBilling';
import { localToday } from '@/src/lib/efaktur';

const EN = { locale: 'en', numberLocale: 'en-US', timezone: 'UTC' } as const;
const norm = (value: string) => value.replace(/\u00a0/g, ' ');

afterEach(() => resetActiveLocale());

/**
 * Characterization pins for the money/quantity/date display helpers the T-34 share-out touches.
 * Every assertion was recorded from the SHIPPED output before the refactor: displayed amounts,
 * currencies and rounding must not change for any user. The locale seam is pinned to en-US here
 * so the byte-exact strings are deterministic; the locale-aware variants are covered in
 * format.locale.test.ts.
 */
describe('whole-unit money display — formatCurrency (pinned pre-refactor)', () => {
  it('IDR renders NO decimals: whole rupiah only, a fraction rounds to the unit', () => {
    setActiveLocale(EN);
    expect(norm(formatCurrency(1_500_000, 'IDR'))).toBe('IDR 1,500,000');
    expect(norm(formatCurrency(150_000, 'IDR'))).toBe('IDR 150,000');
    expect(norm(formatCurrency(1_500_000.75, 'IDR'))).toBe('IDR 1,500,001');
    expect(norm(formatCurrency(1_500_000.49, 'IDR'))).toBe('IDR 1,500,000');
  });

  it('USD rounds to the whole unit and groups thousands; the sign stays outside the symbol', () => {
    setActiveLocale(EN);
    expect(formatCurrency(1234, 'USD')).toBe('$1,234');
    expect(formatCurrency(1234.56, 'USD')).toBe('$1,235');
    expect(formatCurrency(-1234.5, 'USD')).toBe('-$1,235');
    expect(formatCurrency(1_234_567.89, 'USD')).toBe('$1,234,568');
  });

  it('a null value stays null in the exact-decimal money display (no zero coercion)', () => {
    expect(formatExactMoney(null, 'USD', 'en-US')).toBeNull();
    expect(formatExactMoney(null, 'IDR', 'en-US', { wholeUnits: true })).toBeNull();
  });
});

describe('formatNumberMax2 — at most two fraction digits, viewer grouping (pinned pre-refactor)', () => {
  it('drops trailing zeros beyond two decimals and rounds, negatives included', () => {
    expect(formatNumberMax2(1234)).toBe('1,234');
    expect(formatNumberMax2(1234.5)).toBe('1,234.5');
    expect(formatNumberMax2(1234.567)).toBe('1,234.57');
    expect(formatNumberMax2(-1234.567)).toBe('-1,234.57');
  });
});

describe('milli — integer milli-unit quantity conversion (pinned before the BillingTab share-out)', () => {
  it('rounds to the nearest milli-unit; a half rounds toward positive infinity', () => {
    expect(milli(0)).toBe(0);
    expect(milli(1.5)).toBe(1500);
    expect(milli(-1.5)).toBe(-1500);
    expect(milli(2.9994)).toBe(2999);
    expect(milli(2.9995)).toBe(3000);
    expect(milli(-2.9995)).toBe(-2999);
    expect(milli(1.2345)).toBe(1235);
    expect(milli(0.0004)).toBe(0);
    expect(milli(0.0005)).toBe(1);
  });
});

describe('localToday — the browser LOCAL calendar date (pinned before the WorkOrdersTab share-out)', () => {
  it('follows the local calendar across local midnight, not the UTC day', () => {
    vi.useFakeTimers();
    try {
      // Local Date constructors keep these pins timezone-independent.
      vi.setSystemTime(new Date(2026, 5, 14, 23, 59, 59, 999));
      expect(localToday()).toBe('2026-06-14');
      vi.setSystemTime(new Date(2026, 5, 15, 0, 0, 0, 0));
      expect(localToday()).toBe('2026-06-15');
    } finally {
      vi.useRealTimers();
    }
  });
});
