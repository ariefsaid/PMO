import { describe, expect, it } from 'vitest';
import { calculateBidRates, type BidCurrencyTotals } from './winRateMetrics';

const totals: BidCurrencyTotals = {
  currency: 'IDR',
  wins_count: 2,
  losses_count: 1,
  open_count: 3,
  wins_value: 8_000_000,
  losses_value: 650_000,
  open_value: 1_000_000,
};

describe('calculateBidRates', () => {
  it('#1441 uses wins / (wins + losses) for decided count and wins / all bids for conversion', () => {
    const result = calculateBidRates(totals, 'count');

    expect(result.decided).toMatchObject({ numerator: 2, denominator: 3, rate: 2 / 3, reason: null });
    expect(result.allBids).toMatchObject({ numerator: 2, denominator: 6, rate: 1 / 3, reason: null });
  });

  it('#1441 uses same-currency money for value rates and excludes open bids only from decided rate', () => {
    const result = calculateBidRates(totals, 'value');

    expect(result.decided.numerator).toBe(8_000_000);
    expect(result.decided.denominator).toBe(8_650_000);
    expect(result.decided.rate).toBeCloseTo(8_000_000 / 8_650_000);
    expect(result.allBids.denominator).toBe(9_650_000);
    expect(result.allBids.rate).toBeCloseTo(8_000_000 / 9_650_000);
  });

  it('#1441 returns no rate and one deduplicatable plain reason when both denominators are zero', () => {
    const result = calculateBidRates({
      ...totals,
      wins_count: 0,
      losses_count: 0,
      open_count: 0,
      wins_value: 0,
      losses_value: 0,
      open_value: 0,
    }, 'value');

    expect(result.decided).toMatchObject({ rate: null, reason: 'no_bid_value' });
    expect(result.allBids).toMatchObject({ rate: null, reason: 'no_bid_value' });
    expect(new Set([result.decided.reason, result.allBids.reason]).size).toBe(1);
  });

  it('#1441 distinguishes no decided bids from a zero all-bids denominator', () => {
    const result = calculateBidRates({ ...totals, wins_count: 0, losses_count: 0 }, 'count');

    expect(result.decided).toMatchObject({ rate: null, reason: 'no_decided_bids' });
    expect(result.allBids).toMatchObject({ numerator: 0, denominator: 3, rate: 0, reason: null });
  });

  it('#1441 reports missing decided values when decided outcomes exist without a recorded amount', () => {
    const result = calculateBidRates({
      ...totals,
      wins_count: 1,
      losses_count: 0,
      open_count: 0,
      wins_value: 0,
      losses_value: 0,
      open_value: 0,
    }, 'value');

    expect(result.decided).toMatchObject({ rate: null, reason: 'no_decided_value' });
    expect(result.allBids).toMatchObject({ rate: null, reason: 'no_bid_value' });
  });
});
