/**
 * AC-BUD-050/051/053 — pages/BudgetProjection.tsx: PMO's forward view surface (FR-BUD-151/152/123).
 * Mirrors the "react-query + the repository seam directly" mocking idiom (AdminUsers.test.tsx §S6):
 * `@/src/lib/repositories/budgetProjection` is mocked; usePermission reads the real JWT role via the
 * mocked `useEffectiveRole`.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import type { Role } from '@/src/auth/AuthContext';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ToastProvider } from '@/src/components/ui';

const { fetchMock, upsertEtcMock } = vi.hoisted(() => ({
  fetchMock: vi.fn(),
  upsertEtcMock: vi.fn(),
}));

vi.mock('@/src/lib/repositories/budgetProjection', () => ({
  fetchBudgetProjection: fetchMock,
  upsertBudgetProjectionEtc: upsertEtcMock,
}));

let realRole: Role = 'Finance';
vi.mock('@/src/auth/impersonation', () => ({
  useEffectiveRole: () => ({ realRole, effectiveRole: realRole }),
}));

import BudgetProjection from './BudgetProjection';

const CURRENT_YEAR = String(new Date().getFullYear());

const ROW = {
  category: 'Labor' as const,
  pmoBudgetAmount: 100000,
  actualsToDate: 40000,
  pmoEtc: 35000,
  projectedFinalCost: 75000,
  projectedVariance: 25000,
  projectedUtilization: 0.75,
  pushState: null,
  pushError: null,
};

const renderPage = (role: Role = 'Finance') => {
  realRole = role;
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <ToastProvider>
        <BudgetProjection projectId="proj-1" />
      </ToastProvider>
    </QueryClientProvider>,
  );
};

beforeEach(() => {
  fetchMock.mockReset();
  upsertEtcMock.mockReset();
  fetchMock.mockResolvedValue([ROW]);
  upsertEtcMock.mockResolvedValue(undefined);
  realRole = 'Finance';
});

describe('BudgetProjection — the forward view (AC-BUD-050/051)', () => {
  it('renders the category row: PMO budget, ERP actuals, PMO ETC, projected final, variance, utilization', async () => {
    renderPage();
    expect(await screen.findByText('Labor')).toBeInTheDocument();
    expect(screen.getByText('$100,000')).toBeInTheDocument(); // pmoBudgetAmount
    expect(screen.getByText('$40,000')).toBeInTheDocument(); // actualsToDate
    expect(screen.getByText('$75,000')).toBeInTheDocument(); // projectedFinalCost
    expect(screen.getByText('$25,000')).toBeInTheDocument(); // projectedVariance
    expect(screen.getByText('75%')).toBeInTheDocument(); // projectedUtilization
  });

  it('fetches with the current-year fiscal year by default', async () => {
    renderPage();
    await screen.findByText('Labor');
    expect(fetchMock).toHaveBeenCalledWith('proj-1', CURRENT_YEAR);
  });

  it('a null pmoBudgetAmount / utilization renders as an em-dash, never 0 or blank', async () => {
    fetchMock.mockResolvedValue([{ ...ROW, pmoBudgetAmount: null, projectedUtilization: null }]);
    renderPage();
    await screen.findByText('Labor');
    expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(2);
  });

  it('shows a loading state while fetching', () => {
    fetchMock.mockReturnValue(new Promise(() => {}));
    renderPage();
    expect(screen.getByTestId('budget-projection-loading')).toBeInTheDocument();
  });

  it('shows an error state with retry on a failed fetch', async () => {
    fetchMock.mockRejectedValue(new Error('boom'));
    renderPage();
    expect(await screen.findByText(/couldn.t load/i)).toBeInTheDocument();
  });

  it('shows an empty state when there is no budget, no actuals, and no ETC yet', async () => {
    fetchMock.mockResolvedValue([]);
    renderPage();
    expect(await screen.findByText(/no projection data yet/i)).toBeInTheDocument();
  });
});

describe('BudgetProjection — the push-state banner (FR-BUD-123)', () => {
  it('states the operational consequence in plain words when the push is failed/held', async () => {
    fetchMock.mockResolvedValue([
      { ...ROW, pushState: 'held', pushError: 'budget categories have no ERP account mapping: Contingency' },
    ]);
    renderPage();
    expect(await screen.findByText(/still enforcing the previous budget/i)).toBeInTheDocument();
    expect(screen.getByText(/Contingency/)).toBeInTheDocument();
  });

  it('renders no banner when the push is healthy (pushed or no push at all)', async () => {
    fetchMock.mockResolvedValue([{ ...ROW, pushState: 'pushed', pushError: null }]);
    renderPage();
    await screen.findByText('Labor');
    expect(screen.queryByText(/still enforcing the previous budget/i)).not.toBeInTheDocument();
  });
});

describe('BudgetProjection — ETC is editable only under OD-BUDGET-3 (ADR-0016 UX gate)', () => {
  it('Finance (OD-BUDGET-3) can edit the ETC for a category', async () => {
    const user = userEvent.setup();
    renderPage('Finance');
    await user.click(await screen.findByRole('button', { name: /edit.*labor.*etc/i }));
    const field = screen.getByLabelText(/estimate to complete/i);
    await user.clear(field);
    await user.type(field, '40000');
    await user.click(screen.getByRole('button', { name: /save/i }));
    await waitFor(() => expect(upsertEtcMock).toHaveBeenCalledWith('proj-1', CURRENT_YEAR, 'Labor', 40000));
  });

  it('an Engineer (not OD-BUDGET-3) sees the ETC read-only — no edit affordance', async () => {
    renderPage('Engineer');
    await screen.findByText('Labor');
    expect(screen.queryByRole('button', { name: /edit.*labor.*etc/i })).not.toBeInTheDocument();
  });
});
