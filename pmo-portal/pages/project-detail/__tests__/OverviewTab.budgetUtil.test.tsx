/**
 * B-0.4 — OverviewTab budget-utilization card must NOT collapse
 * useProjectBudget pending/error → "$0 of $0".
 * AC-B-0-4: error/loading renders a distinct ListState, not silent zeros.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
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

// #566: the Overview tab now renders <ProjectDrawdown>, which reads through react-query. These
// specs predate it and mount without a QueryClientProvider, so the hook is stubbed here rather
// than the whole tree re-hosted. Held in its loading state so it contributes no text of its own —
// the drawdown's own states are covered in ProjectDrawdown.test.tsx.
vi.mock('@/src/hooks/useRevenue', async (orig) => ({
  ...(await orig<typeof import('@/src/hooks/useRevenue')>()),
  useSalesInvoices: () => ({ data: [], isPending: false, isError: false, refetch: vi.fn() }),
}));
vi.mock('@/src/auth/usePermission', () => ({ usePermission: () => () => true }));
vi.mock('@/src/auth/impersonation', () => ({ useEffectiveRole: () => ({ realRole: 'Project Manager', effectiveRole: 'Project Manager' }) }));
vi.mock('@/src/hooks/useProjectFinances', () => ({ useProjectFinances: () => ({ data: { project_id: 'p1', contract_invoiced: null, remaining_to_invoice: null, invoices: [], budget: null, actuals: { currency: 'USD', total: '500000.00', as_of: null, excludes_restricted_rows: false, categories: [{ category: 'Labor', mapped: true, amount: '500000.00' }] } }, isPending: false, isError: false }) }));
vi.mock('@/src/hooks/useWorkOrders', () => ({
  useProjectDrawdown: () => ({ data: null, isPending: true, isError: false, refetch: vi.fn() }),
}));

vi.mock('@/src/hooks/useBudget', () => ({
  useBudgetVersions: () => ({ data: [{ id: 'bv1', status: 'Active', total: 900_000, line_items: [] }] as unknown as BudgetVersionWithItems[], isPending: false, isError: false, refetch: vi.fn() }),
  useProjectBudget: () => budgetUtilState,
  useBudgetMutations: () => ({}),
}));
vi.mock('@/src/hooks/useProcurements', () => ({
  useProcurements: () => ({ data: [], isPending: false, isError: false, refetch: vi.fn() }),
  useProjectProcurements: () => ({ data: [], isPending: false, isError: false, refetch: vi.fn() }),
  useProjectCommittedSpend: () => ({ data: 0, isPending: false, isError: false, commitmentSource: 'not-tracked' }),
}));
vi.mock('@/src/auth/useAuth', () => ({
  useAuth: () => ({ currentUser: { id: 'u1', org_id: 'o1' }, role: 'Project Manager' }),
}));
vi.mock('react-router', async (orig) => {
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
  currency: 'USD',
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
      <OverviewTab project={project} committedSpend={500_000} commitmentSource="not-tracked" ledgerBasis="erp" />
    </MemoryRouter>,
  );

beforeEach(() => {
  budgetUtilState.data = 900_000;
  budgetUtilState.isPending = false;
  budgetUtilState.isError = false;
  budgetUtilState.refetch.mockClear();
});

describe('AC-B-0-4: OverviewTab budget use — loading/error states never show a false zero', () => {
  it('AC-B-0-4: normal state shows budget use in the Budget snapshot (not an error)', () => {
    renderTab();
    // PD-B: the Budget utilization card is gone; complete mapped Actual over the Active budget
    // reads as "% of budget" in the Budget snapshot's Budget position.
    expect(screen.queryByText(/Budget utilization/i)).not.toBeInTheDocument();
    expect(screen.getByTestId('budget-used')).toHaveTextContent(/\d+% of budget/);
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

  it('AC-B-0-4: a failed budget read shows no budget-use figure and no false zero', () => {
    budgetUtilState.isPending = false;
    budgetUtilState.isError = true;
    budgetUtilState.data = undefined;
    renderTab();

    expect(screen.queryByTestId('budget-used')).toBeNull();
    expect(screen.queryByText(/0% of budget/)).toBeNull();
    expect(document.body.textContent).not.toMatch(/\$0 of \$0/);
  });
});
