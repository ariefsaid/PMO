import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import { ToastProvider } from '@/src/components/ui';
import { getPageAnnouncement } from '@/src/components/ui/__tests__/announcementTestQueries';
import ProjectDetail from '../ProjectDetail';
import type { ProjectWithRefs } from '@/src/lib/db/projects';

const seed = [
  { id: 'p1', name: 'Innovate Corp HQ Fit-Out', code: 'PRJ-001', status: 'Ongoing Project',
    client_id: 'c2', project_manager_id: 'u-alice', contract_value: 5000000, currency: 'USD', budget: 4700000,
    spent: 2100000, start_date: '2026-01-01', end_date: '2026-12-18', contract_date: '2026-01-10',
    customer_contract_ref: 'CPO-2026-001', client: { name: 'Innovate Corp' }, pm: { full_name: 'Alice Manager' } },
] as unknown as ProjectWithRefs[];

const projectsState = { data: seed, isPending: false, isError: false, refetch: vi.fn() };
const committedSpendState = { data: 2_350_000 };
// The by-id opportunity read (the fallback for a record outside the active cache) — mutable so a test
// can fail it independently of the list read.
const oppState = { data: undefined as unknown, isPending: false, isError: false, refetch: vi.fn() };
// CW-7: the role drives RBAC-gated affordances; it is mutable so a test can render the page as a
// different role (e.g. Engineer) and assert the role-INVARIANT default tab.
const { roleBox, desktopBox, projectMutations, projectTransition, budgetVersionsBox, committedSpendHook } = vi.hoisted(() => ({
  // Records the arguments so a test can prove which project-wide reads a role triggers.
  committedSpendHook: vi.fn(),
  budgetVersionsBox: { value: [] as unknown[] },
  roleBox: { value: 'Project Manager' as string },
  desktopBox: { value: true },
  projectMutations: {
    create: { mutateAsync: vi.fn(), isPending: false },
    updateHeader: { mutateAsync: vi.fn(), isPending: false },
    archive: { mutateAsync: vi.fn(), isPending: false },
    remove: { mutateAsync: vi.fn(), isPending: false },
    setContractValue: { mutateAsync: vi.fn(), isPending: false },
  },
  projectTransition: {
    mutate: vi.fn(),
    mutateAsync: vi.fn(),
    isError: false,
    error: null,
    isPending: false,
  },
}));
vi.mock('@/src/hooks/useProjects', () => ({
  useProjects: () => projectsState,
  // #840: the detail route reads ONE project by id (any stage), never the whole list. `oppState`
  // stands in for a record outside `projectsState` (a pre-win / lost deal) — both are the one read.
  useProject: (id: string) => ({
    data: (projectsState.data ?? []).find((p) => p.id === id) ?? oppState.data ?? null,
    isPending: projectsState.isPending || oppState.isPending,
    isError: projectsState.isError || oppState.isError,
    refetch: projectsState.refetch,
  }),
  // The detail header consumes these (Edit/Archive/contract_value SoD + the FK pickers).
  useProjectMutations: () => projectMutations,
  useClientCompanies: () => ({ data: [], isError: false }),
  useProjectManagers: () => ({ data: [], isError: false }),
}));
vi.mock('@/src/auth/useAuth', () => ({
  useAuth: () => ({ currentUser: { id: 'u-alice', org_id: 'org-1' }, role: roleBox.value }),
}));
// ADR-0016: the Budget tab (ProjectBudget) + ProjectStatusControl gate write on the REAL
// role via usePermission, so the mock supplies realRole (equal to effectiveRole here).
vi.mock('@/src/auth/impersonation', () => ({ useEffectiveRole: () => ({ effectiveRole: roleBox.value, realRole: roleBox.value }) }));
vi.mock('@/src/components/ui/useIsDesktop', () => ({ useIsDesktop: () => desktopBox.value }));
// Budget tab mounts the real ProjectBudget — stub its data hooks to avoid network.
vi.mock('@/src/hooks/useBudget', () => ({
  // AC-W2-1-FE-01: budget utilization reads from useProjectBudget (derived from Active version
  // line-items). Return 4,700,000 to match the seed project so the 50% util assertion holds.
  useProjectBudget: () => ({ data: 4_700_000, isPending: false, isError: false, refetch: vi.fn() }),
  useBudgetVersions: () => ({ data: budgetVersionsBox.value, isPending: false, isError: false, refetch: vi.fn() }),
  useBudgetActivationMode: () => ({ data: undefined, isPending: false, isError: false }),
  useBudgetMutations: () => ({
    createVersion: { mutateAsync: vi.fn() }, activate: { mutateAsync: vi.fn() },
    archive: { mutateAsync: vi.fn() }, cloneVersion: { mutateAsync: vi.fn() },
    deleteDraft: { mutateAsync: vi.fn() }, createLineItem: { mutateAsync: vi.fn() },
    deleteLineItem: { mutateAsync: vi.fn() },
  }),
}));
vi.mock('@/src/hooks/useProjectFinances', () => ({
  useProjectFinances: () => ({ data: { project_id: 'p1', contract_invoiced: null, remaining_to_invoice: null, invoices: [], budget: null, actuals: { currency: 'USD', total: '2350000.00', as_of: null, excludes_restricted_rows: false, categories: [{ category: 'Labor', mapped: true, amount: '2350000.00' }] } }, isPending: false, isError: false }),
}));
vi.mock('@/src/hooks/useProcurements', () => ({
  useProcurements: () => ({ data: [], isPending: false, isError: false, refetch: vi.fn() }),
  useProjectProcurements: () => ({ data: [], isPending: false, isError: false, refetch: vi.fn() }),
  useProjectCommittedSpend: (...args: unknown[]) => committedSpendHook(...args),
}));
vi.mock('@/src/hooks/useProjectTransitions', () => ({
  useProjectTransition: () => projectTransition,
}));
// Model B: ProjectDetail falls back to a by-id opportunity fetch for records not in the active
// projects cache. The seed here is on-hand (in the cache), so this is disabled — stub it to
// avoid needing a QueryClient.
vi.mock('@/src/lib/db/opportunity', () => ({
  useOpportunity: () => oppState,
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
vi.mock('react-router', async (orig) => {
  const actual = await (orig() as Promise<Record<string, unknown>>);
  return { ...actual, useNavigate: () => navigate };
});

// The Budget tab mounts ProjectBudget, which uses useToast — needs a provider.
// B-9 (AC-W2-IA-004): all tabs are now deep-linkable via /projects/:projectId/:tab.
// Both the `:tab` route and the bare `:projectId` route are registered so navigation
// after a tab click (which goes to /projects/:projectId/:tab) keeps rendering ProjectDetail.
const freshClient = () => new QueryClient({ defaultOptions: { queries: { retry: false } } });

// list-working-set-return (#682, AC-LRC-003): a plain string entry is the direct-link case (no
// captured list context); an { pathname, state } entry lets a test seed a validated
// `pmoListReturn` context as though the record were opened from a narrowed Projects list.
const renderAt = async (path: string | { pathname: string; state?: unknown }) => {
  const view = render(
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
  await waitFor(() => expect(screen.queryByTestId('project-detail-panel-loading')).not.toBeInTheDocument(), { timeout: 10_000 });
  return view;
};

describe('ProjectDetail shell (decomposition)', () => {
  beforeEach(() => {
    projectsState.data = seed;
    projectsState.isPending = false;
    projectsState.isError = false;
    projectsState.refetch.mockReset();
    oppState.data = undefined;
    oppState.isPending = false;
    oppState.isError = false;
    oppState.refetch.mockReset();
    committedSpendState.data = 2_350_000;
    committedSpendHook.mockReset();
    committedSpendHook.mockImplementation(() => ({ data: committedSpendState.data, isPending: false, isError: false, commitmentSource: 'pmo', ledgerBasis: 'erp', refetch: vi.fn() }));
    budgetVersionsBox.value = [];
    roleBox.value = 'Project Manager';
    desktopBox.value = true;
    navigate.mockClear();
    Object.values(projectMutations).forEach((m) => {
      m.mutateAsync.mockReset();
      m.mutateAsync.mockResolvedValue(undefined);
      m.isPending = false;
    });
  });

  it('UIP-005: Overview owns the phase planner and makes its section link current', async () => {
    await renderAt('/projects/p1');
    expect(screen.getByTestId('milestone-strip-empty')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add phase' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Overview' })).toHaveAttribute('aria-current', 'page');
  });

  it('UIP-005 / PD-A: Tasks with no phases shows no phase line at all and not the full planner', async () => {
    await renderAt('/projects/p1/tasks');
    expect(screen.queryByTestId('milestone-strip-empty')).not.toBeInTheDocument();
    expect(screen.queryByTestId('milestone-summary')).not.toBeInTheDocument();
    expect(screen.queryByText('No delivery phases yet')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Tasks' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByText(/No tasks yet/i)).toBeInTheDocument();
  });

  it('renders the header from the real cached row, defaults to Overview, and moves record details into the persistent rail (L3-RECORD)', async () => {
    await renderAt('/projects/p1');
    expect(screen.getByRole('heading', { name: 'Innovate Corp HQ Fit-Out' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Overview' })).toHaveAttribute('aria-current', 'page');

    const rail = screen.getByTestId('project-detail-rail');
    expect(within(rail).getByText('Details')).toBeInTheDocument();
    const scope = screen.getByRole('group', { name: 'Project scope' });
    expect(scope).toHaveTextContent('Innovate Corp');
    expect(scope).toHaveTextContent('PM: Alice Manager');
    expect(within(rail).queryByText('Customer')).not.toBeInTheDocument();
    expect(within(rail).queryByText('Project manager')).not.toBeInTheDocument();
    expect(within(rail).getByText('Customer PO ref')).toBeInTheDocument();
    expect(within(rail).getByText('CPO-2026-001')).toBeInTheDocument();
    expect(within(rail).getByText('Customer PO date').nextElementSibling).toHaveTextContent('Jan 10, 2026');
    expect(within(rail).getByText('Project details')).toBeInTheDocument();
    expect(rail.querySelector('details')).not.toHaveAttribute('open');
    // The status remains in the record header and is not repeated in trailing details.
    expect(within(rail).queryByText('Status')).not.toBeInTheDocument();
    expect(within(rail).queryByText(/Move the project through its delivery stages/)).not.toBeInTheDocument();

    expect(screen.queryByText('Project information')).not.toBeInTheDocument();
  });

  it('CW-7: /projects/:id defaults to Overview for EVERY role — the URL is role-invariant (Engineer)', async () => {
    // Wayfinding bug fix: the same URL must resolve to the same default tab for every role.
    // Previously delivery-forward roles (Engineer) landed on Tasks → a role-variant URL.
    roleBox.value = 'Engineer';
    await renderAt('/projects/p1');
    expect(screen.getByRole('link', { name: 'Overview' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'Tasks' })).not.toHaveAttribute('aria-current');
  });

  it('AC-PA-REC-390: the phone Sections control switches the canonical project section URL', async () => {
    desktopBox.value = false;
    await renderAt('/projects/p1');

    const sections = screen.getByRole('combobox', { name: 'Sections' });
    expect(sections).toHaveValue('overview');
    await userEvent.selectOptions(sections, 'tasks');

    expect(navigate).toHaveBeenCalledWith('/projects/p1/tasks', {
      replace: true,
      state: { pmoTabSwitch: true },
    });
  });

  it('AC-N-05: keeps the full record identity beside the current section when the heading leaves view', async () => {
    desktopBox.value = false;
    class FakeIntersectionObserver {
      readonly root = document.getElementById('main');
      readonly rootMargin = '0px';
      readonly thresholds = [0];
      constructor(private readonly callback: IntersectionObserverCallback) {}
      observe(target: Element) {
        this.callback([{ isIntersecting: false, target } as IntersectionObserverEntry], this as unknown as IntersectionObserver);
      }
      disconnect() {}
      unobserve() {}
      takeRecords() { return []; }
    }
    vi.stubGlobal('IntersectionObserver', FakeIntersectionObserver);
    try {
      await renderAt('/projects/p1');
      expect(await screen.findByTestId('project-sticky-identity')).toHaveTextContent('Innovate Corp HQ Fit-Out');
      expect(screen.getByRole('combobox', { name: 'Sections' })).toHaveValue('overview');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('keeps Edit as a single header entry point and leaves record details secondary', async () => {
    await renderAt('/projects/p1');

    const rail = screen.getByTestId('project-detail-rail');
    await userEvent.click(within(rail).getByText('Project details'));
    expect(within(rail).queryByRole('button', { name: /edit project/i })).not.toBeInTheDocument();
    await userEvent.click(screen.getByText('More actions'));
    expect(screen.getAllByRole('button', { name: /^Edit$/i })).toHaveLength(1);

    await userEvent.click(screen.getByRole('button', { name: /^Edit$/i }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByDisplayValue('Innovate Corp HQ Fit-Out')).toBeInTheDocument();
  });

  it('I-2: section creation actions remain available in their owning section', async () => {
    const cases = [
      ['/projects/p1/budget', /new version/i],
      ['/projects/p1/procurement', /new request/i],
      ['/projects/p1/tasks', /new task/i],
      ['/projects/p1/documents', /add document/i],
    ] as const;

    for (const [path, name] of cases) {
      const { unmount } = await renderAt(path);
      expect(screen.getAllByRole('button', { name })[0]).toBeInTheDocument();
      unmount();
    }
  });

  it('UX-002: mobile keeps record-wide transitions discoverable without a fixed action covering the selected work', async () => {
    desktopBox.value = false;
    await renderAt('/projects/p1/documents');

    expect(screen.queryByTestId('mobile-sticky-action')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Documents' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByText('Document register')).toBeInTheDocument();
    const rail = screen.getByTestId('project-detail-rail');
    expect(within(rail).getByText('Project details')).toBeInTheDocument();
  });

  it('shows the permitted recorded spending and derives budget use from the active version', async () => {
    committedSpendState.data = 2_350_000;
    budgetVersionsBox.value = [{ id: 'bv1', status: 'Active', total: 4_700_000, line_items: [] }];
    await renderAt('/projects/p1');

    const cost = screen.getByRole('group', { name: 'Cost' });
    expect(within(cost).getAllByText('$2,350,000.00').length).toBeGreaterThan(0);
    expect(screen.getByTestId('budget-used')).toHaveTextContent('50% of budget');
  });

  it('AC-SEC-229: an Engineer sees no project-wide purchase-order or spend figure — their purchasing read covers only their own requests', async () => {
    roleBox.value = 'Engineer';
    committedSpendState.data = 2_350_000;
    budgetVersionsBox.value = [{ id: 'bv1', status: 'Active', total: 4_700_000, line_items: [] }];
    await renderAt('/projects/p1');

    // The Engineer's money position still renders (Contract), but no figure summed over the
    // project's requests: the project-wide read is not issued and nothing derived from it shows.
    expect(screen.getByTestId('overview-contract-value')).toBeInTheDocument();
    expect(screen.queryByText('PMO purchase orders')).not.toBeInTheDocument();
    expect(screen.queryByText('$2,350,000.00')).not.toBeInTheDocument();
    expect(screen.queryByTestId('budget-used')).not.toBeInTheDocument();
    expect(committedSpendHook).toHaveBeenCalled();
    for (const [projectId] of committedSpendHook.mock.calls) expect(projectId).toBeNull();
  });

  it('opens the Procurement section and shows its empty state', async () => {
    await renderAt('/projects/p1/procurement');
    expect(screen.getByRole('link', { name: 'Procurement' })).toHaveAttribute('aria-current', 'page');
    expect(await screen.findByText(/No purchase requests for this project yet/i)).toBeInTheDocument();
  });

  it('opens the real Tasks register and keeps the section link current (AC-TASK-001)', async () => {
    await renderAt('/projects/p1/tasks');
    // Tasks is now a real CRUD surface (no longer a "coming soon" placeholder).
    expect(screen.getByText(/no tasks yet/i)).toBeInTheDocument();
    // PM (a structure write-role) sees the gated New task affordance.
    expect(screen.getAllByRole('button', { name: /new task/i }).length).toBeGreaterThan(0);
  });

  it('AC-DOC-001: the Documents section mounts its real register and gated Add action for the PM', async () => {
    await renderAt('/projects/p1/documents');
    // The deferred "coming soon" placeholder is gone — this is now a real register.
    expect(screen.queryByText(/Document management is coming soon/i)).not.toBeInTheDocument();
    expect(screen.getByText(/No documents yet/i)).toBeInTheDocument();
    // PM is a master-data write-role → the gated Add document affordance is present (header CTA only).
    expect(screen.getAllByRole('button', { name: /Add document/i })).toHaveLength(1);
  });

  it('does NOT render a Timesheets section (removed placeholder, tracked in backlog)', async () => {
    await renderAt('/projects/p1');
    expect(screen.queryByRole('link', { name: 'Timesheets' })).not.toBeInTheDocument();
  });

  it('opens Budget on its deep link and keeps Project details after the section content', async () => {
    await renderAt('/projects/p1/budget');
    expect(screen.getByRole('link', { name: 'Budget' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByTestId('project-detail-rail')).toBeInTheDocument();
    // AC-W6-IXD-BUDHEAD (deliberate UX change): the redundant "Project Budget" <h2>
    // was dropped — the selected "Budget" tab is the section label and the "Active
    // budget" line is the section lead. Oracle updated per the BDD authoring rule:
    // the goal (the Budget section is shown on the deep-link) stays honest; we no
    // longer assert the duplicate heading the change removed.
    expect(screen.queryByText('Project Budget')).not.toBeInTheDocument();
    // SUB-D: with no versions at all the tab says nothing extra — "+ New version" and the empty state remain,
    // and "$0" is never presented as a budget.
    expect(await screen.findByText('No budget versions yet')).toBeInTheDocument();
  });

  it('shows a loading state on a cold deep-link before the cache resolves', async () => {
    projectsState.data = undefined as unknown as ProjectWithRefs[];
    projectsState.isPending = true;
    await renderAt('/projects/p1');
    expect(screen.getByTestId('liststate-loading')).toBeInTheDocument();
  });

  it('I7: the success render drops the redundant in-page Breadcrumb (Back bar is phone-only, see C-IMP-1)', async () => {
    await renderAt('/projects/p1');
    expect(screen.getByRole('heading', { name: 'Innovate Corp HQ Fit-Out' })).toBeInTheDocument();
    // I7: the top-bar breadcrumb owns wayfinding above 920px — no in-page Breadcrumb nav landmark.
    expect(screen.queryByRole('navigation', { name: /breadcrumb/i })).toBeNull();
    // the project name appears exactly once (the header), not duplicated by a crumb
    expect(screen.getAllByText('Innovate Corp HQ Fit-Out')).toHaveLength(1);
  });

  it('I7: the not-found render keeps the "Back to Projects" escape route', async () => {
    projectsState.data = [];
    await renderAt('/projects/does-not-exist');
    expect(screen.getByText(/Project not found/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Back to Projects/i })).toBeInTheDocument();
  });

  it('#695: when the project read fails it shows a load error with Retry, never "Project not found"', async () => {
    projectsState.data = undefined as unknown as ProjectWithRefs[];
    projectsState.isError = true;
    await renderAt('/projects/p1');
    expect(screen.queryByText(/Project not found/i)).toBeNull();
    const alert = getPageAnnouncement('alert', /Couldn.t load this project/i);
    expect(within(alert).getByText(/Couldn.t load this project/i)).toBeInTheDocument();
    // The escape route stays; and Retry re-runs the by-id read.
    expect(screen.getByRole('button', { name: /Back to Projects/i })).toBeInTheDocument();
    // Keep the recovery action available; its responsive placement belongs to the shared frame.
    expect(screen.getByRole('button', { name: /Back to Projects/i })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(projectsState.refetch).toHaveBeenCalledTimes(1);
  });

  it('#695: a failed by-id read is a load error too — absence cannot be claimed from a failed read', async () => {
    projectsState.data = [];
    projectsState.isError = true;
    await renderAt('/projects/p1');
    expect(screen.queryByText(/Project not found/i)).toBeNull();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });

  it.each([
    ['loading', { data: undefined as unknown as ProjectWithRefs[], isPending: true }],
    ['not-found', { data: [] as ProjectWithRefs[], isPending: false }],
  ])('#707: the %s state provides a working Back to Projects recovery action', async (_n, s) => {
    Object.assign(projectsState, s);
    await renderAt('/projects/does-not-exist');
    await userEvent.click(screen.getByRole('button', { name: /Back to Projects/i }));
    expect(navigate).toHaveBeenCalledWith('/projects', { state: {} });
  });

  it('AC-NAV-007: "Back to Projects" navigates to the Projects module index (no tab)', async () => {
    // Director ruling (2026-09-29): the destination stays canonical `/projects` while a direct
    // link with no captured list context now additionally carries validated clean return state.
    projectsState.data = [];
    await renderAt('/projects/does-not-exist');
    await userEvent.click(screen.getByRole('button', { name: /Back to Projects/i }));
    expect(navigate).toHaveBeenCalledWith('/projects', { state: {} });
  });

  it('AC-LRC-003: "Back to Projects" returns to the captured Projects list URL when opened from a narrowed list', async () => {
    // Mobile BackBar only — the desktop parent breadcrumb reads the same context in App.tsx.
    desktopBox.value = false;
    await renderAt({
      pathname: '/projects/p1',
      state: { pmoListReturn: { list: 'projects', path: '/projects?filter=Ongoing' } },
    });
    await userEvent.click(screen.getByRole('button', { name: /Back to Projects/i }));
    expect(navigate).toHaveBeenCalledWith(
      '/projects?filter=Ongoing',
      expect.objectContaining({
        state: expect.not.objectContaining({ pmoListReturn: expect.anything() }),
      }),
    );
  });

  it('C-IMP-1 / #735: the loaded record provides the Back action at the shared-frame breakpoint', async () => {
    desktopBox.value = true; // 800px is "desktop" by the 768px hook — the bar must still render
    await renderAt('/projects/p1');
    const back = screen.getByRole('button', { name: /Back to Projects/i });
    await userEvent.click(back);
    expect(navigate).toHaveBeenCalledWith('/projects', { state: {} });
  });

  it('C-IMP-1 / #735: the loaded record provides the Back action on phone', async () => {
    desktopBox.value = false;
    await renderAt('/projects/p1');
    await userEvent.click(screen.getByRole('button', { name: /Back to Projects/i }));
    expect(navigate).toHaveBeenCalledWith('/projects', { state: {} });
  });
});
