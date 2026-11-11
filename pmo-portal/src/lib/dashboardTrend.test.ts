import { describe, expect, it } from 'vitest';
import { selectInvoicedTrend, trendWindow } from './dashboardTrend';

const month = (n: number) => `2026-${String(n).padStart(2, '0')}-01`;
const pack = (series: Record<string, number[]>) => ({
  totals: Object.entries(series).map(([currency, cents]) => ({
    currency,
    months: cents.map((invoiced, i) => ({ month: month(i + 1), invoiced })),
  })),
});

describe('AC-DTR-001 selectInvoicedTrend', () => {
  it('turns the ledger months into points, a total and a direction', () => {
    const trend = selectInvoicedTrend(pack({ IDR: [100_00, 200_00, 300_00, 450_00] }), 'IDR');
    expect(trend).toMatchObject({ currency: 'IDR', total: 1050, first: 100, last: 450, direction: 'up', hasLine: true });
    expect(trend?.points.map((p) => p.amount)).toEqual([100, 200, 300, 450]);
  });

  it('the total is the sum of the plotted points, exactly (integer cents)', () => {
    const trend = selectInvoicedTrend(pack({ IDR: [10, 20, 30] }), 'IDR');
    expect(trend?.total).toBe(0.6);
    expect(trend?.total).toBe(trend!.points.reduce((s, p) => s + p.amount * 100, 0) / 100);
  });

  it('history starts at the first invoiced month; leading empty months are not history', () => {
    const trend = selectInvoicedTrend(pack({ IDR: [0, 0, 0, 500_00, 0, 700_00] }), 'IDR');
    expect(trend?.points.map((p) => p.month)).toEqual([month(4), month(5), month(6)]);
    expect(trend?.points.map((p) => p.amount)).toEqual([500, 0, 700]);
    expect(trend?.hasLine).toBe(true);
  });

  it('reports falling and flat', () => {
    expect(selectInvoicedTrend(pack({ IDR: [900, 500, 100] }), 'IDR')?.direction).toBe('down');
    expect(selectInvoicedTrend(pack({ IDR: [300, 900, 300] }), 'IDR')?.direction).toBe('flat');
  });
});

describe('AC-DTR-002 less than three months', () => {
  it('keeps the figure but draws no line', () => {
    const trend = selectInvoicedTrend(pack({ IDR: [0, 0, 0, 0, 800_00, 200_00] }), 'IDR');
    expect(trend).toMatchObject({ total: 1000, hasLine: false });
    expect(trend?.points).toHaveLength(2);
  });

  it('is null when nothing was ever invoiced', () => {
    expect(selectInvoicedTrend(pack({ IDR: [0, 0, 0, 0] }), 'IDR')).toBeNull();
    expect(selectInvoicedTrend(pack({}), 'IDR')).toBeNull();
    expect(selectInvoicedTrend(undefined, 'IDR')).toBeNull();
  });
});

describe('currencies are never summed', () => {
  it('uses the preferred currency, else the first one', () => {
    const p = pack({ IDR: [100_00, 100_00, 100_00], USD: [5_00, 6_00, 7_00] });
    expect(selectInvoicedTrend(p, 'USD')).toMatchObject({ currency: 'USD', total: 18 });
    expect(selectInvoicedTrend(p, 'EUR')).toMatchObject({ currency: 'IDR', total: 300 });
  });
});

describe('trendWindow', () => {
  it('is the twelve completed months before the org month', () => {
    expect(trendWindow('2026-10-27')).toEqual({ from: '2025-10-01', to: '2026-09-01' });
    expect(trendWindow('2026-01-01')).toEqual({ from: '2025-01-01', to: '2025-12-01' });
  });

  it('waits for the org day', () => {
    expect(trendWindow(null)).toEqual({});
  });
});
