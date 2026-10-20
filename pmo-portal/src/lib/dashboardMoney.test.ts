import { afterEach, describe, expect, it } from 'vitest';
import { resetActiveLocale } from '@/src/lib/locale/activeLocale';
import { formatCompactCurrency } from './format';
import { formatDashboardMoney, moneyFigure, moneyTotalsFigure } from './dashboardMoney';

afterEach(() => resetActiveLocale());

describe('AC-RD-MONEY-001 formatDashboardMoney (exact form)', () => {
  it('suppresses a zero fraction', () => {
    expect(formatDashboardMoney(160_890_500_000, 'IDR', 'en-US')).toBe('IDR\u00a0160,890,500,000');
    expect(formatDashboardMoney(1_200_000, 'USD', 'en-US')).toBe('$1,200,000');
  });

  it('keeps a non-zero fraction exact', () => {
    expect(formatDashboardMoney(1234.5, 'USD', 'en-US')).toBe('$1,234.50');
    expect(formatDashboardMoney(0.07, 'USD', 'en-US')).toBe('$0.07');
  });

  it('keeps the sign on a negative whole amount', () => {
    expect(formatDashboardMoney(-2_500, 'USD', 'en-US')).toBe('−$2,500');
  });

  it('is null (unavailable) for null or non-finite input, never 0', () => {
    expect(formatDashboardMoney(null, 'USD', 'en-US')).toBeNull();
    expect(formatDashboardMoney(Number.NaN, 'USD', 'en-US')).toBeNull();
  });
});

describe('AC-RD-MONEY-001 moneyFigure (short visible, exact in metadata)', () => {
  it('shows the short form for a large value and carries the exact amount', () => {
    const fig = moneyFigure(1_200_000, 'USD', 'en-US', 'Not available yet');
    expect(fig.value).toBe(formatCompactCurrency(1_200_000, 'USD'));
    expect(fig.value).toMatch(/1\.2/);
    expect(fig.value.length).toBeLessThan('$1,200,000'.length + 1);
    expect(fig.exactValue).toBe('$1,200,000');
    expect(fig.unavailableReason).toBeUndefined();
  });

  it('keeps a non-zero fraction in the exact form for an exact decimal string', () => {
    const fig = moneyFigure('29812225000.50', 'IDR', 'en-US', 'Unavailable');
    expect(fig.exactValue).toBe('IDR\u00a029,812,225,000.50');
    expect(fig.value).toBe(formatCompactCurrency(29_812_225_000.5, 'IDR'));
  });

  it('drops a zero fraction from an exact decimal string', () => {
    expect(moneyFigure('5000.00', 'USD', 'en-US', 'x').exactValue).toBe('$5,000');
  });

  it('is an em dash with the reason when the amount is unknown (never 0, never prose)', () => {
    for (const unknown of [null, 'garbage']) {
      const fig = moneyFigure(unknown, 'USD', 'en-US', 'Budget not loaded');
      expect(fig.value).toBe('—');
      expect(fig.unavailableReason).toBe('Budget not loaded');
      expect(fig.exactValue).toBeUndefined();
    }
  });
});

describe('AC-RD-MONEY-001 small amounts', () => {
  it('omits the exact twin when the short form already is the exact amount', () => {
    expect(moneyFigure(500, 'USD', 'en-US', 'x')).toEqual({ value: '$500' });
  });
});

describe('AC-RD-MONEY-001 moneyTotalsFigure (per-currency totals, never summed)', () => {
  it('keeps each currency separate in the short and the exact form', () => {
    const fig = moneyTotalsFigure([{ currency: 'USD', amount: 1_200_000 }, { currency: 'EUR', amount: 3_000 }], 'USD', 'en-US');
    expect(fig.value).toBe('$1.2M · €3.0K');
    expect(fig.exactValue).toBe('$1,200,000 · €3,000');
  });
  it('an empty org shows a known zero in its own currency', () => {
    const fig = moneyTotalsFigure([], 'USD', 'en-US');
    expect(fig).toEqual({ value: '$0' });
  });
});
