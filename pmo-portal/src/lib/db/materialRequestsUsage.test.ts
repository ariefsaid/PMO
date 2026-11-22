import { describe, it, expect } from 'vitest';
import { lineUsageWarning, parseUsageThresholds } from './materialRequests';

const th = { pct1: 80, pct2: 100 };

describe('AC-MUT-009 lineUsageWarning (usage against plan, advisory)', () => {
  it('is off while both thresholds are unset', () => {
    expect(lineUsageWarning({ planQty: 100, priorQty: 90, quantity: 50 }, { pct1: null, pct2: null })).toBeNull();
    expect(lineUsageWarning({ planQty: 100, priorQty: 90, quantity: 50 }, null)).toBeNull();
  });
  it('is quiet below the first threshold', () => {
    expect(lineUsageWarning({ planQty: 100, priorQty: 40, quantity: 39 }, th)).toBeNull();
  });
  it('names the first threshold at 85 percent', () => {
    expect(lineUsageWarning({ planQty: 100, priorQty: 60, quantity: 25 }, th)).toEqual({ slot: 1, threshold: 80, reachedPct: 85 });
  });
  it('is inclusive at exactly the threshold', () => {
    expect(lineUsageWarning({ planQty: 100, priorQty: 0, quantity: 80 }, th)?.slot).toBe(1);
  });
  it('names the second threshold when both are passed', () => {
    expect(lineUsageWarning({ planQty: 100, priorQty: 100, quantity: 5 }, th)).toEqual({ slot: 2, threshold: 100, reachedPct: 105 });
  });
  it('works with one threshold set', () => {
    expect(lineUsageWarning({ planQty: 100, priorQty: 0, quantity: 60 }, { pct1: null, pct2: 50 })?.slot).toBe(2);
  });
  it('plan zero with any use is past every threshold', () => {
    expect(lineUsageWarning({ planQty: 0, priorQty: 0, quantity: 1 }, th)?.slot).toBe(2);
    expect(lineUsageWarning({ planQty: 0, priorQty: 0, quantity: 0 }, th)).toBeNull();
  });
  it('compares in thousandths so decimals do not drift', () => {
    expect(lineUsageWarning({ planQty: 0.3, priorQty: 0.1, quantity: 0.14 }, th)?.slot).toBe(1);
  });
});

describe('AC-MUT-008 parseUsageThresholds', () => {
  it('accepts empty as off and a valid pair', () => {
    expect(parseUsageThresholds('', '')).toEqual({ ok: true, value: { pct1: null, pct2: null } });
    expect(parseUsageThresholds('80', '100')).toEqual({ ok: true, value: { pct1: 80, pct2: 100 } });
  });
  it.each([['0', '100'], ['80', '1001'], ['abc', ''], ['-5', '']])('refuses %s / %s as out of range', (a, b) => {
    expect(parseUsageThresholds(a, b)).toEqual({ ok: false, error: 'range' });
  });
  it('refuses a second threshold that is not above the first', () => {
    expect(parseUsageThresholds('90', '90')).toEqual({ ok: false, error: 'order' });
    expect(parseUsageThresholds('90', '80')).toEqual({ ok: false, error: 'order' });
  });
});
