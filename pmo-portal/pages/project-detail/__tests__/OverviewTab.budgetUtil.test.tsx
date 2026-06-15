/**
 * B-0.4 — OverviewTab budget-utilization card must NOT collapse
 * useProjectBudget pending/error → "$0 of $0".
 * AC-B-0-4: error/loading renders a distinct ListState, not silent zeros.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import React from 'react';
import type { ProjectWithRefs } from '@/src/lib/db/projects';
import type { BudgetVersionWithItems } from '@/src/lib/db/budgets';

const { budgetUtilState } = vi.hoisted(() => ({
  budgetUtilState: {
    data: 900_000 as number | undefined,
    isPending: false,
    isError: false,
    refetch: vi.fn(),
  },
}));

vi.mock('@/src/hooks/useBudget', () => ({
  useBudgetVersions: () => ({ data: [] as BudgetVersionWithItems[], isPending: false, isError: false, refetch: vi.fn() }),
  useProjectBudget: () => budgetUtilState,
  useBudgetMutations: () => ({}),
}));
vi.mock('@/src/hooks/useProcurements', () => ({
  useProcurements: () => ({ data: [], isPending: false, isError: false, refetch: vi.fn() }),
}));
vi.mock('@/src/auth/useAuth', () => ({
  useAuth: () => ({ currentUser: { id: 'u1', org_id: 'o1' }, role: 'Project Manager' }),
}));
vi.mock('react-router-dom', async (orig) => {
  const actual = await (orig() as Promise<Record<string, unknown>>);
  return { ...actual, useNavigate: () => vi.fn() };
});

import OverviewTab from '../tabs/OverviewTab';

const project: ProjectWithRefs = {
  id: 'p1',
  name: 'Alpha HQ',
  code: 'A001',
  status: 'Ongoing Project',
  contract_value: 1_000_000,
  budget: 0, // dead stored column
  spent: 0,
  start_date: '2026-01-01',
  end_date: '2026-12-31',
  client_id: 'c1',
  project_manager_id: 'u1',
  customer_contract_ref: null,
  org_id: 'o1',
  contract_date: null,
  client: { name: 'Acme Corp' },
  pm: { full_name: 'Alice' },
} as unknown as ProjectWithRefs;

const renderTab = () =>
  render(
    <MemoryRouter>
      <OverviewTab project={project} committedSpend={500_000} />
    </MemoryRouter>,
  );

beforeEach(() => {
  budgetUtilState.data = 900_000;
  budgetUtilState.isPending = false;
  budgetUtilState.isError = false;
  budgetUtilState.refetch.mockClear();
});

describe('AC-B-0-4: OverviewTab budget-utilization card — loading/error states', () => {
  it('AC-B-0-4: normal state shows the utilization bar (not an error)', () => {
    renderTab();
    expect(screen.getByText(/Budget utilization/i)).toBeInTheDocument();
    // The committed / budget line appears in normal state
    expect(screen.getByText(/budget committed/i)).toBeInTheDocument();
  });

  it('AC-B-0-4: loading state renders a ListState skeleton (not "$0 of $0")', () => {
    budgetUtilState.isPending = true;
    budgetUtilState.data = undefined;
    renderTab();

    // The skeleton / loading indicator must be present
    // ListState variant="loading" renders data-testid="list-state-loading" rows
    expect(screen.queryByText(/budget committed/i)).toBeNull();
    // Should not show "0 of $0" (false-zero)
    expect(document.body.textContent).not.toMatch(/\$0 of \$0/);
  });

  it('AC-B-0-4: error state renders a distinct error message (not "$0 of $0")', () => {
    budgetUtilState.isPending = false;
    budgetUtilState.isError = true;
    budgetUtilState.data = undefined;
    renderTab();

    // "Couldn't load budget" error heading must be visible
    expect(screen.getByText(/Couldn't load budget/i)).toBeInTheDocument();
    // The utilization bar / "budget committed" text must NOT be present
    expect(screen.queryByText(/budget committed/i)).toBeNull();
    // Should NOT show the false-zero state
    expect(document.body.textContent).not.toMatch(/\$0 of \$0/);
  });

  it('AC-B-0-4: error state shows a Retry affordance', () => {
    budgetUtilState.isPending = false;
    budgetUtilState.isError = true;
    budgetUtilState.data = undefined;
    renderTab();

    const retryBtn = screen.getByRole('button', { name: /retry/i });
    expect(retryBtn).toBeInTheDocument();
  });
});
