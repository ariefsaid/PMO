import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FinanceI18nTestProvider } from '@/test/financeI18nTestProvider';
import BudgetHeaderAction from './BudgetHeaderAction';

const state = vi.hoisted(() => ({ canWrite: true, versions: [] as { status: string }[] | undefined }));
vi.mock('@/src/auth/usePermission', () => ({ usePermission: () => () => state.canWrite }));
vi.mock('@/src/hooks/useBudget', () => ({ useBudgetVersions: () => ({ data: state.versions }) }));

const Search = () => <output data-testid="search">{useLocation().search}</output>;
const renderAction = () => render(
  <FinanceI18nTestProvider>
    <MemoryRouter initialEntries={['/projects/p-1/budget']}>
      <BudgetHeaderAction projectId="p-1" />
      <Search />
    </MemoryRouter>
  </FinanceI18nTestProvider>,
);

describe('BudgetHeaderAction (#design-1115: the Budget tab main action)', () => {
  beforeEach(() => { state.canWrite = true; state.versions = []; });

  it('offers Update budget when an approved budget has no draft, and asks the tab for the step', async () => {
    state.versions = [{ status: 'Active' }];
    renderAction();
    await userEvent.click(screen.getByRole('button', { name: 'Update budget' }));
    expect(screen.getByTestId('search')).toHaveTextContent('budgetAction=next');
  });

  it('offers Create budget when the project has no budget', () => {
    renderAction();
    expect(screen.getByRole('button', { name: 'Create budget' })).toBeInTheDocument();
  });

  it('offers nothing while a draft is open, or to a role that cannot edit budgets', () => {
    state.versions = [{ status: 'Active' }, { status: 'Draft' }];
    const { unmount } = renderAction();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    unmount();
    state.versions = [{ status: 'Active' }];
    state.canWrite = false;
    renderAction();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});
