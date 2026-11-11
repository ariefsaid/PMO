import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import React from 'react';
import { ToastProvider } from '@/src/components/ui';
import { ImpersonationProvider } from '@/src/auth/impersonation';

/**
 * #1461 — the dashboard "Expense claims returned" figure counts the viewer's Rejected claims;
 * its drill carries `?status=Rejected`, and the list must open exactly that set (server-side
 * filter, shareable URL).
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

const renderExpenses = (initialEntry = '/expenses') =>
  render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <ImpersonationProvider realRole="Engineer">
        <ToastProvider>
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

describe('#1461 — Expense claims ?status= drill', () => {
  it('passes the URL status to the server-side filters so the drill lands on exactly that set', () => {
    renderExpenses('/expenses?status=Rejected');
    expect(filtersSeen.at(-1)).toMatchObject({ status: 'Rejected' });
    expect(screen.getByRole('combobox', { name: /status/i })).toHaveValue('Rejected');
  });

  it('without a status param the list stays unfiltered', () => {
    renderExpenses('/expenses');
    expect(filtersSeen.at(-1)).toEqual({});
    expect(screen.getByRole('combobox', { name: /status/i })).toHaveValue('');
  });

  it('names a rejected expense as Returned in the shared status filter', () => {
    renderExpenses('/expenses');
    expect(screen.getByRole('option', { name: 'Returned' })).toHaveValue('Rejected');
  });
});
