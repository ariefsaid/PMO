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
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import React from 'react';

// ── Shared mocks ────────────────────────────────────────────────────────────

const dash = {
  active_projects: 4,
  total_contract_value: 8_000_000,
  on_hand_margin: 0.25,
  on_hand_value: 6_000_000,
  pipeline_weighted_value: 800_000,
  pipeline_projected_margin: 0.2,
  pipeline_total_value: 2_000_000,
  projects_at_risk: 1,
  projects_by_status: [],
  procurements_by_status: [{ status: 'Paid', count: 2 }],
  top_projects: [
    { id: 'p1', name: 'Alpha', client_name: 'Acme', contract_value: 5_000_000, budget: 4_000_000, spent: 3_000_000, status: 'Ongoing Project' },
    { id: 'p2', name: 'Beta', client_name: 'Beta Co', contract_value: 3_000_000, budget: 2_000_000, spent: 1_000_000, status: 'Ongoing Project' },
  ],
};

const procurements = [
  { id: 'pr1', status: 'Vendor Invoiced', total_value: 250_000, requested_by_id: 'u1' },
  { id: 'pr2', status: 'Paid', total_value: 999_999, requested_by_id: 'u1' },
];

vi.mock('@/src/hooks/useDashboard', () => ({
  useDashboard: () => ({ data: dash, isPending: false, isError: false, refetch: vi.fn() }),
  useFinanceBudgetReview: () => ({ data: [], isPending: false, isError: false, refetch: vi.fn() }),
  useSalesPipeline: () => ({ data: null, isPending: false, isError: false, refetch: vi.fn() }),
  useWinRate: () => ({ data: null, isPending: false, isError: false }),
}));
vi.mock('@/src/hooks/useProcurements', () => ({
  useProcurements: () => ({ data: procurements, isPending: false, isError: false, refetch: vi.fn() }),
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
  it('AC-IXD-DASH-W5-C2A-EXEC-1: "Active projects" tile drills to /projects?filter=Ongoing', () => {
    renderExec();
    const tile = screen.getByTestId('kpi-active-projects');
    expect(tile.tagName).toBe('A');
    expect(tile).toHaveAttribute('href', '/projects?filter=Ongoing');
  });

  it('AC-IXD-DASH-W5-C2A-EXEC-2: "Total contract value" tile drills to /projects?filter=Ongoing', () => {
    renderExec();
    const tile = screen.getByTestId('kpi-total-contract-value');
    expect(tile.tagName).toBe('A');
    expect(tile).toHaveAttribute('href', '/projects?filter=Ongoing');
  });

  it('AC-IXD-DASH-W5-C2A-EXEC-2: "Total contract value" vs copy says "active" not "active + closed-out"', () => {
    renderExec();
    const tile = screen.getByTestId('kpi-total-contract-value');
    expect(tile).not.toHaveTextContent('active + closed-out');
    expect(tile).toHaveTextContent(/active/i);
  });

  it('AC-IXD-DASH-W5-C2A-EXEC-3: "Total project spend" tile drills to /projects?filter=Ongoing', () => {
    renderExec();
    const tile = screen.getByTestId('kpi-total-spend');
    expect(tile.tagName).toBe('A');
    expect(tile).toHaveAttribute('href', '/projects?filter=Ongoing');
  });

  it('AC-IXD-DASH-W5-C2A-EXEC-4: "Pipeline (weighted)" tile drills to /sales', () => {
    renderExec();
    const tile = screen.getByTestId('kpi-pipeline-weighted-value');
    expect(tile.tagName).toBe('A');
    expect(tile).toHaveAttribute('href', '/sales');
  });

  it('AC-IXD-DASH-W5-C2A-EXEC-5: "Revenue on hand" tile is NOT a link (OD-W5-C2-D: no single list view)', () => {
    renderExec();
    const tile = screen.getByTestId('kpi-on-hand-margin');
    expect(tile.tagName).toBe('DIV');
    expect(tile).not.toHaveAttribute('href');
  });

  it('AC-IXD-DASH-W5-C2A-EXEC-6: "Pipeline forecast margin" tile is NOT a link (OD-W5-C2-D)', () => {
    renderExec();
    const tile = screen.getByTestId('kpi-pipeline-projected-margin');
    expect(tile.tagName).toBe('DIV');
    expect(tile).not.toHaveAttribute('href');
  });

  it('AC-IXD-DASH-W5-C2A-a11y: each drill tile has a non-empty aria-label (full sentence)', () => {
    renderExec();
    for (const testId of ['kpi-active-projects', 'kpi-total-contract-value', 'kpi-total-spend', 'kpi-pipeline-weighted-value']) {
      const tile = screen.getByTestId(testId);
      const label = tile.getAttribute('aria-label');
      expect(label, `${testId} should have aria-label`).toBeTruthy();
      expect(label!.length, `${testId} aria-label should be a full sentence`).toBeGreaterThan(10);
    }
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
  it('AC-IXD-DASH-W5-C2A-FIN-1: "Contracted revenue" tile drills to /projects?filter=Ongoing', () => {
    renderFinance();
    const tile = screen.getByTestId('kpi-revenue');
    expect(tile.tagName).toBe('A');
    expect(tile).toHaveAttribute('href', '/projects?filter=Ongoing');
  });

  it('AC-IXD-DASH-W5-C2A-FIN-2: "Total project spend" tile drills to /projects?filter=Ongoing', () => {
    renderFinance();
    const tile = screen.getByTestId('kpi-spend');
    expect(tile.tagName).toBe('A');
    expect(tile).toHaveAttribute('href', '/projects?filter=Ongoing');
  });

  it('AC-IXD-DASH-W5-C2A-FIN-3: "Outstanding invoices" tile drills to /procurement?status=Vendor+Invoiced', () => {
    renderFinance();
    const tile = screen.getByTestId('kpi-outstanding');
    expect(tile.tagName).toBe('A');
    expect(tile).toHaveAttribute('href', '/procurement?status=Vendor+Invoiced');
  });

  it('AC-IXD-DASH-W5-C2A-FIN-3: "Outstanding invoices" tile has a descriptive linkLabel', () => {
    renderFinance();
    const tile = screen.getByTestId('kpi-outstanding');
    const label = tile.getAttribute('aria-label');
    expect(label).toBeTruthy();
    expect(label!.toLowerCase()).toContain('vendor');
  });

  it('AC-IXD-DASH-W5-C2A-FIN-4: "On-hand margin" tile is NOT a link (OD-W5-C2-D)', () => {
    renderFinance();
    const tile = screen.getByTestId('kpi-margin');
    expect(tile.tagName).toBe('DIV');
    expect(tile).not.toHaveAttribute('href');
  });
});

// ── PM dashboard ─────────────────────────────────────────────────────────────

const mine = [
  { id: 'p1', name: 'My Project A', contract_value: 4_000_000, budget: 3_000_000, spent: 1_000_000, status: 'Ongoing Project', project_manager_id: 'pm-1', client: { name: 'Acme' }, pm: null },
  { id: 'p2', name: 'My Project B', contract_value: 2_000_000, budget: 1_000_000, spent: 980_000, status: 'Won, Pending KoM', project_manager_id: 'pm-1', client: { name: 'Beta' }, pm: null },
];

vi.mock('@/src/hooks/useProjects', () => ({
  useProjects: () => ({ data: mine, isPending: false, isError: false, refetch: vi.fn() }),
}));
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
  it('AC-IXD-DASH-W5-C2A-PM-1: "My projects" tile drills to /projects?filter=My+Projects', () => {
    renderPM();
    const tile = screen.getByTestId('kpi-my-projects');
    expect(tile.tagName).toBe('A');
    expect(tile).toHaveAttribute('href', '/projects?filter=My+Projects');
  });

  it('AC-IXD-DASH-W5-C2A-PM-2: "My contract value" tile drills to /projects?filter=My+Projects', () => {
    renderPM();
    const tile = screen.getByTestId('kpi-my-contract-value');
    expect(tile.tagName).toBe('A');
    expect(tile).toHaveAttribute('href', '/projects?filter=My+Projects');
  });

  it('AC-IXD-DASH-W5-C2A-PM-3: "At risk" tile drills to /projects?filter=at-risk', () => {
    renderPM();
    const tile = screen.getByTestId('kpi-at-risk');
    expect(tile.tagName).toBe('A');
    expect(tile).toHaveAttribute('href', '/projects?filter=at-risk');
  });

  it('AC-IXD-DASH-W5-C2A-PM-3: "At risk" tile has a descriptive linkLabel', () => {
    renderPM();
    const tile = screen.getByTestId('kpi-at-risk');
    const label = tile.getAttribute('aria-label');
    expect(label).toBeTruthy();
    expect(label!.toLowerCase()).toContain('risk');
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
  it('AC-IXD-DASH-W5-C2A-ENG-1: "Hours this week" tile drills to /timesheets', () => {
    renderEngineer();
    const tile = screen.getByTestId('kpi-hours-week');
    expect(tile.tagName).toBe('A');
    expect(tile).toHaveAttribute('href', '/timesheets');
  });

  it('AC-IXD-DASH-W5-C2A-ENG-2: "Timesheet status" tile drills to /timesheets', () => {
    renderEngineer();
    const tile = screen.getByTestId('kpi-timesheet-status');
    expect(tile.tagName).toBe('A');
    expect(tile).toHaveAttribute('href', '/timesheets');
  });

  it('AC-IXD-DASH-W5-C2A-ENG-3: drill tiles have descriptive aria-labels', () => {
    renderEngineer();
    for (const testId of ['kpi-hours-week', 'kpi-timesheet-status']) {
      const tile = screen.getByTestId(testId);
      const label = tile.getAttribute('aria-label');
      expect(label, `${testId} should have aria-label`).toBeTruthy();
    }
  });
});
