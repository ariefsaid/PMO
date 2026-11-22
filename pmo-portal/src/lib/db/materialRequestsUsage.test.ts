import { describe, it, expect } from 'vitest';
import { lineUsageWarning, parseUsageThreshold } from './materialRequests';

describe('AC-UW-010 lineUsageWarning (installed against plan, advisory)', () => {
  it('is off while the threshold is unset', () => {
    expect(lineUsageWarning({ planQty: 100, installedQty: 90 }, null)).toBeNull();
    expect(lineUsageWarning({ planQty: 100, installedQty: 90 }, undefined)).toBeNull();
  });
  it('is quiet below the threshold', () => {
    expect(lineUsageWarning({ planQty: 100, installedQty: 79.9 }, 80)).toBeNull();
  });
  it('names the percent reached at 85', () => {
    expect(lineUsageWarning({ planQty: 100, installedQty: 85 }, 80)).toEqual({ threshold: 80, reachedPct: 85 });
  });
  it('is inclusive at exactly the threshold', () => {
    expect(lineUsageWarning({ planQty: 100, installedQty: 80 }, 80)).not.toBeNull();
  });
  it('plan zero with any installed quantity is past the threshold; nothing installed is not', () => {
    expect(lineUsageWarning({ planQty: 0, installedQty: 1 }, 80)).toEqual({ threshold: 80, reachedPct: Infinity });
    expect(lineUsageWarning({ planQty: 0, installedQty: 0 }, 80)).toBeNull();
  });
  it('compares in thousandths so decimals do not drift', () => {
    expect(lineUsageWarning({ planQty: 0.3, installedQty: 0.24 }, 80)).not.toBeNull();
  });
});

describe('AC-UW-011 parseUsageThreshold', () => {
  it('accepts empty as off and a valid value', () => {
    expect(parseUsageThreshold('')).toEqual({ ok: true, value: null });
    expect(parseUsageThreshold(' 80 ')).toEqual({ ok: true, value: 80 });
  });
  it.each(['0', '1001', 'abc', '-5'])('refuses %s as out of range', (a) => {
    expect(parseUsageThreshold(a)).toEqual({ ok: false, error: 'range' });
  });
});
