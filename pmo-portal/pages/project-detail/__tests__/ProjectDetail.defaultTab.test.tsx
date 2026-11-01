/**
 * AC-IXD-PROJ-W5-C3-A — Default-tab wiring.
 *
 * CW-7 (coherence wave §3, supersedes OD-W5-C3-A's role-adaptive default): `/projects/:id` (no tab
 * param) ALWAYS defaults to **Overview** for EVERY role — the URL is role-invariant (a role-variant
 * default was a wayfinding bug). The Engineer's task entry points deep-link to `/projects/:id/tasks`
 * explicitly (see MyTasks) rather than mutating the default. An explicit :tab URL param (deep-link)
 * always wins for every role.
 *
 * Owning layer: Vitest/RTL — pure FE logic, no DB required.
 */
import { describe, it, expect, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import { renderWithQueryClient as render } from '@/test/renderWithQueryClient';
import { MemoryRouter, Route, Routes } from 'react-router';
import React from 'react';
import { ImpersonationProvider } from '@/src/auth/impersonation';
import { ToastProvider } from '@/src/components/ui';
import type { Role } from '@/src/auth/AuthContext';
vi.mock('@/pages/project-detail/ProjectFinancesSection', () => ({ ProjectFinancesSection: () => null }));

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
    currency: 'USD',
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
  // #840: the detail route reads ONE project by id (any stage), never the whole list.
  useProject: (id: string) => {
    const l = (({ data: projData, isPending: false })) as { data?: { id: string }[] | null; isPending?: boolean; isError?: boolean; refetch?: () => void };
    return { isPending: false, isError: false, refetch: vi.fn(), ...l, data: (l.data ?? []).find((p) => p.id === id) ?? null };
  },
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
vi.mock('@/src/hooks/useProjectTransitions', () => ({
  useProjectTransition: () => ({
    mutate: vi.fn(),
    mutateAsync: vi.fn(),
    isError: false,
    error: null,
    isPending: false,
  }),
}));

// Stub tab contents — we only test which tab is active, not what's inside them.
vi.mock('../tabs/BudgetTab', () => ({ default: () => <div data-testid="tab-budget">Budget</div> }));
vi.mock('../tabs/ProcurementTab', () => ({ default: () => <div data-testid="tab-procurement">Procurement</div> }));
vi.mock('../tabs/TasksTab', () => ({ default: () => <div data-testid="tab-tasks">Tasks</div> }));
vi.mock('../tabs/DocumentsTab', () => ({ default: () => <div data-testid="tab-documents">Documents</div> }));
vi.mock('../PipelineLens', () => ({ default: () => <div>Pipeline</div> }));
// ProjectSCurve now reads useTasks (s-curve actual line, ADR-0032) — it renders inside
// ProjectDetail (the demote/lever lens) even though the tabs are stubbed, so mock the hook
// to avoid the real useAuth dependency in this tab-selection test.
vi.mock('@/src/hooks/useTasks', () => ({
  useTasks: () => ({ data: [], isPending: false, isError: false, refetch: vi.fn() }),
}));
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
  useProjectProcurements: () => ({ data: [], isPending: false, isError: false, refetch: vi.fn() }),
}));
vi.mock('@/src/hooks/useProjectFinances', () => ({
  useProjectFinances: () => ({ data: null, isPending: false, isError: false, refetch: vi.fn() }),
}));
vi.mock('../useProjectPosition', () => ({
  useProjectAttention: () => ({ items: [], isPending: false }),
  useOverdueReceivables: () => ({ data: null, isPending: false, isError: false, refetch: vi.fn() }),
}));
vi.mock('../ProjectAttention', () => ({ ProjectAttention: () => null }));
vi.mock('../ProjectBlocks', () => ({ CostBlock: () => null, DeliveryBlock: () => null, MoneyBlock: () => null }));
vi.mock('../ProjectActivity', () => ({ ActivityFooter: () => null, MyOpenTasks: () => null, ProjectActivity: () => null }));
vi.mock('../ProjectDrawdown', () => ({ default: () => null }));
vi.mock('../ProjectSCurve', () => ({ default: () => null }));
vi.mock('@/src/hooks/useRevenue', () => ({
  useSalesInvoices: () => ({ data: [], isPending: false, isError: false, refetch: vi.fn() }),
}));
vi.mock('@/src/hooks/useFxOrgDay', () => ({
  useFxOrgDay: () => ({ day: '2026-10-27', isPending: false, isError: false, retry: vi.fn() }),
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

vi.mock('@/src/components/comments/CommentsSection', () => ({ CommentsSection: () => null }));
// ProjectErpLink reads the org's ERP binding through react-query; it has its own test (AC-SETUP-001).
vi.mock('@/pages/project-detail/ProjectErpLink', () => ({ ProjectErpLink: () => null }));

const renderAs = async (realRole: Role, path: string) => {
  const view = render(
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
  await waitFor(() => expect(screen.queryByTestId('project-detail-panel-loading')).not.toBeInTheDocument());
  return view;
};

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('AC-IXD-PROJ-W5-C3-A: role-invariant default tab (CW-7, supersedes OD-W5-C3-A)', () => {
  // ── CW-7: Engineer now ALSO defaults to Overview — the URL is role-invariant ──

  it('CW-7 (was AC-IXD-PROJ-W5-C3-A-01): Engineer opening /projects/:id (no tab) lands on Overview, not Tasks', async () => {
    await renderAs('Engineer', '/projects/p1');
    expect(screen.getByRole('tab', { name: 'Overview', selected: true })).toBeInTheDocument();
    expect(screen.getByRole('tabpanel')).toHaveAttribute('id', 'project-detail-tabpanel-overview');
  });

  it('CW-7 (was AC-IXD-PROJ-W5-C3-A-02): the Overview tab item is aria-selected=true for Engineer (no tab param)', async () => {
    await renderAs('Engineer', '/projects/p1');
    const tablist = screen.getByRole('tablist', { name: /project sections/i });
    expect(within(tablist).getByRole('tab', { name: 'Overview' })).toHaveAttribute('aria-selected', 'true');
  });

  // Materials joins the Engineer's set: quantities are visible to all active members and the Engineer is
  // the interim storekeeper (inventory spec OQ-STK-10 / OQ-STK-2, AC-STK-031; plan S3.9, PQ-8).
  it('AC-PB-008: Engineer sees only Overview, Procurement, Tasks, Documents and Materials tabs', async () => {
    await renderAs('Engineer', '/projects/p1');
    const tabs = Array.from(screen.getByRole('tablist', { name: /project sections/i }).querySelectorAll('[role="tab"]'))
      .map((tab) => tab.textContent);
    expect(tabs).toEqual(['Overview', 'Procurement', 'Tasks', 'Materials', 'Documents']);
  });

  // ── All other roles ALSO default to Overview (unchanged) ───────────────────

  it('AC-IXD-PROJ-W5-C3-A-03: Project Manager opening /projects/:id (no tab) lands on Overview', async () => {
    await renderAs('Project Manager', '/projects/p1');
    expect(screen.getByRole('tab', { name: 'Overview', selected: true })).toBeInTheDocument();
  });

  it('AC-IXD-PROJ-W5-C3-A-04: Executive opening /projects/:id (no tab) lands on Overview', async () => {
    await renderAs('Executive', '/projects/p1');
    expect(screen.getByRole('tab', { name: 'Overview', selected: true })).toBeInTheDocument();
  });

  it('AC-IXD-PROJ-W5-C3-A-05: Finance opening /projects/:id (no tab) lands on Overview', async () => {
    await renderAs('Finance', '/projects/p1');
    expect(screen.getByRole('tab', { name: 'Overview', selected: true })).toBeInTheDocument();
  });

  it('AC-IXD-PROJ-W5-C3-A-06: Admin opening /projects/:id (no tab) lands on Overview', async () => {
    await renderAs('Admin', '/projects/p1');
    expect(screen.getByRole('tab', { name: 'Overview', selected: true })).toBeInTheDocument();
  });

  // ── Deep-link always wins regardless of role ──────────────────────────────

  it('AC-PB-008: an Engineer deep-link to /projects/:id/budget falls back to Overview', async () => {
    await renderAs('Engineer', '/projects/p1/budget');
    expect(screen.getByRole('tab', { name: 'Overview', selected: true })).toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: 'Budget' })).not.toBeInTheDocument();
  });

  it('AC-IXD-PROJ-W5-C3-A-08: Project Manager with explicit /projects/:id/tasks deep-link opens Tasks', async () => {
    await renderAs('Project Manager', '/projects/p1/tasks');
    expect(screen.getByRole('tab', { name: 'Tasks', selected: true })).toBeInTheDocument();
  });

  it('AC-IXD-PROJ-W5-C3-A-09: Engineer with explicit /projects/:id/overview deep-link opens Overview', async () => {
    await renderAs('Engineer', '/projects/p1/overview');
    expect(screen.getByRole('tab', { name: 'Overview', selected: true })).toBeInTheDocument();
  });

  it('AC-IXD-PROJ-W5-C3-A-10: Finance with explicit /projects/:id/procurement deep-link opens Procurement', async () => {
    await renderAs('Finance', '/projects/p1/procurement');
    expect(screen.getByRole('tab', { name: 'Procurement', selected: true })).toBeInTheDocument();
  });
});
