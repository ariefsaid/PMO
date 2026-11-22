import { describe, expect, it } from 'vitest';
import { parseProjectPerformance } from './workOrderPerformance';

const rowJson = {
  work_order_id: 'w1', wo_number: 'WO-1', title: 'One', status: 'Issued', currency: 'IDR', as_of: '2026-01-04',
  start_date: '2026-01-01', end_date: '2026-01-10', bac: '1000000.00', ev: '300000.00', unrated_lines: 0, pv: '400000.00',
  ac: '250000.00', ac_status: 'complete', undated_cost_lines: 0,
};
const ok = { enabled: true, as_of: '2026-01-04', bands: { low: '0.90', high: '1.10' }, truncated: false, omitted: 0, rows: [rowJson] };

describe('parseProjectPerformance', () => {
  it('parses the read into exact strings', () => {
    const r = parseProjectPerformance(ok);
    expect(r.rows[0]).toMatchObject({ workOrderId: 'w1', ev: '300000.00', pv: '400000.00', acStatus: 'complete', unratedLines: 0 });
    expect(r.bands).toEqual({ low: '0.90', high: '1.10' });
  });
  it('AC-CSP-018 the off response carries no rows', () => {
    expect(parseProjectPerformance({ enabled: false })).toMatchObject({ enabled: false, rows: [] });
  });
  it('a missing or malformed figure is an error, never 0', () => {
    expect(() => parseProjectPerformance({ ...ok, rows: [{ ...rowJson, ev: 300000 }] })).toThrow(/malformed/);
    expect(() => parseProjectPerformance({ ...ok, rows: [{ ...rowJson, ac_status: 'weird' }] })).toThrow(/malformed/);
    expect(() => parseProjectPerformance({ ...ok, rows: [{ ...rowJson, unrated_lines: null }] })).toThrow(/malformed/);
    expect(() => parseProjectPerformance({ ...ok, bands: undefined })).toThrow(/malformed/);
    expect(() => parseProjectPerformance(null)).toThrow(/malformed/);
    expect(() => parseProjectPerformance({ ...ok, enabled: 'yes' })).toThrow(/malformed/);
  });
  it('keeps null figures null (no dates, no cost)', () => {
    const r = parseProjectPerformance({ ...ok, rows: [{ ...rowJson, pv: null, ac: null, start_date: null }] });
    expect(r.rows[0]).toMatchObject({ pv: null, ac: null, startDate: null });
  });
});
