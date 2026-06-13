/**
 * AC-IXD-DASH-W5-C2A — Projects page at-risk filter + URL param read-on-mount
 *
 * Tests:
 * 1. ?filter=at-risk on mount sets the at-risk filter (shows spent/budget >= 0.9 actives only)
 * 2. Honest empty state when no projects are at risk
 * 3. Backward-compatible: no param => default behavior unchanged
 * 4. ?filter=Ongoing sets Ongoing tab
 * 5. ?filter=My+Projects sets My Projects tab
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import React from 'react';
import { ImpersonationProvider } from '@/src/auth/impersonation';
import { ToastProvider } from '@/src/components/ui';
import type { Role } from '@/src/auth/AuthContext';

const { projectsState, myTasksState, deliverySummaryState } = vi.hoisted(() => ({
  projectsState: {
    data: null as Array<Record<string, unknown>> | null,
    isPending: false,
    isError: false,
    refetch: vi.fn(),
  },
  myTasksState: { data: [] as Array<Record<string, unknown>> },
  deliverySummaryState: {
    data: {} as Record<string, { deliveryPct: number | null; committedSpend: number; budget: number }>,
    isPending: false,
  },
}));

vi.mock('../../components/ProjectStatusControl', () => ({
  default: () => null,
}));

vi.mock('@/src/hooks/useProjects', () => ({
  useProjects: () => projectsState,
  useClientCompanies: () => ({ data: [] }),
  useProjectManagers: () => ({ data: [] }),
  useProjectsMilestoneDates: () => ({ data: [], isPending: false }),
  useProjectMutations: () => ({
    create: { mutateAsync: vi.fn(), isPending: false },
    update: { mutateAsync: vi.fn(), isPending: false },
    archive: { mutateAsync: vi.fn(), isPending: false },
  }),
}));

vi.mock('@/src/hooks/useProjectView', () => ({
  useProjectView: () => ['table', vi.fn()] as ['table', () => void],
}));

vi.mock('@/src/hooks/useMyTasks', () => ({
  useMyTasks: () => myTasksState,
}));
vi.mock('@/src/hooks/useProjectsDelivery', () => ({
  useProjectsDelivery: () => ({ data: {} }),
  useProjectsDeliverySummary: () => deliverySummaryState,
}));

vi.mock('@/src/auth/useAuth', () => ({
  useAuth: () => ({ currentUser: { id: 'pm-1', org_id: 'org-1' }, role: 'Project Manager' }),
}));

import Projects from '../Projects';

// Projects that test the at-risk threshold (0.9 of budget)
const fixtures = [
  {
    id: 'p1',
    name: 'Safe Project',
    code: 'P-001',
    status: 'Ongoing Project',
    project_manager_id: 'pm-1',
    client_id: 'c1',
    contract_value: 100_000,
    budget: 80_000,
    spent: 40_000,   // 50% of budget — NOT at risk
    customer_contract_ref: null,
    client: { id: 'c1', name: 'Acme' },
    pm: { id: 'pm-1', full_name: 'Alice PM' },
  },
  {
    id: 'p2',
    name: 'At Risk Project',
    code: 'P-002',
    status: 'Ongoing Project',
    project_manager_id: 'pm-1',
    client_id: 'c1',
    contract_value: 200_000,
    budget: 100_000,
    spent: 95_000,   // 95% of budget — AT RISK
    customer_contract_ref: null,
    client: { id: 'c1', name: 'Acme' },
    pm: { id: 'pm-1', full_name: 'Alice PM' },
  },
  {
    id: 'p3',
    name: 'Exactly At Threshold',
    code: 'P-003',
    status: 'Ongoing Project',
    project_manager_id: 'pm-1',
    client_id: 'c1',
    contract_value: 150_000,
    budget: 100_000,
    spent: 90_000,   // exactly 90% of budget — AT RISK (>= 0.9)
    customer_contract_ref: null,
    client: { id: 'c1', name: 'Acme' },
    pm: { id: 'pm-1', full_name: 'Alice PM' },
  },
  {
    id: 'p4',
    name: 'Completed Not At Risk',
    code: 'P-004',
    status: 'Close Out',  // completed — NOT shown in at-risk (active only)
    project_manager_id: 'pm-1',
    client_id: 'c1',
    contract_value: 100_000,
    budget: 50_000,
    spent: 49_000,   // 98% but not active
    customer_contract_ref: null,
    client: { id: 'c1', name: 'Acme' },
    pm: { id: 'pm-1', full_name: 'Alice PM' },
  },
];

const renderWithUrl = (url: string, role: Role = 'Project Manager') =>
  render(
    <ImpersonationProvider realRole={role}>
      <MemoryRouter initialEntries={[url]}>
        <ToastProvider>
          <Projects />
        </ToastProvider>
      </MemoryRouter>
    </ImpersonationProvider>,
  );

beforeEach(() => {
  projectsState.data = fixtures;
  projectsState.isPending = false;
  projectsState.isError = false;
  myTasksState.data = [];
  // I6: committed-spend-based at-risk summary data.
  // p1: committedSpend=40K/budget=80K = 50% → safe
  // p2: committedSpend=95K/budget=100K = 95% → at risk
  // p3: committedSpend=90K/budget=100K = 90% → at risk
  // p4: completed (not active regardless of spend)
  deliverySummaryState.data = {
    p1: { deliveryPct: null, committedSpend: 40_000, budget: 80_000 },
    p2: { deliveryPct: null, committedSpend: 95_000, budget: 100_000 },
    p3: { deliveryPct: null, committedSpend: 90_000, budget: 100_000 },
    p4: { deliveryPct: null, committedSpend: 49_000, budget: 50_000 },
  };
  deliverySummaryState.isPending = false;
});

describe('Projects page — at-risk URL param (AC-IXD-DASH-W5-C2A)', () => {
  it('AC-IXD-DASH-W5-C2A-PROJ-1: ?filter=at-risk selects the at-risk tab on mount', () => {
    renderWithUrl('/projects?filter=at-risk');
    const tab = screen.getByRole('tab', { name: /at.?risk/i });
    expect(tab).toHaveAttribute('aria-selected', 'true');
  });

  it('AC-IXD-DASH-W5-C2A-PROJ-2 I6: at-risk filter uses committed-spend, not stale p.spent', () => {
    renderWithUrl('/projects?filter=at-risk');
    // At risk: p2 (committedSpend/budget = 95%) and p3 (90%) — both active
    expect(screen.getByText('At Risk Project')).toBeInTheDocument();
    expect(screen.getByText('Exactly At Threshold')).toBeInTheDocument();
    // Not at risk: p1 (committedSpend/budget = 50%) — excluded
    expect(screen.queryByText('Safe Project')).not.toBeInTheDocument();
    // Completed even though high committed-spend: p4 excluded (not active)
    expect(screen.queryByText('Completed Not At Risk')).not.toBeInTheDocument();
  });

  it('AC-IXD-DASH-W5-C2A-PROJ-3: honest empty state when no projects are at risk', () => {
    // All projects safe
    projectsState.data = [fixtures[0]]; // only safe project
    renderWithUrl('/projects?filter=at-risk');
    expect(screen.getByText(/Nothing at risk/i)).toBeInTheDocument();
    expect(screen.getByText(/every active project is under 90%/i)).toBeInTheDocument();
  });

  it('AC-IXD-DASH-W5-C2A-PROJ-4: backward-compatible — no param keeps default (All for PM)', () => {
    renderWithUrl('/projects');
    const allTab = screen.getByRole('tab', { name: /^all$/i });
    expect(allTab).toHaveAttribute('aria-selected', 'true');
  });

  it('AC-IXD-DASH-W5-C2A-PROJ-5: ?filter=Ongoing sets Ongoing tab on mount', () => {
    renderWithUrl('/projects?filter=Ongoing');
    const tab = screen.getByRole('tab', { name: /^ongoing$/i });
    expect(tab).toHaveAttribute('aria-selected', 'true');
  });

  it('AC-IXD-DASH-W5-C2A-PROJ-6: ?filter=My+Projects sets My Projects tab on mount', () => {
    renderWithUrl('/projects?filter=My+Projects');
    const tab = screen.getByRole('tab', { name: /^my projects$/i });
    expect(tab).toHaveAttribute('aria-selected', 'true');
  });
});
