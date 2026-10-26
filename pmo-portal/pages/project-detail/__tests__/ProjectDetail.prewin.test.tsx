/**
 * AC-IFW-RECORD-01 — Pre-win detail retains the commercial journey and actions.
 * R-033 deliberately retires pre-win delivery-planner composition; operational planning
 * and the S-curve belong to the won record.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import { PageFrame } from '@/src/components/shell';
import { breadcrumbForPath } from '@/src/components/shell/routeMatch';
import { ToastProvider } from '@/src/components/ui';
import ProjectDetail from '../ProjectDetail';
import type { ProjectWithRefs } from '@/src/lib/db/projects';

// ── shared mutable state ─────────────────────────────────────────────────────
const projectsState = {
  data: [] as ProjectWithRefs[],
  isPending: false,
  isError: false,
  refetch: vi.fn(),
};

const milestonesState = {
  data: [] as import('@/src/lib/db/milestones').MilestoneWithProgress[],
  isPending: false,
  isError: false,
  refetch: vi.fn(),
};

// The pre-win record the by-id read resolves (#840) — a 'Tender Submitted' deal so legal targets
// include 'Won, Pending KoM' (enabling the Mark won button).
const oppRecord = vi.hoisted(() => ({
    id: 'opp1',
    name: 'Alpha Solar Bid',
    code: 'OPP-0001',
    service_line: 'Engineering',
    status: 'Tender Submitted',
    client_id: 'c1',
    project_manager_id: 'u-pm',
    contract_value: 500000,
    currency: 'USD',
    start_date: null,
    end_date: null,
    contract_date: null,
    customer_contract_ref: null,
    client: { name: 'Alpha Corp' },
    pm: { full_name: 'PM Name' },
  }));

// ── module mocks ─────────────────────────────────────────────────────────────
vi.mock('@/src/hooks/useProjects', () => ({
  useProjects: () => projectsState,
  // #840: the detail route reads ONE project by id (any stage), never the whole list.
  // #840: the detail route reads ONE project by id; the pre-win deal is not in the active list.
  useProject: () => ({ data: oppRecord, isPending: false, isError: false, refetch: vi.fn() }),
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

vi.mock('@/src/hooks/useMilestones', () => ({
  useMilestones: () => milestonesState,
  useMilestoneMutations: () => ({
    create: { mutateAsync: vi.fn(), isPending: false },
    update: { mutateAsync: vi.fn(), isPending: false },
    remove: { mutateAsync: vi.fn(), isPending: false },
    setTaskMilestone: { mutateAsync: vi.fn(), isPending: false },
  }),
}));

vi.mock('@/src/hooks/useDashboard', () => ({
  useSalesPipeline: () => ({
    data: {
      stages: [],
      projects: [{ id: 'opp1', name: 'Alpha Solar Bid', status: 'Tender Submitted', contract_value: 500000, win_probability: 0.6 }],
    },
    isPending: false,
    isError: false,
  }),
}));

vi.mock('@/src/hooks/useProcurements', () => ({
  useProcurements: () => ({ data: [], isPending: false, isError: false, refetch: vi.fn() }),
  useProjectProcurements: () => ({ data: [], isPending: false, isError: false, refetch: vi.fn() }),
  useProjectCommittedSpend: () => ({ data: 0, isPending: false, isError: false, refetch: vi.fn() }),
}));

vi.mock('@/src/hooks/useBudget', () => ({
  useProjectBudget: () => ({ data: 0, isPending: false, isError: false, refetch: vi.fn() }),
  useBudgetVersions: () => ({ data: [], isPending: false, isError: false, refetch: vi.fn() }),
  useBudgetActivationMode: () => ({ data: undefined, isPending: false, isError: false }),
  useBudgetMutations: () => ({
    createVersion: { mutateAsync: vi.fn() }, activate: { mutateAsync: vi.fn() },
    archive: { mutateAsync: vi.fn() }, cloneVersion: { mutateAsync: vi.fn() },
    deleteDraft: { mutateAsync: vi.fn() }, createLineItem: { mutateAsync: vi.fn() },
    deleteLineItem: { mutateAsync: vi.fn() },
  }),
}));

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

vi.mock('@/src/hooks/useDocuments', () => ({
  useDocuments: () => ({ data: [], isPending: false, isError: false, refetch: vi.fn() }),
  useDocumentMutations: () => ({
    create: { mutateAsync: vi.fn(), isPending: false },
    update: { mutateAsync: vi.fn(), isPending: false },
    transition: { mutateAsync: vi.fn(), isPending: false },
    remove: { mutateAsync: vi.fn(), isPending: false },
  }),
}));

vi.mock('@/src/auth/useAuth', () => ({
  useAuth: () => ({ currentUser: { id: 'u-pm', org_id: 'org-1' }, role: 'Project Manager' }),
}));

vi.mock('@/src/auth/impersonation', () => ({
  useEffectiveRole: () => ({ effectiveRole: 'Project Manager', realRole: 'Project Manager' }),
}));

vi.mock('@/src/lib/db/projectTransitions', async (orig) => {
  const actual = await (orig() as Promise<Record<string, unknown>>);
  return { ...actual, transitionProject: vi.fn().mockResolvedValue(undefined) };
});

vi.mock('@tanstack/react-query', async (orig) => {
  const actual = await (orig() as Promise<Record<string, unknown>>);
  return { ...actual, useQueryClient: () => ({ invalidateQueries: vi.fn() }) };
});

const navigate = vi.fn();
vi.mock('react-router', async (orig) => {
  const actual = await (orig() as Promise<Record<string, unknown>>);
  return { ...actual, useNavigate: () => navigate };
});

// ── render helper ────────────────────────────────────────────────────────────
const freshClient = () => new QueryClient({ defaultOptions: { queries: { retry: false } } });
const renderAt = async (path: string) => {
  const pathname = path.split('?')[0];
  const breadcrumb = breadcrumbForPath(pathname, oppRecord.name, navigate, true);
  const view = render(
    <QueryClientProvider client={freshClient()}>
      <MemoryRouter initialEntries={[path]}>
        <ToastProvider>
          <PageFrame breadcrumb={breadcrumb} returnLabel="Projects">
            <Routes>
              <Route path="/projects/:projectId" element={<ProjectDetail />} />
              <Route path="/projects/:projectId/:tab" element={<ProjectDetail />} />
            </Routes>
          </PageFrame>
        </ToastProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  await waitFor(() => expect(screen.queryByTestId('project-detail-panel-loading')).not.toBeInTheDocument(), { timeout: 10_000 });
  return view;
};

// ── tests ────────────────────────────────────────────────────────────────────
describe('AC-IFW-RECORD-01: pre-win detail — commercial evidence and actions without delivery planning', () => {
  beforeEach(() => {
    projectsState.data = [];
    projectsState.isPending = false;
    projectsState.isError = false;
    milestonesState.data = [];
    navigate.mockClear();
  });

  it('AC-IFW-RECORD-01 / R-033: pre-win record keeps its journey and excludes delivery planning', async () => {
    await renderAt('/projects/opp1');
    expect(screen.getByLabelText('Project stage journey')).toBeInTheDocument();
    expect(screen.getByText('Project journey')).toBeInTheDocument();
    expect(screen.queryByTestId('prewin-compact-planner')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Plan delivery phases/i })).not.toBeInTheDocument();
  });

  it('AC-IFW-RECORD-01 / R-007: the selected Overview section controls its commercial tabpanel', async () => {
    await renderAt('/projects/opp1');
    const selected = screen.getByRole('tab', { name: 'Overview', selected: true });
    const panel = screen.getByRole('tabpanel', { name: 'Overview' });
    expect(selected).toHaveAttribute('aria-controls', panel.id);
    expect(within(panel).getByLabelText('Project stage journey')).toBeInTheDocument();
  });

  it('AC-IFW-RECORD-01: pre-win record does NOT render the "Progress curve" (S-curve hidden for pre-win)', async () => {
    await renderAt('/projects/opp1');

    // The S-curve heading must not be present for a pre-win record
    expect(screen.queryByText('Progress curve')).toBeNull();
  });

  it('SUB-I: pre-win classification lives in the closed rail disclosure with the codes — no standalone Classification block', async () => {
    await renderAt('/projects/opp1');
    expect(screen.queryByText('Classification')).not.toBeInTheDocument();
    const rail = screen.getByTestId('project-detail-rail');
    expect(rail.querySelector('details')).not.toHaveAttribute('open');
    expect(rail.querySelector('summary')).toHaveTextContent('Details');
    expect(within(rail).getByText('Engineering')).toBeInTheDocument();
    // a deal has no delivery status action: lifecycle changes belong to the pipeline lens
    expect(within(rail).queryByRole('button', { name: /change status/i })).not.toBeInTheDocument();
  });

  it('AC-IFW-RECORD-01: pre-win record renders the Advance / Mark won / Mark lost sales levers', async () => {
    await renderAt('/projects/opp1');

    // The sales action buttons from PipelineLens must be visible
    expect(screen.getByRole('button', { name: /Advance to/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Mark won/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Mark lost/i })).toBeInTheDocument();
  });

  it('AC-IFW-RECORD-01 / R-033: pre-win does not offer delivery planning before the win, including the "Plan this project\'s delivery phases" band', async () => {
    // milestonesState.data = [] (from beforeEach) — empty planner, pre-win record
    await renderAt('/projects/opp1');

    // The full EmptyPlanningPrompt heading must NOT be visible on pre-win
    expect(screen.queryByText(/Plan this project's delivery phases/i)).not.toBeInTheDocument();

    expect(screen.queryByTestId('prewin-compact-planner')).not.toBeInTheDocument();
  });

  it('SUB-A: a pre-win record has no Work orders or Billing tab, and their URLs fall back to Overview', async () => {
    await renderAt('/projects/opp1');
    const tabs = within(screen.getByRole('tablist', { name: /Project sections/i })).getAllByRole('tab').map((tab) => tab.textContent);
    expect(tabs).not.toContain('Work orders');
    expect(tabs).not.toContain('Billing');
    expect(tabs).toEqual(expect.arrayContaining(['Overview', 'Budget', 'Procurement', 'Tasks', 'Documents']));
  });

  it('SUB-A: deep-linking a pre-win record to /work-orders shows Overview instead', async () => {
    await renderAt('/projects/opp1/work-orders');
    expect(screen.getByRole('tab', { name: 'Overview', selected: true })).toBeInTheDocument();
    expect(screen.getByLabelText('Project stage journey')).toBeInTheDocument();
    expect(screen.queryByTestId('prewin-compact-planner')).not.toBeInTheDocument();
  });
});
