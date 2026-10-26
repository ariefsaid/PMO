import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import React from 'react';
import ExecutiveDashboard from '../ExecutiveDashboard';
import { ToastProvider } from '@/src/components/ui/Toast';

/** AC-IFW-DASH-02 — the Executive risk action opens the canonical at-risk project filter. */

const populated = {
  active_projects: 5,
  total_contract_value: 8_000_000, currency: 'USD',
  on_hand_margin: 0.2,
  on_hand_value: 9_000_000,
  pipeline_weighted_value: 800_000,
  pipeline_projected_margin: 0.2,
  pipeline_total_value: 2_000_000,
  projects_at_risk: 2,
  projects_by_status: [{ status: 'Ongoing Project', count: 5 }],
  procurements_by_status: [{ status: 'Draft', count: 1 }],
  top_projects: [
    {
      id: 'p1',
      name: 'Meridian HQ',
      client_name: 'Meridian',
      contract_value: 5_000_000, currency: 'USD',
      budget: 4_700_000,
      spent: 2_100_000,
      status: 'Ongoing Project',
    },
  ],
};

const winRateOracle = {
  wins_count: 2,
  losses_count: 1,
  wins_value: 8_000_000,
  losses_value: 650_000,
  win_rate_count: 0.666667,
  win_rate_value: 0.924855,
};

// FR-L10N-020: this tree reads useOrgCurrency (org-denominated aggregates). Pinned here rather
// than left to a real query. ⚑ At LINE-START — inside a neighbouring vi.mock it parses as a
// syntax error and hides every real error beneath it.
// BoardPackAction (#765) reads the management pack via react-query; these tests render without a QueryClient.
// OD-BILL-1: the Still-to-invoice card reads through react-query; stubbed like the other dashboard hooks.
vi.mock('@/src/hooks/useWorkOrderBilling', () => ({
  useUnbilledWorkOrders: () => ({ data: undefined, isPending: true, isError: false, refetch: vi.fn() }),
}));
vi.mock('@/src/components/reports/BoardPackAction', () => ({ BoardPackAction: () => null }));
vi.mock('@/src/hooks/useOrgCurrency', () => ({ useOrgCurrency: () => 'USD' }));
vi.mock('@/src/hooks/useDashboard', () => ({
  useDashboard: () => ({ data: populated, isPending: false, isError: false, refetch: vi.fn() }),
  useWinRate: () => ({ data: winRateOracle, isPending: false, isError: false }),
  useSalesPipeline: () => ({ data: null, isPending: false, isError: false }),
}));
vi.mock('@/src/auth/impersonation', () => ({
  useEffectiveRole: () => ({ effectiveRole: 'Executive', realRole: 'Executive' }),
}));
vi.mock('@/src/hooks/useProcurements', () => ({
  useProcurements: () => ({ data: [], isPending: false }),
}));
vi.mock('@/src/hooks/useTimesheetApproval', () => ({
  useTimesheetsAwaitingApproval: () => ({ data: [] }),
}));
vi.mock('@/src/auth/useAuth', () => ({
  useAuth: () => ({ currentUser: { id: 'u1', org_id: 'org-1' }, role: 'Executive' }),
}));
vi.mock('@/src/components/ui/useIsDesktop', () => ({
  useIsDesktop: () => true,
}));

const renderPage = () =>
  render(
    <MemoryRouter>
      <ToastProvider>
        <ExecutiveDashboard />
      </ToastProvider>
    </MemoryRouter>,
  );

beforeEach(() => vi.clearAllMocks());

describe('ExecutiveDashboard — AC-IFW-DASH-02: risk action links to /projects?filter=at-risk', () => {
  it('AC-IFW-DASH-02: the at-risk action navigates to the canonical project filter', () => {
    renderPage();
    const atRiskLink = screen.getByRole('link', { name: 'Review at-risk projects' });
    expect(atRiskLink).toHaveAttribute('href', '/projects?filter=at-risk');
  });

  it('AC-IFW-DASH-02: risk evidence gives a count before the action', () => {
    renderPage();
    expect(screen.getByText('2 projects at risk')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Review at-risk projects' })).toBeInTheDocument();
  });

  it('AC-IFW-DASH-02: risk action and project record links remain separate actions', () => {
    renderPage();
    const attention = screen.getByTestId('dashboard-attention');
    const table = screen.getByRole('table', { name: /spending comparison/ });
    const riskAction = within(attention).getByRole('link', { name: 'Review at-risk projects' });
    const projectAction = within(table).getByRole('link', { name: 'Meridian HQ' });
    expect(riskAction.closest('a')).toBe(riskAction);
    expect(projectAction).toHaveAttribute('href', '/projects/p1');
    expect(table.contains(riskAction)).toBe(false);
  });
});
