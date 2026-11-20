import { describe, expect, it } from 'vitest';
import { dsrLineAmountCents, dsrReportRevenue } from '../dsrRevenue';

describe('daily site report revenue (FR-DSR-010, NFR-DSR-003)', () => {
  it('AC-DSR-003 quantity 10 at a rate of 5 is exactly 50.00', () => {
    expect(dsrLineAmountCents('10', '5')).toBe(5000n);
    expect(dsrReportRevenue([{ quantity: 10, rate: 5 }]).total).toBe('50.00');
  });

  it('AC-DSR-003 three lines of 0.1 x 3 total 0.90 with no float error', () => {
    const r = dsrReportRevenue([
      { quantity: 0.1, rate: 3 },
      { quantity: '0.1', rate: '3' },
      { quantity: 0.1, rate: 3 },
    ]);
    expect(r.total).toBe('0.90');
    expect(r.totalCents).toBe(90n);
  });

  it('rounds each line half-up to cents once, as the database does', () => {
    expect(dsrLineAmountCents('0.125', '1')).toBe(13n);
    expect(dsrLineAmountCents('0.333', '4')).toBe(133n);
    // a sub-stage rate carries more decimals: 80% of 5.55 = 4.44
    expect(dsrLineAmountCents('1.5', '4.44')).toBe(666n);
    expect(dsrLineAmountCents('3', '1.23456789')).toBe(370n);
  });

  it('AC-DSR-004 a line with no rate shows no amount, counts as unrated and adds 0', () => {
    const r = dsrReportRevenue([
      { quantity: 10, rate: 5 },
      { quantity: 2, rate: null },
    ]);
    expect(r.lines[1]).toEqual({ amountCents: null, amount: null, unrated: true });
    expect(r.unratedCount).toBe(1);
    expect(r.total).toBe('50.00');
  });

  it('refuses a malformed number instead of guessing', () => {
    expect(dsrLineAmountCents('1e3', '1')).toBeNull();
    expect(dsrLineAmountCents('abc', '1')).toBeNull();
    expect(dsrReportRevenue([{ quantity: 'x', rate: 1 }]).unratedCount).toBe(1);
  });

  it('an empty report totals 0.00', () => {
    expect(dsrReportRevenue([])).toEqual({ lines: [], totalCents: 0n, total: '0.00', unratedCount: 0 });
  });
});
