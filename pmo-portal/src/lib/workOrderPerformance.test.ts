import { describe, expect, it } from 'vitest';
import {
  deriveProjectPerformance,
  deriveWorkOrderPerformance,
  readIndex,
  type PerformanceRow,
} from './workOrderPerformance';

const base: PerformanceRow = {
  workOrderId: 'w1', woNumber: 'WO-1', title: 'One', status: 'Issued', currency: 'IDR',
  asOf: '2026-01-04', startDate: '2026-01-01', endDate: '2026-01-10',
  bac: '1000000.00', ev: '300000.00', unratedLines: 0, pv: '400000.00',
  ac: '250000.00', acStatus: 'complete', undatedCostLines: 0,
};
const BANDS = { low: '0.90', high: '1.10' };

describe('AC-CSP-001 hand calculation', () => {
  it('derives EV, PV, AC, SPI, CPI and variances', () => {
    const d = deriveWorkOrderPerformance(base, BANDS);
    expect(d.spi).toEqual({ state: 'value', value: '0.75', reading: 'below' });
    expect(d.cpi).toEqual({ state: 'value', value: '1.20', reading: 'above' });
    expect(d.ev).toBe('300000.00');
    expect(d.pv).toBe('400000.00');
    expect(d.ac).toBe('250000.00');
    expect(d.scheduleVariance).toBe('-100000.00');
    expect(d.costVariance).toBe('50000.00');
  });
});

describe('AC-CSP-002 undefined cases', () => {
  it('no CPI when AC is 0, never infinity or 0', () => {
    const d = deriveWorkOrderPerformance({ ...base, ac: '0.00' }, BANDS);
    expect(d.cpi).toEqual({ state: 'no-cost' });
    expect(d.spi.state).toBe('value');
  });
  it('no SPI when PV is undefined, CPI still shows', () => {
    const d = deriveWorkOrderPerformance({ ...base, pv: null, startDate: null }, BANDS);
    expect(d.spi).toEqual({ state: 'no-dates' });
    expect(d.cpi.state).toBe('value');
  });
  it('unrated lines hide both indices', () => {
    const d = deriveWorkOrderPerformance({ ...base, unratedLines: 2 }, BANDS);
    expect(d.cpi).toEqual({ state: 'unrated', count: 2 });
    expect(d.spi).toEqual({ state: 'unrated', count: 2 });
  });
  it('incomplete or not comparable AC hides CPI', () => {
    expect(deriveWorkOrderPerformance({ ...base, acStatus: 'incomplete', undatedCostLines: 1 }, BANDS).cpi)
      .toEqual({ state: 'ac-incomplete', undated: 1 });
    expect(deriveWorkOrderPerformance({ ...base, acStatus: 'not_comparable' }, BANDS).cpi)
      .toEqual({ state: 'not-comparable' });
  });
  it('Draft and Cancelled have no figures', () => {
    expect(deriveWorkOrderPerformance({ ...base, status: 'Cancelled' }, BANDS).cpi).toEqual({ state: 'excluded' });
  });
  it('EV 0 with no cost: nothing recorded', () => {
    const d = deriveWorkOrderPerformance({ ...base, ev: '0.00', ac: '0.00' }, BANDS);
    expect(d.cpi).toEqual({ state: 'no-cost' });
  });
});

describe('AC-CSP-003 planned value edges', () => {
  it('PV 0 gives no SPI', () => {
    const d = deriveWorkOrderPerformance({ ...base, pv: '0.00', asOf: '2025-12-01' }, BANDS);
    expect(d.spi).toEqual({ state: 'no-plan-yet' });
  });
});

describe('AC-CSP-004 half-up integer rounding', () => {
  it('EV 1 cent over AC 3 cents is 0.33', () => {
    const d = deriveWorkOrderPerformance({ ...base, ev: '0.01', ac: '0.03' }, BANDS);
    expect(d.cpi).toMatchObject({ state: 'value', value: '0.33' });
  });
  it('rounds half up', () => {
    // 1/8 = 0.125 -> 0.13
    const d = deriveWorkOrderPerformance({ ...base, ev: '0.01', ac: '0.08' }, BANDS);
    expect(d.cpi).toMatchObject({ value: '0.13' });
  });
});

describe('AC-CSP-005 project is a ratio of sums', () => {
  it('is not the average of the indices', () => {
    const a: PerformanceRow = { ...base, workOrderId: 'a', ev: '200.00', ac: '100.00', pv: '100.00' };
    const b: PerformanceRow = { ...base, workOrderId: 'b', ev: '500.00', ac: '1000.00', pv: '1000.00' };
    const p = deriveProjectPerformance([a, b], BANDS);
    // sums: EV 700, AC 1100 -> 0.64 (average of 2.00 and 0.50 would be 1.25)
    expect(p.cpi).toMatchObject({ state: 'value', value: '0.64' });
    expect(p.spi).toMatchObject({ state: 'value', value: '0.64' });
    expect(p.includedCount).toBe(2);
  });
  it('excludes Draft, Cancelled and incomplete work orders and counts them', () => {
    const rows: PerformanceRow[] = [
      base,
      { ...base, workOrderId: 'd', status: 'Draft' },
      { ...base, workOrderId: 'u', unratedLines: 1 },
    ];
    const p = deriveProjectPerformance(rows, BANDS);
    expect(p.includedCount).toBe(1);
    expect(p.excludedCount).toBe(2);
    expect(p.cpi).toMatchObject({ value: '1.20' });
  });
  it('no included work orders gives no figures', () => {
    const p = deriveProjectPerformance([{ ...base, status: 'Draft' }], BANDS);
    expect(p.cpi).toEqual({ state: 'excluded' });
  });
});

describe('AC-CSP-020 readings use the organisation bands', () => {
  it('defaults 0.90 / 1.10', () => {
    expect(readIndex(85, BANDS)).toBe('below');
    expect(readIndex(90, BANDS)).toBe('within');
    expect(readIndex(110, BANDS)).toBe('within');
    expect(readIndex(111, BANDS)).toBe('above');
  });
  it('custom 0.80 / 1.25', () => {
    const b = { low: '0.80', high: '1.25' };
    expect(readIndex(85, b)).toBe('within');
    expect(readIndex(120, b)).toBe('within');
    expect(readIndex(126, b)).toBe('above');
    expect(readIndex(79, b)).toBe('below');
  });
  it('derive passes bands through', () => {
    const d = deriveWorkOrderPerformance({ ...base, ev: '85.00', ac: '100.00' }, { low: '0.80', high: '1.25' });
    expect(d.cpi).toMatchObject({ value: '0.85', reading: 'within' });
  });
});
