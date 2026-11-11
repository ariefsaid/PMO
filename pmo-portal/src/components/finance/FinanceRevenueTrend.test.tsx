import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { FigureHiddenLine, FigureScope } from '@/src/components/ui/FigureScope';
import { selectCollectedByMonth, selectInvoicedByMonth } from '@/src/components/dashboard/restructure/useCompanyFigures';
import FinanceRevenueTrend from './FinanceRevenueTrend';

const state = vi.hoisted(() => ({
  pack: { data: undefined as unknown, isPending: false, isError: false, refetch: vi.fn() },
  payments: { data: undefined as unknown, isPending: false, isError: false, refetch: vi.fn() },
  range: undefined as unknown,
}));

vi.mock('@/src/hooks/useManagementPack', () => ({
  useManagementPack: (range: unknown) => { state.range = range; return state.pack; },
}));
vi.mock('@/src/hooks/useRevenue', () => ({ usePaidPaymentFacts: () => state.payments }));
vi.mock('@/src/hooks/useOrgCurrency', () => ({ useOrgCurrencyState: () => ({ currency: 'USD', isResolved: true, isError: false }) }));

const renderTrend = (enabled = true) => render(
  <MemoryRouter><FigureScope><FigureHiddenLine /><FinanceRevenueTrend today="2026-11-11" enabled={enabled} /></FigureScope></MemoryRouter>,
);

const months = ['2026-05-01', '2026-06-01', '2026-07-01', '2026-08-01', '2026-09-01', '2026-10-01'];
const invoices = { totals: [{ currency: 'USD', months: months.map((month, index) => ({ month, invoiced: (index + 1) * 10_000 })) }] };

describe('FinanceRevenueTrend', () => {
  beforeEach(() => {
    state.pack = { data: invoices, isPending: false, isError: false, refetch: vi.fn() };
    state.payments = { data: months.map((date, index) => ({ date: `${date.slice(0, 7)}-15`, status: 'Paid', currency: 'USD', amount: (index + 1) * 100 })), isPending: false, isError: false, refetch: vi.fn() };
    state.range = undefined;
  });

  it('shows six completed months of invoiced and collected amounts in one chart', () => {
    expect(selectInvoicedByMonth(invoices as never, '2026-05-01', '2026-10-01', 'USD')).toHaveLength(6);
    expect(selectCollectedByMonth(state.payments.data as never, 'USD')?.size).toBe(6);
    renderTrend();
    expect(state.range).toEqual({ from: '2026-05-01', to: '2026-10-01' });
    expect(screen.getByRole('heading', { name: 'Invoiced and collected · 6 months' })).toBeInTheDocument();
    const chart = screen.getByRole('img', { name: /invoiced and collected/i });
    expect(chart.getAttribute('aria-label')).toContain('May');
    expect(chart.getAttribute('aria-label')).toContain('Invoiced, excl. tax');
    expect(chart.getAttribute('aria-label')).toContain('Collected');
    expect(chart.getAttribute('aria-label')).toContain('Collected $600');
    expect(screen.queryByTestId('finance-revenue-trend-gap')).not.toBeInTheDocument();
  });

  it('keeps the invoiced series and states the missing collections when that series is unknown', () => {
    state.payments.data = undefined;
    renderTrend();
    expect(screen.getByRole('img', { name: /invoiced and collected/i })).toBeInTheDocument();
    expect(screen.getByTestId('finance-revenue-trend-gap')).toHaveTextContent('Collected is incomplete');
  });

  it('does not draw the chart when both monthly series are fully unknown', () => {
    state.pack.data = { totals: [] };
    state.payments.data = undefined;
    const { container } = renderTrend();
    expect(container.querySelector('[data-testid="finance-revenue-trend"]')).toBeNull();
    expect(screen.getByText(/no invoice or collection amounts are recorded/i)).toBeInTheDocument();
  });

  it('keeps the six-month chart even when only one month has invoiced activity', () => {
    state.pack = { data: { totals: [{ currency: 'USD', months: months.map((month, index) => ({ month, invoiced: index === 0 ? 10_000 : 0 })) }] }, isPending: false, isError: false, refetch: vi.fn() };
    state.payments = { data: [], isPending: false, isError: false, refetch: vi.fn() };
    renderTrend();
    expect(screen.getByTestId('finance-revenue-trend')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: /invoiced and collected/i })).toHaveAccessibleName(/Oct/);
  });
});
