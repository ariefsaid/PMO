import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import { ToastProvider } from '@/src/components/ui';
import ProjectDetail from '../ProjectDetail';
import type { ProjectWithRefs } from '@/src/lib/db/projects';

const seed = [
  { id: 'p1', name: 'Innovate Corp HQ Fit-Out', code: 'PRJ-001', status: 'Ongoing Project',
    client_id: 'c2', project_manager_id: 'u-alice', contract_value: 5000000, budget: 4700000,
    spent: 2100000, start_date: '2026-01-01', end_date: '2026-12-18', contract_date: '2026-01-10',
    customer_contract_ref: 'CPO-2026-001', client: { name: 'Innovate Corp' }, pm: { full_name: 'Alice Manager' } },
] as unknown as ProjectWithRefs[];

const projectsState = { data: seed, isPending: false, isError: false, refetch: vi.fn() };
vi.mock('@/src/hooks/useProjects', () => ({
  useProjects: () => projectsState,
  // The detail header consumes these (Edit/Archive/contract_value SoD + the FK pickers).
  useProjectMutations: () => ({
    create: { mutateAsync: vi.fn(), isPending: false },
    updateHeader: { mutateAsync: vi.fn(), isPending: false },
    archive: { mutateAsync: vi.fn(), isPending: false },
    remove: { mutateAsync: vi.fn(), isPending: false },
    setContractValue: { mutateAsync: vi.fn(), isPending: false },
  }),
  useClientCompanies: () => ({ data: [], isError: false }),
  useProjectManagers: () => ({ data: [], isError: false }),
}));
vi.mock('@/src/auth/useAuth', () => ({
  useAuth: () => ({ currentUser: { id: 'u-alice', org_id: 'org-1' }, role: 'Project Manager' }),
}));
// ADR-0016: the Budget tab (ProjectBudget) + ProjectStatusControl gate write on the REAL
// role via usePermission, so the mock supplies realRole (equal to effectiveRole here).
vi.mock('@/src/auth/impersonation', () => ({ useEffectiveRole: () => ({ effectiveRole: 'Project Manager', realRole: 'Project Manager' }) }));
// Budget tab mounts the real ProjectBudget — stub its data hooks to avoid network.
vi.mock('@/src/hooks/useBudget', () => ({
  useProjectBudget: () => ({ data: 0, isPending: false, isError: false, refetch: vi.fn() }),
  useBudgetVersions: () => ({ data: [], isPending: false, isError: false, refetch: vi.fn() }),
  useBudgetMutations: () => ({
    createVersion: { mutateAsync: vi.fn() }, activate: { mutateAsync: vi.fn() },
    archive: { mutateAsync: vi.fn() }, cloneVersion: { mutateAsync: vi.fn() },
    deleteDraft: { mutateAsync: vi.fn() }, createLineItem: { mutateAsync: vi.fn() },
    deleteLineItem: { mutateAsync: vi.fn() },
  }),
}));
vi.mock('@/src/hooks/useProcurements', () => ({
  useProcurements: () => ({ data: [], isPending: false, isError: false, refetch: vi.fn() }),
}));
// Model B: ProjectDetail falls back to a by-id opportunity fetch for records not in the active
// projects cache. The seed here is on-hand (in the cache), so this is disabled — stub it to
// avoid needing a QueryClient.
vi.mock('@/src/lib/db/opportunity', () => ({
  useOpportunity: () => ({ data: undefined, isPending: false }),
}));
// MilestoneStrip now mounts in the header area — stub its hooks to avoid network.
vi.mock('@/src/hooks/useMilestones', () => ({
  useMilestones: () => ({ data: [], isPending: false, isError: false, refetch: vi.fn() }),
  useMilestoneMutations: () => ({
    create: { mutateAsync: vi.fn(), isPending: false },
    update: { mutateAsync: vi.fn(), isPending: false },
    remove: { mutateAsync: vi.fn(), isPending: false },
    setTaskMilestone: { mutateAsync: vi.fn(), isPending: false },
  }),
}));
// Tasks tab mounts the real TasksTab — stub its data hooks (empty register) to avoid network.
vi.mock('@/src/hooks/useTasks', () => ({
  useTasks: () => ({ data: [], isPending: false, isError: false, refetch: vi.fn() }),
  useAssignableProfiles: () => ({ data: [], isPending: false, isError: false }),
  useTaskMutations: () => ({
    create: { mutateAsync: vi.fn(), isPending: false },
    update: { mutateAsync: vi.fn(), isPending: false },
    updateStatus: { mutateAsync: vi.fn(), isPending: false },
    remove: { mutateAsync: vi.fn(), isPending: false },
    addDependency: { mutateAsync: vi.fn(), isPending: false },
    removeDependency: { mutateAsync: vi.fn(), isPending: false },
  }),
}));
// The Documents tab is now a real register (no longer a deferred placeholder); stub its
// data hooks so the shell test stays a pure shell test (no network / no QueryClient needed).
vi.mock('@/src/hooks/useDocuments', () => ({
  useDocuments: () => ({ data: [], isPending: false, isError: false, refetch: vi.fn() }),
  useDocumentMutations: () => ({
    create: { mutateAsync: vi.fn(), isPending: false },
    update: { mutateAsync: vi.fn(), isPending: false },
    transition: { mutateAsync: vi.fn(), isPending: false },
    remove: { mutateAsync: vi.fn(), isPending: false },
  }),
}));
// Tabs are gone — back-nav is a plain react-router navigate (AC-NAV-007).
const navigate = vi.fn();
vi.mock('react-router-dom', async (orig) => {
  const actual = await (orig() as Promise<Record<string, unknown>>);
  return { ...actual, useNavigate: () => navigate };
});

// The Budget tab mounts ProjectBudget, which uses useToast — needs a provider.
// B-9 (AC-W2-IA-004): all tabs are now deep-linkable via /projects/:projectId/:tab.
// Both the `:tab` route and the bare `:projectId` route are registered so navigation
// after a tab click (which goes to /projects/:projectId/:tab) keeps rendering ProjectDetail.
const freshClient = () => new QueryClient({ defaultOptions: { queries: { retry: false } } });

const renderAt = (path: string) =>
  render(
    <QueryClientProvider client={freshClient()}>
      <MemoryRouter initialEntries={[path]}>
        <ToastProvider>
          <Routes>
            <Route path="/projects/:projectId/:tab" element={<ProjectDetail />} />
            <Route path="/projects/:projectId" element={<ProjectDetail />} />
          </Routes>
        </ToastProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );

describe('ProjectDetail shell (decomposition)', () => {
  beforeEach(() => {
    projectsState.data = seed;
    projectsState.isPending = false;
    projectsState.isError = false;
    navigate.mockClear();
  });

  it('renders the header from the real cached row and defaults to the Overview tab (AC-F/G, OQ-4)', () => {
    renderAt('/projects/p1');
    expect(screen.getByRole('heading', { name: 'Innovate Corp HQ Fit-Out' })).toBeInTheDocument();
    const tabs = screen.getByRole('tablist', { name: /project sections/i });
    expect(within(tabs).getByRole('tab', { name: 'Overview' })).toHaveAttribute('aria-selected', 'true');
    // Overview content (real): project information card
    expect(screen.getByText('Project information')).toBeInTheDocument();
  });

  it('switches to the Procurement tab and shows its real (empty) state', async () => {
    renderAt('/projects/p1');
    await userEvent.click(screen.getByRole('tab', { name: 'Procurement' }));
    expect(screen.getByText(/No purchase requests for this project yet/i)).toBeInTheDocument();
  });

  it('switches to the real Tasks tab and shows its empty register (AC-TASK-001)', async () => {
    // B-9 (AC-W2-IA-004): tab is now URL-driven — navigate directly to the :tab deep-link.
    // (The mocked `useNavigate` is a vi.fn() no-op, so clicking the tab does not change the
    // MemoryRouter URL; direct URL navigation is the correct way to test URL-driven tab content.)
    renderAt('/projects/p1/tasks');
    // Tasks is now a real CRUD surface (no longer a "coming soon" placeholder).
    expect(screen.getByText(/no tasks yet/i)).toBeInTheDocument();
    // PM (a structure write-role) sees the gated New task affordance.
    expect(screen.getAllByRole('button', { name: /new task/i }).length).toBeGreaterThan(0);
  });

  it('AC-DOC-001: the Documents tab mounts the real document register (empty state, gated Add for the PM)', () => {
    // B-9 (AC-W2-IA-004): tab is URL-driven — navigate directly to the :tab deep-link.
    renderAt('/projects/p1/documents');
    // The deferred "coming soon" placeholder is gone — this is now a real register.
    expect(screen.queryByText(/Document management is coming soon/i)).not.toBeInTheDocument();
    expect(screen.getByText(/No documents yet/i)).toBeInTheDocument();
    // PM is a master-data write-role → the gated Add document affordance is present
    // (header CTA + the empty-state teach action both carry the label).
    expect(screen.getAllByRole('button', { name: /Add document/i }).length).toBeGreaterThan(0);
  });

  it('does NOT render a Timesheets tab (removed placeholder, tracked in backlog)', () => {
    renderAt('/projects/p1');
    const tablist = screen.getByRole('tablist', { name: /project sections/i });
    const tabs = Array.from(tablist.querySelectorAll('[role="tab"]')).map((t) => t.textContent);
    expect(tabs).not.toContain('Timesheets');
  });

  it('pre-selects the Budget tab on the /budget deep-link route', () => {
    renderAt('/projects/p1/budget');
    const tabs = screen.getByRole('tablist', { name: /project sections/i });
    expect(within(tabs).getByRole('tab', { name: 'Budget' })).toHaveAttribute('aria-selected', 'true');
    // AC-W6-IXD-BUDHEAD (deliberate UX change): the redundant "Project Budget" <h2>
    // was dropped — the selected "Budget" tab is the section label and the "Active
    // budget" line is the section lead. Oracle updated per the BDD authoring rule:
    // the goal (the Budget section is shown on the deep-link) stays honest; we no
    // longer assert the duplicate heading the change removed.
    expect(screen.queryByText('Project Budget')).not.toBeInTheDocument();
    expect(screen.getByText(/Active budget:/i)).toBeInTheDocument();
  });

  it('shows a loading state on a cold deep-link before the cache resolves', () => {
    projectsState.data = undefined as unknown as ProjectWithRefs[];
    projectsState.isPending = true;
    renderAt('/projects/p1');
    expect(screen.getByTestId('liststate-loading')).toBeInTheDocument();
  });

  it('I7: the success render drops the redundant in-page BackBar + Breadcrumb', () => {
    renderAt('/projects/p1');
    expect(screen.getByRole('heading', { name: 'Innovate Corp HQ Fit-Out' })).toBeInTheDocument();
    // I7: the top-bar breadcrumb owns wayfinding — no in-page BackBar...
    expect(screen.queryByRole('button', { name: /Back to Projects/i })).toBeNull();
    // ...and no in-page Breadcrumb nav landmark.
    expect(screen.queryByRole('navigation', { name: /breadcrumb/i })).toBeNull();
    // the project name appears exactly once (the header), not duplicated by a crumb
    expect(screen.getAllByText('Innovate Corp HQ Fit-Out')).toHaveLength(1);
  });

  it('I7: the not-found render keeps the "Back to Projects" escape route', () => {
    projectsState.data = [];
    renderAt('/projects/does-not-exist');
    expect(screen.getByText(/Project not found/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Back to Projects/i })).toBeInTheDocument();
  });

  it('AC-NAV-007: "Back to Projects" navigates to the Projects module index (no tab)', async () => {
    projectsState.data = [];
    renderAt('/projects/does-not-exist');
    await userEvent.click(screen.getByRole('button', { name: /Back to Projects/i }));
    expect(navigate).toHaveBeenCalledWith('/projects');
  });
});
