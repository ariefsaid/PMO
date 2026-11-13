import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { FigureHiddenLine, FigureScope } from '@/src/components/ui/FigureScope';
import FinanceRevenueTrend from './FinanceRevenueTrend';

const repo = vi.hoisted(() => ({ invoices: vi.fn(), payments: vi.fn() }));
vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: { org_id: 'test' } }) }));
vi.mock('@/src/lib/repositories', () => ({ repositories: { revenue: { listMonthlyInvoiceFacts: repo.invoices, listPaidPaymentFacts: repo.payments } } }));

vi.mock('@/src/hooks/useOrgCurrency', () => ({ useOrgCurrencyState: () => ({ currency: 'USD', isResolved: true, isError: false }) }));
vi.mock('@/src/components/dashboard/charts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/src/components/dashboard/charts')>();
  return {
    ...actual,
    MonthColumns: (props: {
      points: Array<{ tick: string; labelA?: string; labelB?: string }>;
      ariaLabel: string;
      seriesNames?: [string, string?];
      labelAll?: boolean;
      pairedLabelsOnBars?: boolean;
      showValueLabels?: boolean;
      minWidth?: number;
      plotRightMargin?: number;
    }) => {
      const points = props.points.map((point) => {
        const values = [
          point.labelA && `${props.seriesNames?.[0] ?? ''} ${point.labelA}`.trim(),
          point.labelB && `${props.seriesNames?.[1] ?? ''} ${point.labelB}`.trim(),
        ].filter(Boolean);
        return `${point.tick}: ${values.join(', ')}`;
      });
      return React.createElement('div', {
        role: 'img',
        'aria-label': `${props.ariaLabel}. ${points.join('; ')}`,
        'data-testid': 'finance-revenue-trend-labels',
        'data-label-all': String(props.labelAll ?? false),
        'data-paired-labels-on-bars': String(props.pairedLabelsOnBars ?? false),
        'data-show-value-labels': String(props.showValueLabels ?? true),
        'data-min-width': props.minWidth == null ? '' : String(props.minWidth),
        'data-plot-right-margin': String(props.plotRightMargin ?? ''),
      });
    },
  };
});

const renderTrend = (enabled = true) => render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><MemoryRouter><FigureScope><FigureHiddenLine /><FinanceRevenueTrend today="2026-11-11" enabled={enabled} /></FigureScope></MemoryRouter></QueryClientProvider>,
);

const months = ['2026-05-01', '2026-06-01', '2026-07-01', '2026-08-01', '2026-09-01', '2026-10-01'];

describe('FinanceRevenueTrend', () => {
  beforeEach(() => {
    repo.invoices.mockReset().mockResolvedValue(months.map((date, i) => ({ invoice_date: date, currency: 'USD', net: (i + 1) * 100, recovery: 0 })));
    repo.payments.mockReset().mockResolvedValue(months.map((date, i) => ({ date, status: 'Paid', currency: 'USD', amount: (i + 1) * 100 })));
  });

  it('renders invoiced and collected series on a cold mount', async () => {
    renderTrend();
    const chart = await screen.findByRole('img', { name: /invoiced and collected/i });
    expect(chart).toHaveAccessibleName(/Invoiced, excl. tax/);
    expect(chart).toHaveAccessibleName(/Collected \$600/);
    expect(repo.invoices).toHaveBeenCalledWith('2026-05-01', '2026-11-01');
  });

  it('shows invoiced and explains an unavailable collections series', async () => {
    repo.payments.mockRejectedValue(new Error('unavailable'));
    renderTrend();
    expect(await screen.findByTestId('finance-revenue-trend-gap')).toHaveTextContent('Collected is incomplete');
    expect(screen.getByRole('img', { name: /invoiced and collected/i })).toBeInTheDocument();
  });

  it('explains when both series are unavailable', async () => {
    repo.invoices.mockRejectedValue(new Error('unavailable'));
    repo.payments.mockRejectedValue(new Error('unavailable'));
    renderTrend();
    expect(await screen.findByText(/monthly series aren't available yet/i)).toBeInTheDocument();
  });

  it('draws all six months with activity in one month', async () => {
    repo.invoices.mockResolvedValue([{ invoice_date: months[0], currency: 'USD', net: 100, recovery: 0 }]);
    repo.payments.mockResolvedValue([]);
    renderTrend();
    expect(await screen.findByRole('img', { name: /invoiced and collected/i })).toHaveAccessibleName(/Oct/);
  });

  it('labels only the latest non-zero pair while keeping every month in the accessible chart name', async () => {
    renderTrend();
    const chart = await screen.findByRole('img', { name: /invoiced and collected/i });
    const directLabels = screen.getByTestId('finance-revenue-trend-labels');

    expect(directLabels).toHaveAttribute('data-label-all', 'false');
    expect(directLabels).toHaveAttribute('data-paired-labels-on-bars', 'false');
    expect(chart).toHaveAccessibleName(/May:.*\$100.*Collected \$100/);
    expect(chart).toHaveAccessibleName(/Oct:.*\$600.*Collected \$600/);
  });

  it('shows each non-zero month value in visible text without chart-top labels or a fixed-width scroller', async () => {
    renderTrend();

    const values = await screen.findByTestId('finance-revenue-trend-visible-values');
    expect(values.querySelectorAll('[data-series-value]')).toHaveLength(12);

    months.forEach((_, index) => {
      const tick = ['May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct'][index];
      const month = screen.getByTestId(`finance-revenue-trend-values-${tick?.toLowerCase()}`);
      const monthValues = month.querySelectorAll('[data-series-value]');
      expect(monthValues).toHaveLength(2);
      expect(monthValues[0]).toHaveTextContent(`$${(index + 1) * 100}`);
      expect(monthValues[1]).toHaveTextContent(`$${(index + 1) * 100}`);
    });

    const chart = screen.getByTestId('finance-revenue-trend-labels');
    expect(chart).toHaveAttribute('data-show-value-labels', 'false');
    expect(chart).toHaveAttribute('data-min-width', '');
    expect(chart).toHaveAttribute('data-plot-right-margin', '16');
  });
});
