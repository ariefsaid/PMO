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
});
