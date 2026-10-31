import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { InvoicedTrendTile } from './InvoicedTrendTile';
import { selectInvoicedTrend } from '@/src/lib/dashboardTrend';

const trendOf = (cents: number[], currency = 'IDR') => selectInvoicedTrend({
  totals: [{ currency, months: cents.map((invoiced, i) => ({ month: `2026-${String(i + 1).padStart(2, '0')}-01`, invoiced })) }],
} as never, currency)!;

describe('AC-DTR-001 InvoicedTrendTile', () => {
  it('shows the figure, its currency and tax basis, and a line across the months', () => {
    render(<InvoicedTrendTile trend={trendOf([100_000_000_00, 200_000_000_00, 450_000_000_00])} />);
    const tile = screen.getByRole('region', { name: /invoiced.*IDR.*excl\. tax/i });
    expect(tile).toHaveTextContent('750M');
    expect(tile.querySelector('svg polyline')).not.toBeNull();
  });
});

describe('AC-DTR-002 less than three months', () => {
  it('shows the figure with no line and no empty chart', () => {
    const { container } = render(<InvoicedTrendTile trend={trendOf([0, 0, 300_000_000_00, 100_000_000_00])} />);
    expect(screen.getByRole('region', { name: /invoiced/i })).toHaveTextContent('400M');
    expect(container.querySelector('svg')).toBeNull();
  });
});

describe('AC-DTR-003 readable without sight or a pointer', () => {
  it('states first, last and direction as text; the drawing itself is hidden from assistive tech', () => {
    const { container } = render(<InvoicedTrendTile trend={trendOf([100_000_000_00, 200_000_000_00, 450_000_000_00])} />);
    const summary = screen.getByTestId('invoiced-trend-summary');
    expect(summary).toHaveTextContent(/Jan 26/);
    expect(summary).toHaveTextContent(/100M/);
    expect(summary).toHaveTextContent(/Mar 26/);
    expect(summary).toHaveTextContent(/450M/);
    expect(summary).toHaveTextContent(/rising/i);
    expect(container.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
  });

  it('says falling and steady in words', () => {
    const { rerender } = render(<InvoicedTrendTile trend={trendOf([900_00, 500_00, 100_00])} />);
    expect(screen.getByTestId('invoiced-trend-summary')).toHaveTextContent(/falling/i);
    rerender(<InvoicedTrendTile trend={trendOf([300_00, 900_00, 300_00])} />);
    expect(screen.getByTestId('invoiced-trend-summary')).toHaveTextContent(/steady/i);
  });
});
