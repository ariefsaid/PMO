/**
 * AC-IXD-PROJ-W5-C3-A — Default-tab wiring (OD-W5-C3-A).
 *
 * Delivery-forward roles (Engineer) open /projects/:id (no tab param) on the Tasks tab — the
 * surface they actually use. Finance-forward roles (Admin, Executive, Finance, Project Manager)
 * default to Overview. An explicit :tab URL param (deep-link) always wins for every role.
 *
 * Owning layer: Vitest/RTL — pure FE logic, no DB required.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import React from 'react';
import { ImpersonationProvider } from '@/src/auth/impersonation';
import { ToastProvider } from '@/src/components/ui';
import type { Role } from '@/src/auth/AuthContext';

// ── Shared project fixture (on-hand, delivery stage) ──────────────────────────

const projData = [
  {
    id: 'p1',
    name: 'Test Project',
    status: 'Ongoing Project',
    budget: 100_000,
    spent: 0,
    archived_at: null,
    created_at: '',
    last_update: '',
    org_id: 'o1',
    contract_value: 200_000,
    win_probability: 1,
    stage_id: null,
    code: null,
    customer_contract_ref: null,
    client: null,
    client_id: null,
    project_manager_id: null,
    pm: null,
  },
];

// ── Module mocks ──────────────────────────────────────────────────────────────

vi.mock('@/src/hooks/useProjects', () => ({
  useProjects: () => ({ data: projData, isPending: false }),
  useClientCompanies: () => ({ data: [] }),
  useProjectManagers: () => ({ data: [] }),
  useProjectMutations: () => ({
    create: { mutateAsync: vi.fn(), isPending: false },
    updateHeader: { mutateAsync: vi.fn(), isPending: false },
    archive: { mutateAsync: vi.fn(), isPending: false },
    remove: { mutateAsync: vi.fn(), isPending: false },
    setContractValue: { mutateAsync: vi.fn(), isPending: false },
  }),
}));
vi.mock('@/src/lib/db/opportunity', () => ({
  useOpportunity: () => ({ data: undefined, isPending: false }),
}));

// Stub tab contents — we only test which tab is active, not what's inside them.
vi.mock('../tabs/OverviewTab', () => ({ default: () => <div data-testid="tab-overview">Overview</div> }));
vi.mock('../tabs/BudgetTab', () => ({ default: () => <div data-testid="tab-budget">Budget</div> }));
vi.mock('../tabs/ProcurementTab', () => ({ default: () => <div data-testid="tab-procurement">Procurement</div> }));
vi.mock('../tabs/TasksTab', () => ({ default: () => <div data-testid="tab-tasks">Tasks</div> }));
vi.mock('../tabs/DocumentsTab', () => ({ default: () => <div data-testid="tab-documents">Documents</div> }));
vi.mock('../PipelineLens', () => ({ default: () => <div>Pipeline</div> }));
vi.mock('@/src/hooks/useMilestones', () => ({
  useMilestones: () => ({ data: [], isPending: false, isError: false, refetch: vi.fn() }),
  useMilestoneMutations: () => ({
    create: { mutateAsync: vi.fn(), isPending: false },
    update: { mutateAsync: vi.fn(), isPending: false },
    remove: { mutateAsync: vi.fn(), isPending: false },
    setTaskMilestone: { mutateAsync: vi.fn(), isPending: false },
  }),
}));
vi.mock('@/src/hooks/useProcurements', () => ({
  useProjectCommittedSpend: () => ({ data: 0, isPending: false, isError: false, refetch: vi.fn() }),
  useProcurements: () => ({ data: [], isPending: false, isError: false, refetch: vi.fn() }),
}));

// Stub ProjectDetailHeader — its own mutation/auth setup is tested separately.
vi.mock('../ProjectDetailHeader', () => ({
  default: () => <div data-testid="stubbed-header">Header</div>,
  // Re-export the real predicate so ProjectDetail.tsx's import of hasFinanceView keeps working.
  hasFinanceView: (role: Role | null): boolean => {
    if (!role) return false;
    return (['Admin', 'Executive', 'Finance', 'Project Manager'] as Role[]).includes(role);
  },
}));

// ── Render helper ─────────────────────────────────────────────────────────────

import ProjectDetail from '../ProjectDetail';

const renderAs = (realRole: Role, path: string) =>
  render(
    <ImpersonationProvider realRole={realRole}>
      <ToastProvider>
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            <Route path="/projects/:projectId/:tab" element={<ProjectDetail />} />
            <Route path="/projects/:projectId" element={<ProjectDetail />} />
          </Routes>
        </MemoryRouter>
      </ToastProvider>
    </ImpersonationProvider>,
  );

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('AC-IXD-PROJ-W5-C3-A: role-adaptive default tab (OD-W5-C3-A)', () => {
  // ── Engineer defaults to Tasks (the delivery-forward role's primary surface) ──

  it('AC-IXD-PROJ-W5-C3-A-01: Engineer opening /projects/:id (no tab) lands on the Tasks tab', () => {
    renderAs('Engineer', '/projects/p1');
    expect(screen.getByTestId('tab-tasks')).toBeInTheDocument();
    expect(screen.queryByTestId('tab-overview')).not.toBeInTheDocument();
  });

  it('AC-IXD-PROJ-W5-C3-A-02: the Tasks tab item is aria-selected=true for Engineer (no tab param)', () => {
    renderAs('Engineer', '/projects/p1');
    const tablist = screen.getByRole('tablist', { name: /project sections/i });
    const tasksTab = Array.from(tablist.querySelectorAll('[role="tab"]')).find(
      (t) => t.textContent === 'Tasks',
    );
    expect(tasksTab).not.toBeUndefined();
    expect(tasksTab!.getAttribute('aria-selected')).toBe('true');
  });

  // ── Finance-forward roles default to Overview ──────────────────────────────

  it('AC-IXD-PROJ-W5-C3-A-03: Project Manager opening /projects/:id (no tab) lands on Overview', () => {
    renderAs('Project Manager', '/projects/p1');
    expect(screen.getByTestId('tab-overview')).toBeInTheDocument();
    expect(screen.queryByTestId('tab-tasks')).not.toBeInTheDocument();
  });

  it('AC-IXD-PROJ-W5-C3-A-04: Executive opening /projects/:id (no tab) lands on Overview', () => {
    renderAs('Executive', '/projects/p1');
    expect(screen.getByTestId('tab-overview')).toBeInTheDocument();
    expect(screen.queryByTestId('tab-tasks')).not.toBeInTheDocument();
  });

  it('AC-IXD-PROJ-W5-C3-A-05: Finance opening /projects/:id (no tab) lands on Overview', () => {
    renderAs('Finance', '/projects/p1');
    expect(screen.getByTestId('tab-overview')).toBeInTheDocument();
    expect(screen.queryByTestId('tab-tasks')).not.toBeInTheDocument();
  });

  it('AC-IXD-PROJ-W5-C3-A-06: Admin opening /projects/:id (no tab) lands on Overview', () => {
    renderAs('Admin', '/projects/p1');
    expect(screen.getByTestId('tab-overview')).toBeInTheDocument();
    expect(screen.queryByTestId('tab-tasks')).not.toBeInTheDocument();
  });

  // ── Deep-link always wins regardless of role ──────────────────────────────

  it('AC-IXD-PROJ-W5-C3-A-07: Engineer with explicit /projects/:id/budget deep-link opens Budget (deep-link wins over role default)', () => {
    renderAs('Engineer', '/projects/p1/budget');
    expect(screen.getByTestId('tab-budget')).toBeInTheDocument();
    expect(screen.queryByTestId('tab-tasks')).not.toBeInTheDocument();
    expect(screen.queryByTestId('tab-overview')).not.toBeInTheDocument();
  });

  it('AC-IXD-PROJ-W5-C3-A-08: Project Manager with explicit /projects/:id/tasks deep-link opens Tasks', () => {
    renderAs('Project Manager', '/projects/p1/tasks');
    expect(screen.getByTestId('tab-tasks')).toBeInTheDocument();
    expect(screen.queryByTestId('tab-overview')).not.toBeInTheDocument();
  });

  it('AC-IXD-PROJ-W5-C3-A-09: Engineer with explicit /projects/:id/overview deep-link opens Overview', () => {
    renderAs('Engineer', '/projects/p1/overview');
    expect(screen.getByTestId('tab-overview')).toBeInTheDocument();
    expect(screen.queryByTestId('tab-tasks')).not.toBeInTheDocument();
  });

  it('AC-IXD-PROJ-W5-C3-A-10: Finance with explicit /projects/:id/procurement deep-link opens Procurement', () => {
    renderAs('Finance', '/projects/p1/procurement');
    expect(screen.getByTestId('tab-procurement')).toBeInTheDocument();
    expect(screen.queryByTestId('tab-overview')).not.toBeInTheDocument();
  });
});
