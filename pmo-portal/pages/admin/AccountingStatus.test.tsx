import React from 'react';
import { beforeEach, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
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
