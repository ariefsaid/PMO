import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router';
import React from 'react';
import { ToastProvider } from '@/src/components/ui';
import { ImpersonationProvider } from '@/src/auth/impersonation';

/**
 * R2 (ux/1110): status/kind/category all live in the URL on the expenses list (status was
 * already URL-owned for the #1461 drill; kind and category join it), so a filtered view
 * survives opening a claim and pressing Back, or a refresh.
 */

const { claimsState, filtersSeen } = vi.hoisted(() => ({
  claimsState: {
    data: {
      rows: [] as Array<Record<string, unknown>>,
      truncated: false,
    },
    isPending: false,
    isError: false,
    refetch: vi.fn(),
  },
  filtersSeen: [] as unknown[],
}));

vi.mock('@/src/hooks/useExpenseClaims', () => ({
  useExpenseClaims: (filters?: unknown) => {
    filtersSeen.push(filters);
    return claimsState;
  },
  useExpenseClaimMutations: () => ({ create: { mutateAsync: vi.fn(), isPending: false } }),
}));
vi.mock('@/src/hooks/usePermission', () => ({
  usePermission: () => () => true,
}));
vi.mock('../expenses/useProjectChoices', () => ({
  useProjectChoices: () => ({ options: [] }),
}));
vi.mock('../expenses/useOwnAdvanceOptions', () => ({
  useOwnAdvanceOptions: () => ({ options: [] }),
}));
vi.mock('../expenses/AdvanceAgingCard', () => ({
  AdvanceAgingCard: () => null,
}));

import ExpenseClaims from '../ExpenseClaims';

const LocationProbe: React.FC = () => {
  const location = useLocation();
  return <div data-testid="location-probe" data-search={location.search} />;
};

const renderExpenses = (initialEntry = '/expenses') =>
  render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <ImpersonationProvider realRole="Engineer">
        <ToastProvider>
          <LocationProbe />
          <ExpenseClaims />
        </ToastProvider>
      </ImpersonationProvider>
    </MemoryRouter>,
  );

beforeEach(() => {
  filtersSeen.length = 0;
  claimsState.isPending = false;
  claimsState.isError = false;
});

describe('R2 — expense filters live in the URL', () => {
  it('a refresh of ?kind=advance reopens the advances-only view and asks the server for it', () => {
    renderExpenses('/expenses?kind=advance');
    expect(screen.getByRole('combobox', { name: 'Type' })).toHaveValue('advance');
    expect(filtersSeen.at(-1)).toMatchObject({ kind: 'advance' });
    expect(screen.getByTestId('location-probe')).toHaveAttribute('data-search', '?kind=advance');
  });

  it('choosing a budget category writes it into the URL and the server filters', async () => {
    const user = userEvent.setup();
    renderExpenses('/expenses');
    await user.selectOptions(screen.getByRole('combobox', { name: 'Budget category' }), 'Equipment');
    expect(screen.getByTestId('location-probe')).toHaveAttribute('data-search', '?category=Equipment');
    expect(filtersSeen.at(-1)).toMatchObject({ budgetCategory: 'Equipment' });
  });

  it('choosing a status writes it into the URL and the server filters', async () => {
    const user = userEvent.setup();
    renderExpenses('/expenses');
    await user.selectOptions(screen.getByRole('combobox', { name: 'Status' }), 'Submitted');
    expect(screen.getByTestId('location-probe')).toHaveAttribute('data-search', '?status=Submitted');
    expect(filtersSeen.at(-1)).toMatchObject({ status: 'Submitted' });
  });

  it('choosing a type writes it into the URL and the server filters', async () => {
    const user = userEvent.setup();
    renderExpenses('/expenses');
    await user.selectOptions(screen.getByRole('combobox', { name: 'Type' }), 'advance');
    expect(screen.getByTestId('location-probe')).toHaveAttribute('data-search', '?kind=advance');
    expect(filtersSeen.at(-1)).toMatchObject({ kind: 'advance' });
  });

  it('status and category restore together from a shared link', () => {
    renderExpenses('/expenses?status=Rejected&category=Labor');
    expect(screen.getByRole('combobox', { name: /status/i })).toHaveValue('Rejected');
    expect(screen.getByRole('combobox', { name: 'Budget category' })).toHaveValue('Labor');
    expect(filtersSeen.at(-1)).toMatchObject({ status: 'Rejected', budgetCategory: 'Labor' });
  });
});
