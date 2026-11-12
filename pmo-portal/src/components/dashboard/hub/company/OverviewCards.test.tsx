import React from 'react';
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { FigureHiddenLine, FigureScope } from '@/src/components/ui/FigureScope';
import { InvoicedCollectedCard } from './OverviewCards';

const renderCard = (months: Array<{ month: string; amount: number }> | undefined, collectedByMonth: Map<string, number> | undefined, periodMonths?: string[]) => render(
  <MemoryRouter>
    <FigureScope>
      <FigureHiddenLine />
      <InvoicedCollectedCard
        months={months} collectedByMonth={collectedByMonth} collectedUnsynced={false}
        periodMonths={periodMonths}
        pending={false} error={false} retry={() => {}} currency="USD"
      />
    </FigureScope>
  </MemoryRouter>,
);

describe('InvoicedCollectedCard', () => {
  it('keeps billed-work and collected month series in one chart when three months have activity', () => {
    renderCard([
      { month: '2026-01-01', amount: 100 },
      { month: '2026-02-01', amount: 0 },
      { month: '2026-03-01', amount: 300 },
      { month: '2026-04-01', amount: 400 },
    ], new Map([['2026-01', 50], ['2026-02', 0], ['2026-03', 250], ['2026-04', 0]]));

    expect(screen.getByTestId('chart-invoiced-collected')).toBeInTheDocument();
    const chart = screen.getByRole('img', { name: /billed work and collected/i });
    expect(chart.getAttribute('aria-label')).toContain('Billed work, excl. tax');
    expect(chart.getAttribute('aria-label')).toContain('Collected');
    expect(chart.getAttribute('aria-label')).toContain('Collected $0');
  });

  it('uses figures and the hidden line instead of a chart with fewer than three active months', () => {
    renderCard([
      { month: '2026-01-01', amount: 100 },
      { month: '2026-02-01', amount: 0 },
      { month: '2026-03-01', amount: 0 },
    ], new Map([['2026-01', 0], ['2026-02', 0], ['2026-03', 0]]));

    expect(screen.queryByTestId('chart-invoiced-collected')).not.toBeInTheDocument();
    expect(screen.getByTestId('figures-hidden')).toHaveTextContent('fewer than three months have invoiced or collected amounts');
  });

  it('shows the known collected series with a one-line note when monthly invoicing is unknown', () => {
    renderCard(undefined, new Map([['2025-10', 100], ['2025-11', 200], ['2025-12', 300]]), [
      '2025-10', '2025-11', '2025-12', '2026-01', '2026-02', '2026-03',
      '2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09',
    ]);

    expect(screen.getByTestId('chart-invoiced-collected')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: /collected/i })).toBeInTheDocument();
    expect(screen.getByTestId('invoiced-collected-gap')).toHaveTextContent('Billed work is incomplete; collected amounts are shown.');
  });
});
