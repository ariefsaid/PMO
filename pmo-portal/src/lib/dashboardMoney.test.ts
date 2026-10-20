import { afterEach, describe, expect, it } from 'vitest';
import { getNumberLocale, resetActiveLocale, setActiveLocale } from '@/src/lib/locale/activeLocale';
import { formatDashboardMoney, moneyFigure, moneyTotalsFigure, shortMoney } from './dashboardMoney';

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
    const fig = moneyFigure(1_200_000, 'USD', 'Not available yet');
    expect(fig.value).toBe('$1.2M');
    expect(fig.value.length).toBeLessThan('$1,200,000'.length + 1);
    expect(fig.exactValue).toBe('$1,200,000');
    expect(fig.unavailableReason).toBeUndefined();
  });

  it('uses the configured number locale, independent of the UI language', () => {
    setActiveLocale({ locale: 'en', numberLocale: 'id-ID', timezone: 'UTC' });
    expect(getNumberLocale()).toBe('id-ID');
    expect(moneyFigure(1_200_000, 'USD', 'Unavailable').exactValue).toBe('US$1.200.000');
  });

  it('keeps a non-zero fraction in the exact form for an exact decimal string', () => {
    const fig = moneyFigure('29812225000.50', 'IDR', 'Unavailable');
    expect(fig.exactValue).toBe('IDR\u00a029,812,225,000.50');
    expect(fig.value).toBe('IDR\u00a029.8B');
  });

  it('drops a zero fraction from an exact decimal string', () => {
    expect(moneyFigure('5000.00', 'USD', 'x').exactValue).toBe('$5,000');
  });

  it('is an em dash with the reason when the amount is unknown (never 0, never prose)', () => {
    for (const unknown of [null, 'garbage']) {
      const fig = moneyFigure(unknown, 'USD', 'Budget not loaded');
      expect(fig.value).toBe('—');
      expect(fig.unavailableReason).toBe('Budget not loaded');
      expect(fig.exactValue).toBeUndefined();
    }
  });
});

describe('AC-RD-MONEY-001 small amounts', () => {
  it('omits the exact twin when the short form already is the exact amount', () => {
    expect(moneyFigure(500, 'USD', 'x')).toEqual({ value: '$500' });
    expect(moneyFigure(0, 'USD', 'x')).toEqual({ value: '$0' });
  });

  it('never rounds a sub-thousand amount: the exact form is shown as-is', () => {
    expect(moneyFigure(999.5, 'USD', 'x')).toEqual({ value: '$999.50' });
  });
});

describe('AC-RD-MONEY-003 short-form minors (RD-S1 discover A5/A6/A8)', () => {
  it('drops a forced ".0" and keeps one decimal only when it is non-zero', () => {
    expect(moneyFigure(56_000, 'USD', 'x').value).toBe('$56K');
    expect(moneyFigure(56_500, 'USD', 'x').value).toBe('$56.5K');
    expect(moneyFigure(30_000, 'IDR', 'x').value).toBe('IDR\u00a030K');
  });

  it('is never longer than the exact form', () => {
    for (const amount of [1_000, 1_234.5, 30_000, 56_000, 999_950, 160_890_500_000]) {
      const fig = moneyFigure(amount, 'IDR', 'x');
      expect(fig.value.length).toBeLessThanOrEqual((fig.exactValue ?? fig.value).length);
    }
  });

  it('uses the same true minus (U+2212) as the exact form', () => {
    const fig = moneyFigure(-2_500_000_000, 'IDR', 'x');
    expect(fig.value.startsWith('\u2212')).toBe(true);
    expect(fig.exactValue?.startsWith('\u2212')).toBe(true);
    expect(shortMoney(-1_200_000_000, 'IDR', 'x').startsWith('\u2212')).toBe(true);
  });

  it('names a foreign currency by its code ("USD 3.4M"), never a bare "$"', () => {
    expect(moneyFigure(3_400_000, 'USD', 'x', { code: true }).value).toBe('USD\u00a03.4M');
    expect(shortMoney(3_400_000, 'USD', 'x', { code: true })).toBe('USD\u00a03.4M');
  });
});

describe('AC-RD-MONEY-001 moneyTotalsFigure (per-currency totals, never summed)', () => {
  it('keeps each currency separate in the short and the exact form', () => {
    const fig = moneyTotalsFigure([{ currency: 'USD', amount: 1_200_000 }, { currency: 'EUR', amount: 3_000 }], 'USD', 'Unavailable');
    expect(fig.value).toBe('$1.2M · €3K');
    expect(fig.exactValue).toBe('$1,200,000 · €3,000');
  });
  it('an empty org shows a known zero in its own currency', () => {
    const fig = moneyTotalsFigure([], 'USD', 'Unavailable');
    expect(fig).toEqual({ value: '$0' });
  });
  it('keeps a non-empty unavailable reason if a currency cannot be formatted', () => {
    const fig = moneyTotalsFigure([{ currency: 'not-a-currency', amount: 12 }], 'USD', 'Revenue unavailable');
    expect(fig.value).toBe('—');
    expect(fig.unavailableReason).toBe('Revenue unavailable');
  });
});
