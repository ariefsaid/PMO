import { describe, it, expect } from 'vitest';
import { sumPerCurrency } from './sumPerCurrency';

describe('sumPerCurrency (#831)', () => {
  it('AC-831-3: sums within a currency, never across, in first-seen order', () => {
    const rows = [
      { currency: 'USD', v: 1 },
      { currency: 'IDR', v: 1000 },
      { currency: 'USD', v: 2 },
    ];
    expect(sumPerCurrency(rows, (r) => r.v)).toEqual([
      { currency: 'USD', amount: 3 },
      { currency: 'IDR', amount: 1000 },
    ]);
  });

  it('AC-831-3: empty input yields no totals', () => {
    expect(sumPerCurrency<{ currency: string }>([], () => 0)).toEqual([]);
  });
});
