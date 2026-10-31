import { afterEach, describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { InvoicedTrendTile } from './InvoicedTrendTile';
import { selectInvoicedTrend } from '@/src/lib/dashboardTrend';
import { resetActiveLocale, setActiveLocale } from '@/src/lib/locale/activeLocale';

afterEach(() => resetActiveLocale());

const trendOf = (cents: number[], currency = 'IDR') => selectInvoicedTrend({
  totals: [{ currency, months: cents.map((invoiced, i) => ({ month: `2026-${String(i + 1).padStart(2, '0')}-01`, invoiced })) }],
} as never, currency)!;

describe('AC-DTR-001 InvoicedTrendTile', () => {
  it('labels the headline as the total over the window, with its tax basis, and draws a line across the months', () => {
    render(<InvoicedTrendTile trend={trendOf([100_000_000_00, 200_000_000_00, 450_000_000_00])} />);
    const tile = screen.getByRole('region', { name: 'Invoiced, last 12 completed months · excl. tax' });
    expect(tile.querySelector('svg polyline')).not.toBeNull();
  });

  it('shows the total with the currency symbol, like the sibling tiles', () => {
    const { rerender } = render(<InvoicedTrendTile trend={trendOf([100_000_000_00, 200_000_000_00, 450_000_000_00])} />);
    expect(screen.getByTestId('invoiced-trend')).toHaveTextContent('IDR 750M');
    rerender(<InvoicedTrendTile trend={trendOf([4_000_000_00, 3_000_000_00, 0], 'USD')} />);
    expect(screen.getByTestId('invoiced-trend')).toHaveTextContent('$7M');
  });

  it('the headline is the sum of every month shown, not the latest month', () => {
    render(<InvoicedTrendTile trend={trendOf([7_700_000_00, 0, 0, 0])} />);
    const tile = screen.getByTestId('invoiced-trend');
    expect(tile).toHaveTextContent('IDR 7.7M');
    expect(screen.getByTestId('invoiced-trend-summary')).toHaveTextContent(/Falling.*Latest month, Apr 2026: IDR 0/);
  });
});

describe('AC-DTR-002 less than three months', () => {
  it('shows the figure with no line and no empty chart', () => {
    const { container } = render(<InvoicedTrendTile trend={trendOf([0, 0, 300_000_000_00, 100_000_000_00])} />);
    expect(screen.getByRole('region', { name: /invoiced/i })).toHaveTextContent('IDR 400M');
    expect(container.querySelector('svg')).toBeNull();
  });
});

describe('AC-DTR-003 readable without sight or a pointer', () => {
  it('states first, last and direction as text; the drawing itself is hidden from assistive tech', () => {
    const { container } = render(<InvoicedTrendTile trend={trendOf([100_000_000_00, 200_000_000_00, 450_000_000_00])} />);
    const summary = screen.getByTestId('invoiced-trend-summary');
    expect(summary).toHaveTextContent('Latest month, Mar 2026: IDR 450M');
    expect(summary).toHaveTextContent('from Jan 2026: IDR 100M');
    expect(summary).toHaveTextContent(/rising/i);
    expect(container.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
  });

  it('labels the first and last points on the chart with month (4-digit year) and amount', () => {
    render(<InvoicedTrendTile trend={trendOf([100_000_000_00, 200_000_000_00, 450_000_000_00])} />);
    const tile = screen.getByTestId('invoiced-trend');
    expect(tile).toHaveTextContent('Jan 2026 · IDR 100M');
    expect(tile).toHaveTextContent('Mar 2026 · IDR 450M');
    expect(tile.textContent).not.toMatch(/\b[A-Z][a-z]{2} 26\b/);
  });

  it('writes the months in the active locale (id)', () => {
    setActiveLocale({ locale: 'id', numberLocale: 'id-ID', timezone: 'Asia/Jakarta' });
    const months = ['2026-08-01', '2026-09-01', '2026-10-01'].map((month, i) => ({ month, invoiced: (i + 1) * 100 }));
    const trend = selectInvoicedTrend({ totals: [{ currency: 'IDR', months }] } as never, 'IDR')!;
    render(<InvoicedTrendTile trend={trend} />);
    expect(screen.getByTestId('invoiced-trend')).toHaveTextContent(/Agu 2026/);
  });

  it('says falling and steady in words', () => {
    const { rerender } = render(<InvoicedTrendTile trend={trendOf([900_00, 500_00, 100_00])} />);
    expect(screen.getByTestId('invoiced-trend-summary')).toHaveTextContent(/falling/i);
    rerender(<InvoicedTrendTile trend={trendOf([300_00, 900_00, 300_00])} />);
    expect(screen.getByTestId('invoiced-trend-summary')).toHaveTextContent(/steady/i);
  });
});
