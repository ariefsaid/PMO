import { describe, expect, it } from 'vitest';
import { currencyEntries, currencyLead, currencyLines } from './currencyFigures';

describe('currency entries (#1459: one lead/other-currency helper)', () => {
  it('puts the preferred (org) currency first, then sorts the rest by code', () => {
    expect(currencyEntries({ USD: 100, IDR: 200, EUR: 300 }, 'IDR').map(([currency]) => currency)).toEqual(['IDR', 'EUR', 'USD']);
    expect(currencyEntries({ USD: 100, IDR: 200, EUR: 300 }).map(([currency]) => currency)).toEqual(['EUR', 'IDR', 'USD']);
  });

  it('leaves the preferred currency in its sorted place when it holds no amount', () => {
    expect(currencyEntries({ USD: 100, EUR: 300 }, 'IDR').map(([currency]) => currency)).toEqual(['EUR', 'USD']);
    expect(currencyEntries({}, 'IDR')).toEqual([]);
  });

  it('leads with a figure and keeps other currencies short, with the exact amount beside it', () => {
    const { lead, others } = currencyLead({ IDR: 12_345_600, USD: 500_000 }, 'IDR');
    expect(lead).not.toBeNull();
    expect(lead?.value).not.toContain('USD');
    expect(others).toHaveLength(1);
    expect(others[0].exactValue).toContain('USD');
  });

  it('never renders a zero other-currency line', () => {
    expect(currencyLead({ IDR: 1000, USD: 0 }, 'IDR').others).toEqual([]);
    expect(currencyLead({}, 'IDR')).toEqual({ lead: null, others: [] });
  });

  it('reads a currency list as one exact lead line and coded other lines', () => {
    const lines = currencyLines({ IDR: 100_000, USD: 250 }, 'IDR');
    expect(lines).toHaveLength(2);
    expect(lines[0]).not.toContain('USD');
    expect(lines[1]).toContain('USD');
  });
});
