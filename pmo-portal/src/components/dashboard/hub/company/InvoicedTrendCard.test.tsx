import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { InvoicedTrendCard } from './InvoicedTrendCard';
import { selectInvoicedTrend } from '@/src/lib/dashboardTrend';

const trend = selectInvoicedTrend({
  totals: [{ currency: 'IDR', months: [100_00, 200_00, 400_00].map((invoiced, i) => ({ month: `2026-0${i + 1}-01`, invoiced })) }],
} as never, 'IDR');

describe('AC-DTR-001 InvoicedTrendCard states', () => {
  it('draws the tile from the figures hook trend', () => {
    render(<InvoicedTrendCard trend={trend} />);
    expect(screen.getByTestId('invoiced-trend')).toHaveTextContent('700');
  });

  it('renders nothing when nothing has been invoiced', () => {
    const { container } = render(<InvoicedTrendCard trend={null} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('shows a retry, not a blank, when the pack fails', () => {
    const onRetry = vi.fn();
    render(<InvoicedTrendCard trend={null} error onRetry={onRetry} />);
    screen.getByRole('button', { name: /retry/i }).click();
    expect(onRetry).toHaveBeenCalled();
  });

  it('shows a loading state while the history loads', () => {
    const { container } = render(<InvoicedTrendCard trend={null} pending />);
    expect(container.querySelector('[aria-busy="true"]')).not.toBeNull();
    expect(screen.queryByTestId('invoiced-trend')).toBeNull();
  });
});
