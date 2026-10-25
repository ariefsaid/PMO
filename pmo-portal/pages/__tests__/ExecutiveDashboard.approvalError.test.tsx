import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import React from 'react';
import { ToastProvider } from '@/src/components/ui/Toast';

/**
 * W2-4f — ExecutiveDashboard mobile approval count shows "—" on contributing-query error.
 * AC-W2-4-06: when useProcurements or useTimesheetsAwaitingApproval errors,
 *              mobile approval band shows "—" not fabricated 0.
 *
 * The mobile dashboard renders when useIsDesktop() returns false.
 */

const populated = {
  active_projects: 2,
  total_contract_value: 5000000, currency: 'USD',
  on_hand_margin: 0.8,
  on_hand_value: 4000000,
  pipeline_weighted_value: 500000,
  pipeline_projected_margin: 0.2,
  pipeline_total_value: 1000000,
  projects_at_risk: 0,
  projects_by_status: [{ status: 'Ongoing Project', count: 2 }],
  procurements_by_status: [{ status: 'Requested', count: 1 }],
  top_projects: [
    {
      id: 'p1', name: 'Alpha Project', client_name: 'ACME',
      contract_value: 5000000, currency: 'USD', budget: 4700000, spent: 2100000, status: 'Ongoing Project',
    },
  ],
};

const { procState, tsState } = vi.hoisted(() => ({
  procState: {
    data: undefined as unknown[] | undefined,
    isPending: false,
    isError: true,
  },
  tsState: {
    data: undefined as unknown[] | undefined,
    isPending: false,
    isError: false,
  },
}));

// FR-L10N-020: this tree reads useOrgCurrency (org-denominated aggregates). Pinned here rather
// than left to a real query. ⚑ At LINE-START — inside a neighbouring vi.mock it parses as a
// syntax error and hides every real error beneath it.
// OD-BILL-1: the Still-to-invoice card reads through react-query; stubbed like the other dashboard hooks.
vi.mock('@/src/hooks/useWorkOrderBilling', () => ({
  useUnbilledWorkOrders: () => ({ data: undefined, isPending: true, isError: false, refetch: vi.fn() }),
}));
vi.mock('@/src/hooks/useOrgCurrency', () => ({ useOrgCurrency: () => 'USD' }));
vi.mock('@/src/hooks/useDashboard', () => ({
  useDashboard: () => ({ data: populated, isPending: false, isError: false, refetch: vi.fn() }),
  useWinRate: () => ({ data: undefined, isPending: false, isError: false }),
  useSalesPipeline: () => ({ data: null, isPending: false, isError: false, refetch: vi.fn() }),
}));
vi.mock('@/src/auth/impersonation', () => ({
  useEffectiveRole: () => ({ effectiveRole: 'Executive', realRole: 'Executive' }),
}));
vi.mock('@/src/hooks/useProcurements', () => ({
  useProcurements: () => procState,
}));
vi.mock('@/src/hooks/useTimesheetApproval', () => ({
  useTimesheetsAwaitingApproval: () => tsState,
}));
vi.mock('@/src/auth/useAuth', () => ({
  useAuth: () => ({ currentUser: { id: 'u1', org_id: 'org-1' }, role: 'Executive' }),
}));
// Force mobile rendering
vi.mock('@/src/components/ui/useIsDesktop', () => ({
  useIsDesktop: () => false,
}));
vi.mock('@/src/components/reports/BoardPackAction', () => ({
  BoardPackAction: () => <button type="button">Board pack</button>,
}));

import ExecutiveDashboard from '../ExecutiveDashboard';

const renderPage = () =>
  render(
    <MemoryRouter>
      <ToastProvider>
        <ExecutiveDashboard />
      </ToastProvider>
    </MemoryRouter>,
  );

beforeEach(() => {
  procState.data = undefined;
  procState.isPending = false;
  procState.isError = true;
  tsState.data = undefined;
  tsState.isPending = false;
  tsState.isError = false;
});

describe('ExecutiveDashboard — approval status errors (AC-W2-4-06)', () => {
  it('AC-W2-4-06: procurement failure is unavailable and provides a quiet inbox link', () => {
    procState.isError = true;
    renderPage();

    const attention = screen.getByTestId('dashboard-attention');
    expect(attention).toHaveTextContent('Approval status is unavailable');
    expect(within(attention).getByRole('link', { name: 'Open approvals' })).toHaveAttribute('href', '/approvals');
    expect(within(attention).queryByText(/0 approval/)).not.toBeInTheDocument();
    expect(within(attention).queryByRole('link', { name: 'Review requests' })).not.toBeInTheDocument();
  });

  it('AC-W2-4-06: timesheet failure is unavailable and provides a quiet inbox link', () => {
    procState.isError = false;
    procState.data = [];
    tsState.isError = true;
    renderPage();

    const attention = screen.getByTestId('dashboard-attention');
    expect(attention).toHaveTextContent('Approval status is unavailable');
    expect(within(attention).getByRole('link', { name: 'Open approvals' })).toHaveAttribute('href', '/approvals');
    expect(within(attention).queryByText(/0 approval/)).not.toBeInTheDocument();
  });

  it('AC-SL-A-001: confirms a clear queue without offering a review action', () => {
    procState.isError = false;
    procState.data = [];
    tsState.isError = false;
    tsState.data = [];
    renderPage();
    const attention = screen.getByTestId('dashboard-attention');
    expect(attention).toHaveTextContent('No approval requests need a decision');
    expect(within(attention).queryByRole('link', { name: /Review|Open approvals/ })).not.toBeInTheDocument();
  });

  it('shows a known count and review action when items wait without error', () => {
    procState.isError = false;
    procState.data = [];
    tsState.isError = false;
    tsState.data = [{ id: 't1' }];
    renderPage();
    const attention = screen.getByTestId('dashboard-attention');
    expect(attention).toHaveTextContent('1 approval request needs a decision');
    expect(within(attention).getByRole('link', { name: 'Review requests' })).toHaveAttribute('href', '/approvals');
  });
});
