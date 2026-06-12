/**
 * AC-IXD-DASH-W5-C2C — Wave-5 PR-C: PM risk-sort, Projects list risk-sort + at-risk pill,
 * I3 budget-basis reason, Engineer "Log this week's hours" primary CTA.
 *
 * RED phase: all tests will fail until the implementation is shipped.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import React from 'react';

// ─── Shared mocks (hoisted so vi.mock factories can reference them) ─────────

const { projState, tsState, deliverySummaryState } = vi.hoisted(() => ({
  projState: {
    data: null as Array<Record<string, unknown>> | null,
    isPending: false,
    isError: false,
    refetch: vi.fn(),
  },
  tsState: {
    data: [] as Array<Record<string, unknown>>,
    isPending: false,
    isError: false,
    refetch: vi.fn(),
  },
  deliverySummaryState: {
    pl1: { deliveryPct: 25, committedSpend: 100_000, budget: 400_000 },
    pl2: { deliveryPct: 95, committedSpend: 475_000, budget: 500_000 },
    pl3: { deliveryPct: 50, committedSpend: 150_000, budget: 300_000 },
    pl4: { deliveryPct: 92, committedSpend: 555_000, budget: 600_000 },
  },
}));

vi.mock('@/src/hooks/useProjects', () => ({
  useProjects: () => projState,
  useClientCompanies: () => ({ data: [] }),
  useProjectManagers: () => ({ data: [] }),
  useProjectMutations: () => ({
    create: { mutateAsync: vi.fn(), isPending: false },
    update: { mutateAsync: vi.fn(), isPending: false },
    archive: { mutateAsync: vi.fn(), isPending: false },
  }),
}));
vi.mock('@/src/hooks/useTimesheetApproval', () => ({
  useTimesheetsAwaitingApproval: () => ({
    data: [], isPending: false, isError: false, refetch: vi.fn(),
  }),
}));
vi.mock('@/src/hooks/useProcurements', () => ({
  useProcurements: () => ({ data: [], isPending: false }),
}));
vi.mock('@/src/auth/impersonation', () => ({
  useEffectiveRole: () => ({ realRole: 'Project Manager', effectiveRole: 'Project Manager' }),
  ImpersonationProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock('@/src/auth/useAuth', () => ({
  useAuth: () => ({
    currentUser: { id: 'pm-1', org_id: 'org-1' },
    role: 'Project Manager',
  }),
}));
vi.mock('@/src/hooks/useMyTasks', () => ({
  useMyTasks: () => ({ data: [] }),
}));
vi.mock('@/src/hooks/useProjectView', () => ({
  useProjectView: () => ['table', vi.fn()] as ['table', () => void],
}));
vi.mock('@/src/hooks/useProjectsDelivery', () => ({
  useProjectsDelivery: () => ({ data: {} }),
  useProjectsDeliverySummary: () => ({ data: deliverySummaryState }),
}));
vi.mock('../../components/ProjectStatusControl', () => ({ default: () => null }));
vi.mock('@/src/hooks/useTimesheets', () => ({
  useTimesheets: () => tsState,
}));

// ─── Imports (after mocks) ──────────────────────────────────────────────────

import { PMDashboard } from '@/src/components/dashboard/PMDashboard';
import { EngineerDashboard } from '@/src/components/dashboard/EngineerDashboard';
import Projects from '../Projects';
import { ImpersonationProvider } from '@/src/auth/impersonation';
import { ToastProvider } from '@/src/components/ui';

// ─── PM fixture data ─────────────────────────────────────────────────────────

/**
 * PM fixture — designed to test risk-sort ordering:
 *  p1 SAFE:      spent=100k, budget=1000k → 10%  — comes AFTER at-risk
 *  p2 AT-RISK:   spent=950k, budget=1000k → 95% — comes BEFORE safe
 *  p3 AT-RISK:   spent=900k, budget=1000k → 90% — comes BEFORE safe (exactly at threshold)
 *  p4 NOT-ACTIVE: Close Out with high burn — never flagged
 */
const pmFixtures = [
  {
    id: 'p1', name: 'Safe Project', contract_value: 2_000_000,
    budget: 1_000_000, spent: 100_000, status: 'Ongoing Project',
    project_manager_id: 'pm-1', client: { name: 'Alpha' }, pm: null,
  },
  {
    id: 'p2', name: 'High Burn Project', contract_value: 1_500_000,
    budget: 1_000_000, spent: 950_000, status: 'Ongoing Project',
    project_manager_id: 'pm-1', client: { name: 'Beta' }, pm: null,
  },
  {
    id: 'p3', name: 'At Threshold Project', contract_value: 1_200_000,
    budget: 1_000_000, spent: 900_000, status: 'Ongoing Project',
    project_manager_id: 'pm-1', client: { name: 'Gamma' }, pm: null,
  },
  {
    id: 'p4', name: 'Completed High Burn', contract_value: 800_000,
    budget: 500_000, spent: 490_000, status: 'Close Out',
    project_manager_id: 'pm-1', client: null, pm: null,
  },
];
const otherUser = {
  id: 'p9', name: 'Other PM Project', contract_value: 500_000,
  budget: 300_000, spent: 0, status: 'Ongoing Project',
  project_manager_id: 'pm-other', client: null, pm: null,
};

// ─── PMDashboard: risk-sort tests ───────────────────────────────────────────

describe('AC-IXD-DASH-W5-C2C — PMDashboard: Project Status list is risk-sorted', () => {
  beforeEach(() => {
    projState.data = [...pmFixtures, otherUser];
    projState.isPending = false;
    projState.isError = false;
  });

  it('C2C-PM-1: at-risk rows appear before safe rows in the Project Status list', () => {
    render(<MemoryRouter><PMDashboard /></MemoryRouter>);
    const listItems = screen.getAllByRole('listitem');
    const itemTexts = listItems.map((li) => li.textContent ?? '');
    const highBurnIdx = itemTexts.findIndex((t) => t.includes('High Burn Project'));
    const thresholdIdx = itemTexts.findIndex((t) => t.includes('At Threshold Project'));
    const safeIdx = itemTexts.findIndex((t) => t.includes('Safe Project'));

    expect(highBurnIdx).toBeGreaterThanOrEqual(0);
    expect(thresholdIdx).toBeGreaterThanOrEqual(0);
    expect(safeIdx).toBeGreaterThanOrEqual(0);
    // Both at-risk projects must come BEFORE the safe project
    expect(highBurnIdx).toBeLessThan(safeIdx);
    expect(thresholdIdx).toBeLessThan(safeIdx);
  });

  it('C2C-PM-2: at-risk active rows show the "At risk" StatusPill (text+dot, not color-only)', () => {
    render(<MemoryRouter><PMDashboard /></MemoryRouter>);
    // p2 (95%) and p3 (90%) are active + at-risk → 2 pills
    const atRiskPills = screen.getAllByText('At risk');
    expect(atRiskPills.length).toBeGreaterThanOrEqual(2);
  });

  it('C2C-PM-3: safe project does NOT show an "At risk" pill', () => {
    render(<MemoryRouter><PMDashboard /></MemoryRouter>);
    const listItems = screen.getAllByRole('listitem');
    const safeItem = listItems.find((li) => li.textContent?.includes('Safe Project'));
    expect(safeItem).toBeDefined();
    expect(safeItem?.textContent).not.toContain('At risk');
  });

  it('C2C-PM-4: completed project is NOT flagged at-risk even when high utilization', () => {
    render(<MemoryRouter><PMDashboard /></MemoryRouter>);
    const listItems = screen.getAllByRole('listitem');
    const completedItem = listItems.find((li) => li.textContent?.includes('Completed High Burn'));
    if (completedItem) {
      expect(completedItem.textContent).not.toContain('At risk');
    }
  });

  it('C2C-PM-5: the "At risk" pill in the Project Status list has the dot indicator (not color-only, a11y)', () => {
    render(<MemoryRouter><PMDashboard /></MemoryRouter>);
    // The StatusPill "At risk" in the list items — find via listitem context to skip the KPI tile
    const listItems = screen.getAllByRole('listitem');
    const atRiskItem = listItems.find((li) => li.textContent?.includes('High Burn Project'));
    expect(atRiskItem).toBeDefined();
    // The "At risk" StatusPill inside this row must carry data-pill-dot (dot indicator)
    const pillDot = atRiskItem?.querySelector('[data-pill-dot]');
    expect(pillDot).toBeTruthy();
  });
});

// ─── Projects list page fixtures ────────────────────────────────────────────

const projectListFixtures = [
  {
    id: 'pl1', name: 'Steady Alpha', code: 'A-001', status: 'Ongoing Project',
    project_manager_id: 'pm-1', client_id: 'c1',
    contract_value: 500_000, budget: 400_000, spent: 100_000, // 25% budget — SAFE
    customer_contract_ref: null,
    client: { id: 'c1', name: 'Acme' }, pm: { id: 'pm-1', full_name: 'Alice PM' },
  },
  {
    id: 'pl2', name: 'Burning Beta', code: 'B-002', status: 'Ongoing Project',
    project_manager_id: 'pm-1', client_id: 'c1',
    contract_value: 800_000, budget: 500_000, spent: 475_000, // 95% budget — AT RISK
    customer_contract_ref: null,
    client: { id: 'c1', name: 'Acme' }, pm: { id: 'pm-1', full_name: 'Alice PM' },
  },
  {
    id: 'pl3', name: 'Gamma Gate', code: 'G-003', status: 'Ongoing Project',
    project_manager_id: 'pm-1', client_id: 'c1',
    contract_value: 600_000, budget: 300_000, spent: 150_000, // 50% budget — SAFE
    customer_contract_ref: null,
    client: { id: 'c1', name: 'Acme' }, pm: { id: 'pm-1', full_name: 'Alice PM' },
  },
  {
    id: 'pl4', name: 'Delta Deep', code: 'D-004', status: 'Ongoing Project',
    project_manager_id: 'pm-1', client_id: 'c1',
    contract_value: 700_000, budget: 600_000, spent: 555_000, // ~92.5% budget — AT RISK
    customer_contract_ref: null,
    client: { id: 'c1', name: 'Acme' }, pm: { id: 'pm-1', full_name: 'Alice PM' },
  },
];

const renderProjectsPage = (url = '/projects') =>
  render(
    <ImpersonationProvider realRole="Project Manager">
      <MemoryRouter initialEntries={[url]}>
        <ToastProvider>
          <Projects />
        </ToastProvider>
      </MemoryRouter>
    </ImpersonationProvider>,
  );

// ─── Projects list: risk-sort tests ─────────────────────────────────────────

describe('AC-IXD-DASH-W5-C2C — Projects list: at-risk rows sort to top in All view', () => {
  beforeEach(() => {
    projState.data = projectListFixtures;
    projState.isPending = false;
    projState.isError = false;
  });

  it('C2C-LIST-1: at-risk rows appear before safe rows in the "All" view', () => {
    renderProjectsPage('/projects');
    const rows = screen.getAllByRole('row');
    const rowTexts = rows.map((r) => r.textContent ?? '');
    const burningBetaIdx = rowTexts.findIndex((t) => t.includes('Burning Beta'));
    const deltaDeepIdx = rowTexts.findIndex((t) => t.includes('Delta Deep'));
    const steadyAlphaIdx = rowTexts.findIndex((t) => t.includes('Steady Alpha'));
    const gammaGateIdx = rowTexts.findIndex((t) => t.includes('Gamma Gate'));

    // Row index 0 is the header row, so data rows start from 1
    expect(burningBetaIdx).toBeGreaterThan(0);
    expect(deltaDeepIdx).toBeGreaterThan(0);
    expect(steadyAlphaIdx).toBeGreaterThan(0);
    expect(gammaGateIdx).toBeGreaterThan(0);
    // Both at-risk projects come before both safe projects
    expect(burningBetaIdx).toBeLessThan(steadyAlphaIdx);
    expect(deltaDeepIdx).toBeLessThan(steadyAlphaIdx);
    expect(burningBetaIdx).toBeLessThan(gammaGateIdx);
    expect(deltaDeepIdx).toBeLessThan(gammaGateIdx);
  });

  it('C2C-LIST-2: at-risk rows in the project cell show the "At risk" StatusPill', () => {
    renderProjectsPage('/projects');
    const atRiskPills = screen.getAllByText('At risk');
    // Burning Beta (95%) + Delta Deep (92.5%) → 2 pills
    expect(atRiskPills.length).toBeGreaterThanOrEqual(2);
  });

  it('C2C-LIST-3: safe rows do NOT show the "At risk" pill', () => {
    renderProjectsPage('/projects');
    const rows = screen.getAllByRole('row');
    const steadyRow = rows.find((r) => r.textContent?.includes('Steady Alpha'));
    expect(steadyRow).toBeDefined();
    expect(steadyRow?.textContent).not.toContain('At risk');
  });
});

// ─── I3: budget-basis reason visible on at-risk rows ───────────────────────

describe('AC-IXD-DASH-W5-C2C — I3: at-risk rows convey budget utilization reason', () => {
  beforeEach(() => {
    projState.data = projectListFixtures;
    projState.isPending = false;
    projState.isError = false;
  });

  it('C2C-I3-1: at-risk row shows budget utilization % in the Budget used column', () => {
    renderProjectsPage('/projects');
    const rows = screen.getAllByRole('row');
    const atRiskRow = rows.find((r) => r.textContent?.includes('Burning Beta'));
    expect(atRiskRow).toBeDefined();
    const cells = within(atRiskRow!).getAllByRole('cell');
    const budgetUsedCell = cells[cells.length - 2];
    expect(budgetUsedCell).toHaveTextContent('95%');
    expect(budgetUsedCell).toHaveTextContent('$475.0K of $500.0K budget');
  });

  it('C2C-I3-2: the at-risk pill in the project cell is text+dot (not color-only) — a11y', () => {
    renderProjectsPage('/projects');
    // Find the at-risk row and verify the pill within it has a dot indicator
    const rows = screen.getAllByRole('row');
    const atRiskRow = rows.find((r) => r.textContent?.includes('Burning Beta'));
    expect(atRiskRow).toBeDefined();
    const pillDot = atRiskRow?.querySelector('[data-pill-dot]');
    expect(pillDot).toBeTruthy();
  });
});

// ─── Engineer CTA tests ─────────────────────────────────────────────────────

describe('AC-IXD-DASH-W5-C2C — D4: Engineer dashboard "Log this week\'s hours" primary CTA', () => {
  beforeEach(() => {
    tsState.data = [];
    tsState.isPending = false;
    tsState.isError = false;
  });

  it('D4-1: renders a "Log this week\'s hours" primary button/link (data-testid="cta-log-hours")', () => {
    render(<MemoryRouter><EngineerDashboard /></MemoryRouter>);
    // The dedicated primary CTA is identified by its testId — distinct from KPI tile linkLabels
    const cta = screen.getByTestId('cta-log-hours');
    expect(cta).toBeInTheDocument();
    expect(cta.textContent).toMatch(/log this week.?s hours/i);
  });

  it('D4-2: the CTA routes to /timesheets', () => {
    render(<MemoryRouter><EngineerDashboard /></MemoryRouter>);
    const cta = screen.getByTestId('cta-log-hours');
    expect(cta).toHaveAttribute('href', '/timesheets');
  });

  it('D4-3: the CTA carries primary styling (bg-primary)', () => {
    render(<MemoryRouter><EngineerDashboard /></MemoryRouter>);
    const cta = screen.getByTestId('cta-log-hours');
    expect(cta.className).toMatch(/bg-primary/);
  });

  it('D4-4: only ONE primary CTA (data-testid="cta-log-hours") exists per render', () => {
    render(<MemoryRouter><EngineerDashboard /></MemoryRouter>);
    expect(screen.getAllByTestId('cta-log-hours').length).toBe(1);
  });

  it('D4-5: CTA renders while data is loading (not gated on data)', () => {
    tsState.isPending = true;
    render(<MemoryRouter><EngineerDashboard /></MemoryRouter>);
    expect(screen.getByTestId('cta-log-hours')).toBeInTheDocument();
  });

  it('D4-6: CTA renders in error state (not gated on data)', () => {
    tsState.isError = true;
    render(<MemoryRouter><EngineerDashboard /></MemoryRouter>);
    expect(screen.getByTestId('cta-log-hours')).toBeInTheDocument();
  });
});
