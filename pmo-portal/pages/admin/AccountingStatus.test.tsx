import React from 'react';
import { beforeEach, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import userEvent from '@testing-library/user-event';
import { Constants } from '@/src/lib/supabase/database.types';
import { externalDomainOwnershipKey } from '@/src/hooks/approvalsQueryKeys';
import { FinanceI18nTestProvider } from '@/test/financeI18nTestProvider';
import { financeTestI18n, financeTestI18nReady } from '@/test/financeI18nTestInstance';

const h = vi.hoisted(() => ({
  binding: vi.fn(),
  ownership: vi.fn(),
  budgetMap: vi.fn(),
  expenseMap: vi.fn(),
  chart: vi.fn(),
}));

vi.mock('@/src/lib/repositories', () => ({
  repositories: {
    integrations: { getBinding: h.binding },
    externalDomainOwnership: { listOwn: h.ownership },
    expensePostings: { listAccountMap: h.expenseMap },
  },
}));
vi.mock('@/src/lib/repositories/budgetProjection', () => ({
  listBudgetCategoryAccountMap: h.budgetMap,
  listBudgetPostingAccountCatalogue: h.chart,
}));
vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: { org_id: 'fixture-org' } }) }));

import AccountingStatus from './AccountingStatus';

function ExistingChartReads() {
  useQuery({ queryKey: ['budget-posting-account-catalogue'], queryFn: h.chart });
  useQuery({ queryKey: ['uxs11', 'account-catalogue', 'fixture-org'], queryFn: h.chart });
  return null;
}

function renderStatus(queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })) {
  return {
    queryClient,
    ...render(
      <FinanceI18nTestProvider>
        <QueryClientProvider client={queryClient}>
          <AccountingStatus />
        </QueryClientProvider>
      </FinanceI18nTestProvider>,
    ),
  };
}

beforeEach(async () => {
  await financeTestI18nReady;
  await financeTestI18n.changeLanguage('en');
  vi.clearAllMocks();
  h.binding.mockResolvedValue({ status: 'active' });
  h.ownership.mockResolvedValue([]);
  h.budgetMap.mockResolvedValue([]);
  h.expenseMap.mockResolvedValue([]);
  h.chart.mockResolvedValue({ accounts: [], source: 'mirror' });
});

it('AC-ADMIA-011 links the live accounting findings to their sections', async () => {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const mapped = Constants.public.Enums.budget_category.slice(4).map((category, index) => ({
    id: `mapped-${index}`,
    category,
    erpAccount: `Account ${index}`,
    isPushTarget: true,
  }));
  queryClient.setQueryData(['budget-category-account-map'], mapped);
  queryClient.setQueryData(['expense-account-map'], []);
  queryClient.setQueryData(['integrations', 'binding', 'fixture-org', 'erpnext'], { status: 'active' });
  queryClient.setQueryData(externalDomainOwnershipKey('fixture-org'), []);

  renderStatus(queryClient);

  expect(await screen.findByRole('link', { name: '4 categories not mapped' })).toHaveAttribute('href', '#budget-account-map');
  expect(screen.getByRole('link', { name: 'Expense posting off' })).toHaveAttribute('href', '#expense-account-map');
});

it('AC-ADMIA-012 leaves existing chart reads alone on a normal load', async () => {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

  render(
    <FinanceI18nTestProvider>
      <QueryClientProvider client={queryClient}>
        <ExistingChartReads />
        <AccountingStatus />
      </QueryClientProvider>
    </FinanceI18nTestProvider>,
  );

  await waitFor(() => expect(h.chart).toHaveBeenCalledTimes(2));
  expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument();
});

it('AC-ADMIA-012 shows one chart failure and retries each failed existing read once', async () => {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  h.chart
    .mockRejectedValueOnce(new Error('Temporary chart read failure'))
    .mockRejectedValueOnce(new Error('Temporary chart read failure'))
    .mockResolvedValue({ accounts: [], source: 'mirror' });

  render(
    <FinanceI18nTestProvider>
      <QueryClientProvider client={queryClient}>
        <ExistingChartReads />
        <AccountingStatus />
      </QueryClientProvider>
    </FinanceI18nTestProvider>,
  );

  expect(await screen.findByText('The account chart is unavailable.')).toBeInTheDocument();
  expect(screen.getAllByText('The account chart is unavailable.')).toHaveLength(1);
  expect(screen.getAllByRole('button', { name: 'Retry' })).toHaveLength(1);

  await userEvent.setup().click(screen.getByRole('button', { name: 'Retry' }));
  await waitFor(() => expect(h.chart).toHaveBeenCalledTimes(4));
});
