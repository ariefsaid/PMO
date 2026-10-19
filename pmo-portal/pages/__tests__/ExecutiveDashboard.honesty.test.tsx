import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import React from 'react';
import ExecutiveDashboard from '../ExecutiveDashboard';
import { ToastProvider } from '@/src/components/ui/Toast';

/**
 * Area 4 — lying surfaces (IxD SP-7). The exec dashboard must not print a metric whose
 * LABEL contradicts its VALUE, and must not name two different numbers with one metric name.
 *
 * AC-IXD-DASH-001 — the tile that shows `on_hand_value` (a revenue figure that can exceed total
 *   contract value) is labeled "Revenue on hand", NOT "…margin". A metric label is a promise
 *   about the number.
 * AC-IXD-DASH-002 — exactly ONE tile is named for the projected/forecast margin (the pipeline
 *   one, "Pipeline forecast margin"); there are NOT two tiles both named "Projected margin"
 *   showing different numbers. One metric name = one number.
 */

// On-hand value DELIBERATELY exceeds total contract value to expose the lie if it's mislabeled
// "margin": a $9.0M revenue figure can never be a "margin $" on an $8.0M book.
const populated = {
  active_projects: 2,
  total_contract_value: 8000000,
  on_hand_margin: 0.949375, // the true realized margin RATIO (shown as the `vs`)
  on_hand_value: 9000000, // revenue on hand — NOT a margin
  pipeline_weighted_value: 800000,
  pipeline_projected_margin: 0.2, // the pipeline forecast margin ratio
  pipeline_total_value: 2000000,
  projects_at_risk: 1,
  projects_by_status: [{ status: 'Ongoing Project', count: 2 }],
  procurements_by_status: [{ status: 'Draft', count: 1 }],
  top_projects: [
    {
      id: 'p1',
      name: 'Innovate Corp HQ Fit-Out',
      client_name: 'Innovate Corp',
      contract_value: 5000000,
      budget: 4700000,
      spent: 2100000,
      status: 'Ongoing Project',
    },
  ],
};

const dashboardState = vi.hoisted(() => ({
  data: null as unknown,
  isPending: false,
  isError: false,
  refetch: vi.fn(),
}));

const winRateOracle = {
  wins_count: 2,
  losses_count: 1,
  wins_value: 8000000,
  losses_value: 650000,
  win_rate_count: 0.666667,
  win_rate_value: 0.924855,
};

// BoardPackAction (#765) reads the management pack via react-query; these tests render without a QueryClient.
// OD-BILL-1: the Still-to-invoice card reads through react-query; stubbed like the other dashboard hooks.
vi.mock('@/src/hooks/useWorkOrderBilling', () => ({
  useUnbilledWorkOrders: () => ({ data: undefined, isPending: true, isError: false, refetch: vi.fn() }),
}));
vi.mock('@/src/components/reports/BoardPackAction', () => ({ BoardPackAction: () => null }));
vi.mock('@/src/hooks/useDashboard', () => ({
  useDashboard: () => dashboardState,
  useWinRate: () => ({ data: winRateOracle, isPending: false, isError: false }),
  useSalesPipeline: () => ({ data: null, isPending: false, isError: false }),
}));
vi.mock('@/src/auth/impersonation', () => ({
  useEffectiveRole: () => ({ effectiveRole: 'Executive', realRole: 'Executive' }),
}));
// N15 approvals tile reads procurements + the timesheet queue.
vi.mock('@/src/hooks/useProcurements', () => ({
  useProcurements: () => ({ data: [], isPending: false }),
}));
vi.mock('@/src/hooks/useTimesheetApproval', () => ({
  useTimesheetsAwaitingApproval: () => ({ data: [] }),
}));
// FR-L10N-020: exec-dashboard KPI aggregates are org-denominated (RPC rows carry no currency).
vi.mock('@/src/hooks/useOrgCurrency', () => ({ useOrgCurrency: () => 'USD' }));
vi.mock('@/src/auth/useAuth', () => ({
  useAuth: () => ({ currentUser: { id: 'u1', org_id: 'org-1' }, role: 'Executive' }),
}));

const renderPage = () =>
  render(
    <MemoryRouter>
      <ToastProvider>
        <ExecutiveDashboard />
      </ToastProvider>
    </MemoryRouter>,
  );

beforeEach(() => {
  vi.clearAllMocks();
  dashboardState.data = populated;
  dashboardState.isPending = false;
  dashboardState.isError = false;
});

describe('ExecutiveDashboard honesty — labels match values (AC-IXD-DASH-001/002)', () => {
  it('AC-UX-017: the on-hand contract value tile separates margin from contract remaining', () => {
    renderPage();
    const tile = screen.getByTestId('kpi-on-hand-margin');
    expect(within(tile).getByText(/Contract value on hand/i)).toBeInTheDocument();
    expect(tile).toHaveTextContent(/Contract remaining after known Actual/);
    expect(tile).toHaveTextContent(/Margin on billed work/);
    expect(tile).not.toHaveTextContent(/Realized margin/);
    expect(tile).not.toHaveTextContent(/cash received/i);
  });

  it('AC-IXD-DASH-002: exactly ONE forecast-margin tile, named "Pipeline forecast margin"', () => {
    renderPage();
    const tile = screen.getByTestId('kpi-pipeline-projected-margin');
    expect(within(tile).getByText(/Pipeline forecast margin/i)).toBeInTheDocument();
    // It shows ONLY the weighted pipeline projected margin (20.0%) — no on-hand option.
    expect(tile).toHaveTextContent('20.0%');
    // No dual-lens toggle remains (one metric name = one number).
    expect(within(tile).queryByRole('tab', { name: /On-hand/i })).toBeNull();
    expect(within(tile).queryByRole('tab', { name: /Weighted/i })).toBeNull();
  });

  it('AC-IXD-DASH-002: no tile is named the ambiguous "Projected margin" anymore', () => {
    renderPage();
    // The old contradictory name (two metrics under one label) is gone everywhere.
    expect(screen.queryByText(/^Projected margin$/i)).toBeNull();
  });

  it('DASH-002: the pipeline-margin CHART panel heading matches the tile noun "Pipeline forecast margin"', () => {
    renderPage();
    // The chart panel that visualizes the same metric reads the SAME canonical noun as the tile —
    // not the divergent "Pipeline — Projected Margin".
    const panel = screen.getByTestId('dashboard-pipeline-margin');
    expect(within(panel).getByText('Pipeline forecast margin')).toBeInTheDocument();
    expect(screen.queryByText(/Pipeline\s*—\s*Projected Margin/i)).toBeNull();
  });
});

describe('AC-FAA-006 executive comparison population', () => {
  it.each([
    ['pipeline-only', 'Tender Submitted'],
    ['lost-only', 'Lost'],
  ])('keeps portfolio evidence and KPIs for a %s portfolio with no delivery rows', (_kind, status) => {
    dashboardState.data = {
      ...populated,
      active_projects: 0,
      top_projects: [],
      projects_by_status: [{ status, count: 2 }],
      procurements_by_status: [],
    };

    renderPage();

    expect(screen.queryByTestId('dashboard-empty')).not.toBeInTheDocument();
    expect(screen.getByTestId('kpi-pipeline-weighted-value')).toBeInTheDocument();
    expect(screen.getByTestId('dashboard-pipeline')).toBeInTheDocument();
    expect(screen.getByText('No delivery projects to compare yet')).toBeInTheDocument();
    expect(screen.getByText('Won, on-hold, delivery and closed-out projects, plus internal work.')).toBeInTheDocument();
  });

  it('uses the portfolio empty state only when project status and procurement evidence are both empty', () => {
    dashboardState.data = {
      ...populated,
      top_projects: [],
      projects_by_status: [],
      procurements_by_status: [],
    };

    renderPage();

    expect(screen.getByTestId('dashboard-empty')).toBeInTheDocument();
    expect(screen.getByText('No data yet')).toBeInTheDocument();
  });

  it('preserves loading and error precedence for absent chart data', () => {
    dashboardState.data = null;
    dashboardState.isPending = true;
    const pending = renderPage();
    expect(screen.getByTestId('dashboard-loading')).toBeInTheDocument();
    expect(screen.queryByTestId('dashboard-empty')).not.toBeInTheDocument();
    pending.unmount();

    dashboardState.isPending = false;
    dashboardState.isError = true;
    renderPage();
    expect(screen.getByTestId('dashboard-error')).toBeInTheDocument();
    expect(screen.queryByText('No delivery projects to compare yet')).not.toBeInTheDocument();
  });
});
