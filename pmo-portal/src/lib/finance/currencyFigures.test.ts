import { describe, expect, it } from 'vitest';
import { currencyEntries, currencyLines } from './currencyFigures';

describe('currency entries (#1459: one lead/other-currency helper)', () => {
  it('puts the preferred (org) currency first, then sorts the rest by code', () => {
    expect(currencyEntries({ USD: 100, IDR: 200, EUR: 300 }, 'IDR').map(([currency]) => currency)).toEqual(['IDR', 'EUR', 'USD']);
    expect(currencyEntries({ USD: 100, IDR: 200, EUR: 300 }).map(([currency]) => currency)).toEqual(['EUR', 'IDR', 'USD']);
  });

  it('leaves the preferred currency in its sorted place when it holds no amount', () => {
    expect(currencyEntries({ USD: 100, EUR: 300 }, 'IDR').map(([currency]) => currency)).toEqual(['EUR', 'USD']);
    expect(currencyEntries({}, 'IDR')).toEqual([]);
  });



  it('reads a currency list as one exact lead line and coded other lines', () => {
    const lines = currencyLines({ IDR: 100_000, USD: 250 }, 'IDR');
    expect(lines).toHaveLength(2);
    expect(lines[0]).not.toContain('USD');
    expect(lines[1]).toContain('USD');
  });
});
