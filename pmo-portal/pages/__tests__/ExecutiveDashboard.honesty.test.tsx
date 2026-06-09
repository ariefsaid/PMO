import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
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

const winRateOracle = {
  wins_count: 2,
  losses_count: 1,
  wins_value: 8000000,
  losses_value: 650000,
  win_rate_count: 0.666667,
  win_rate_value: 0.924855,
};

vi.mock('@/src/hooks/useDashboard', () => ({
  useDashboard: () => ({ data: populated, isPending: false, isError: false, refetch: vi.fn() }),
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
});

describe('ExecutiveDashboard honesty — labels match values (AC-IXD-DASH-001/002)', () => {
  it('AC-IXD-DASH-001: the on-hand revenue tile is labeled "Revenue on hand" (not "…margin")', () => {
    renderPage();
    const tile = screen.getByTestId('kpi-on-hand-margin');
    // The label names the number: a revenue figure is "Revenue on hand", never a "margin".
    expect(within(tile).getByText(/Revenue on hand/i)).toBeInTheDocument();
    expect(within(tile).queryByText(/on-hand margin/i)).toBeNull();
    expect(within(tile).queryByText(/^margin$/i)).toBeNull();
    // The true margin RATIO still rides as the `vs` sub.
    expect(tile).toHaveTextContent(/94\.9%\s*realized/i);
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
