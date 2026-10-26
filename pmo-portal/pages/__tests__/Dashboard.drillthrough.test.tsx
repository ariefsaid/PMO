/**
 * AC-IXD-DASH-W5-C2A — Dashboard KPI drill-through (Wave 5, Cluster 2, PR-A)
 *
 * Tests that:
 * 1. Wired KPI tiles render as <Link> elements pointing to the right URL
 * 2. Plain tiles are NOT links
 * 3. Each dashboard drills correctly per the §3 disposition tables
 * 4. The shared at-risk threshold constant is exported from the right place
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import React from 'react';

// ── Shared mocks ────────────────────────────────────────────────────────────

const dash = {
  active_projects: 4,
  active_delivery_projects: 4,
  risk_unchecked_projects: 0,
  total_contract_value: 8_000_000, currency: 'USD',
  on_hand_margin: 0.25,
  on_hand_value: 6_000_000,
  pipeline_weighted_value: 800_000,
  pipeline_projected_margin: 0.2,
  pipeline_total_value: 2_000_000,
  projects_at_risk: 1,
  projects_by_status: [],
  procurements_by_status: [{ status: 'Paid', count: 2 }],
  top_projects: [
    { id: 'p1', name: 'Alpha', client_name: 'Acme', contract_value: 5_000_000, currency: 'USD', budget: 4_000_000, spent: 3_000_000, status: 'Ongoing Project' },
    { id: 'p2', name: 'Beta', client_name: 'Beta Co', contract_value: 3_000_000, currency: 'USD', budget: 2_000_000, spent: 1_000_000, status: 'Ongoing Project' },
  ],
};

const procurements = [
  { id: 'pr1', status: 'Vendor Invoiced', total_value: 250_000, currency: 'USD', requested_by_id: 'u1' },
  { id: 'pr2', status: 'Paid', total_value: 999_999, currency: 'USD', requested_by_id: 'u1' },
];

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
  useDashboard: () => ({ data: dash, isPending: false, isError: false, refetch: vi.fn() }),
  usePMDashboardProjects: () => ({ data: mine ?? [], isPending: false, isError: false, refetch: vi.fn() }),
  useFinanceBudgetReview: () => ({ data: [], isPending: false, isError: false, refetch: vi.fn() }),
  useSalesPipeline: () => ({ data: { stages: [{ status: 'Negotiation', count: 1, total_value: 2_000_000, win_probability: 0.4, weighted_value: 800_000 }] }, isPending: false, isError: false, refetch: vi.fn() }),
  useWinRate: () => ({ data: null, isPending: false, isError: false }),
}));
vi.mock('@/src/hooks/useProcurements', () => ({
  useProcurements: () => ({ data: procurements, isPending: false, isError: false, refetch: vi.fn() }),
}));
// task FIX-2 (Discover CRITICAL 2): FinanceDashboard now mounts AccountingSnapshotsSection.
vi.mock('@/src/hooks/useErpSnapshots', () => ({
  useActualsSnapshot: () => ({ data: [], isPending: false, isError: false, refetch: vi.fn() }),
  useApAgingSnapshot: () => ({ data: [], isPending: false, isError: false, refetch: vi.fn() }),
  useArAgingSnapshot: () => ({ data: [], isPending: false, isError: false, refetch: vi.fn() }),
}));
vi.mock('@/src/hooks/useProjects', () => ({ useProjectIdentity: () => ({ data: [] }), useProjects: () => ({ data: [] }) }));
vi.mock('@/src/hooks/useCompanies', () => ({
  useCompanies: () => ({ data: [], isPending: false, isError: false }),
}));
vi.mock('@/src/hooks/useCompanyCollections', () => ({
  useCompanyCollections: () => ({ customerLinks: new Map() }),
}));
vi.mock('@/src/hooks/useTimesheetApproval', () => ({
  useTimesheetsAwaitingApproval: () => ({ data: [], isPending: false }),
}));
vi.mock('@/src/auth/useAuth', () => ({
  useAuth: () => ({ currentUser: { id: 'u1', org_id: 'org-1' }, role: 'Executive' }),
}));

// ── Exec dashboard ───────────────────────────────────────────────────────────

vi.mock('@/src/auth/impersonation', () => ({
  useEffectiveRole: () => ({ effectiveRole: 'Executive', realRole: 'Executive' }),
}));

import ExecutiveDashboard from '../ExecutiveDashboard';
import { ToastProvider } from '@/src/components/ui/Toast';

const renderExec = () =>
  render(
    <MemoryRouter>
      <ToastProvider>
        <ExecutiveDashboard />
      </ToastProvider>
    </MemoryRouter>,
  );

describe('AC-IXD-DASH-W5-C2A — Executive dashboard KPI drills', () => {
  it('AC-806-EXEC-SPEND-001: project identity and open action reach the canonical project record', () => {
    renderExec();
    const table = screen.getByRole('table', { name: /spending comparison/ });
    expect(within(table).getByRole('link', { name: 'Alpha' })).toHaveAttribute('href', '/projects/p1');
    expect(within(table).getByRole('link', { name: 'Open Alpha' })).toHaveAttribute('href', '/projects/p1');
  });

  it('AC-806-EXEC-BOOK-001: delivery position shows exact values without a misleading aggregate link', () => {
    renderExec();
    const delivery = screen.getByRole('region', { name: 'Delivery book' });
    expect(delivery).toHaveTextContent('6,000,000');
    expect(delivery).toHaveTextContent('$8,000,000');
    expect(delivery.querySelector('a[href="/projects?filter=Ongoing"]')).toBeNull();
    expect(screen.getByRole('link', { name: 'Negotiation' })).toHaveAttribute('href', '/sales?status=Negotiation');
  });
});

// ── Finance dashboard ────────────────────────────────────────────────────────

import { FinanceDashboard } from '@/src/components/dashboard/FinanceDashboard';

const renderFinance = () =>
  render(
    <MemoryRouter>
      <FinanceDashboard />
    </MemoryRouter>,
  );

describe('AC-IXD-DASH-W5-C2A — Finance dashboard KPI drills', () => {
  it('AC-806-FIN-PAY-001: invoice case rows open the canonical procurement record', () => {
    const { container } = renderFinance();
    expect(container.querySelector('a[href="/procurement/pr1"]')).toBeInTheDocument();
  });
});

// ── PM dashboard ─────────────────────────────────────────────────────────────

const mine = [
  { id: 'p1', name: 'My Project A', contract_value: 4_000_000, currency: 'USD', budget: 3_000_000, spent: 1_000_000, realized_margin_pct: null, contract_remaining: 3_000_000, status: 'Ongoing Project', project_manager_id: 'pm-1', client_name: 'Acme', actual_complete: true, actual_currency: 'USD', budget_currency: 'USD' },
  { id: 'p2', name: 'My Project B', contract_value: 2_000_000, currency: 'USD', budget: 1_000_000, spent: 980_000, realized_margin_pct: null, contract_remaining: 1_020_000, status: 'Won, Pending KoM', project_manager_id: 'pm-1', client_name: 'Beta', actual_complete: true, actual_currency: 'USD', budget_currency: 'USD' },
];


vi.mock('@/src/hooks/useProjects', () => ({ useProjectIdentity: () => ({ data: [] }), useProjects: () => ({ data: [] }) }));
vi.mock('@/src/hooks/useProjectsDelivery', () => ({
  useProjectsDelivery: () => ({ data: {} }),
}));

import { PMDashboard } from '@/src/components/dashboard/PMDashboard';

const renderPM = () =>
  render(
    <MemoryRouter>
      <PMDashboard />
    </MemoryRouter>,
  );

describe('AC-IXD-DASH-W5-C2A — PM dashboard KPI drills', () => {
  it('AC-806-PM-WORKLIST-001: project identity opens its assigned project record', () => {
    const { container } = renderPM();
    expect(screen.getByRole('link', { name: 'My Project A' })).toHaveAttribute('href', '/projects/p1');
    expect(screen.getByRole('link', { name: 'My Project B' })).toHaveAttribute('href', '/projects/p2');
    expect(container.querySelector('a[href="/projects?filter=at-risk"]')).toBeInTheDocument();
  });
});

// ── Engineer dashboard ────────────────────────────────────────────────────────

const sheets = [
  {
    id: 's1', status: 'Draft', week_start_date: '2026-06-01', user_id: 'eng-1', org_id: 'o1',
    submitted_at: null, approved_at: null, approved_by: null,
    entries: [
      { id: 'e1', hours: 8, entry_date: '2026-06-01', project_id: 'p1', timesheet_id: 's1', org_id: 'o1', notes: null, project: { name: 'A', code: null } },
    ],
  },
];

vi.mock('@/src/hooks/useTimesheets', () => ({
  useTimesheets: () => ({ data: sheets, isPending: false, isError: false, refetch: vi.fn() }),
}));

import { EngineerDashboard } from '@/src/components/dashboard/EngineerDashboard';

const renderEngineer = () =>
  render(
    <MemoryRouter>
      <EngineerDashboard />
    </MemoryRouter>,
  );

describe('AC-IXD-DASH-W5-C2A — Engineer dashboard KPI drills', () => {
  it('AC-806-ENG-WEEK-001: the dated weekly summary keeps the Log hours destination', () => {
    renderEngineer();
    expect(screen.getByTestId('engineer-week-summary')).toHaveTextContent('This week');
    expect(screen.getByRole('link', { name: "Log this week's hours" })).toHaveAttribute('href', '/timesheets');
  });
});
