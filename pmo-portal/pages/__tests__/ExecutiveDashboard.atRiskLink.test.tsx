import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import React from 'react';
import ExecutiveDashboard from '../ExecutiveDashboard';
import { ToastProvider } from '@/src/components/ui/Toast';

/**
 * AC-IFW-DASH-02 — Exec "N at-risk" subtext becomes a discrete link to /projects?filter=at-risk
 * (Lens-D dead-display sweep). The whole KPITile for Active Projects is already a link to
 * /projects?filter=Ongoing — the at-risk indicator must be a SEPARATE element (no nested interactives).
 */

const populated = {
  active_projects: 5,
  total_contract_value: 8_000_000,
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
      contract_value: 5_000_000,
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
// Force desktop rendering so the KPI band is in view
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

describe('ExecutiveDashboard — AC-IFW-DASH-02: at-risk indicator links to /projects?filter=at-risk', () => {
  it('AC-IFW-DASH-02: a discrete "2 at-risk" link navigates to /projects?filter=at-risk (Lens-D regression invariant)', () => {
    renderPage();
    // The at-risk link is a SEPARATE element from the Active projects tile (no nested interactives).
    const atRiskLink = screen.getByRole('link', { name: /at.risk/i });
    expect(atRiskLink).toBeInTheDocument();
    expect(atRiskLink).toHaveAttribute('href', '/projects?filter=at-risk');
  });

  it('AC-IFW-DASH-02: the at-risk link text includes the numeric count', () => {
    renderPage();
    const atRiskLink = screen.getByRole('link', { name: /at.risk/i });
    expect(atRiskLink).toHaveTextContent('2');
  });

  it('AC-IFW-DASH-02: the at-risk link is NOT nested inside the Active-projects tile link (no nested interactives)', () => {
    renderPage();
    const activeProjectsTile = screen.getByTestId('kpi-active-projects');
    const atRiskLink = screen.getByRole('link', { name: /at.risk/i });
    // The at-risk link must NOT be a descendant of the Active-projects tile link element
    const tileLink = activeProjectsTile.querySelector('a');
    if (tileLink) {
      expect(tileLink.contains(atRiskLink)).toBe(false);
    }
  });
});
