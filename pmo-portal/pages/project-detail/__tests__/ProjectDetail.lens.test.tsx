import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import React from 'react';
import { ToastProvider } from '@/src/components/ui';
import ProjectDetail from '../ProjectDetail';
import type { ProjectWithRefs } from '@/src/lib/db/projects';

/**
 * AC-IXD-PROJ-004 (Model B canonical route, ADR-0020) + AC-IXD-PROJ-008 (UNIFIED page, ADR-0021,
 * supersedes ADR-0020 §1): `/projects/:id` is the ONE canonical detail route and renders the FULL
 * project detail layout (header + the five delivery tabs) at EVERY stage.
 *
 *  - pipeline (pre-win) → the delivery tabs (Overview/Budget/Procurement/Tasks/Documents) ARE
 *    rendered AND the PipelineLens deal banner (stepper + Advance/Mark won/Mark lost) renders
 *    ABOVE them, so a PM can plan budget/tasks/procurement while pursuing the deal. The delivery
 *    stat tiles + contract-value SoD editor stay delivery-only (the deal figures live in the banner).
 *  - onHand → the delivery tabs + SoD editor ARE rendered; the deal banner is NOT.
 */

const projectsState = {
  data: [] as ProjectWithRefs[],
  isPending: false,
  isError: false,
  refetch: vi.fn(),
};

const pipelineState = {
  data: { stages: [], projects: [] as Array<Record<string, unknown>> },
  isPending: false,
  isError: false,
};

vi.mock('@/src/hooks/useProjects', () => ({
  useProjects: () => projectsState,
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
vi.mock('@/src/hooks/useDashboard', () => ({ useSalesPipeline: () => pipelineState }));
// PipelineLens calls useQueryClient to invalidate after a transition.
vi.mock('@tanstack/react-query', async (orig) => {
  const actual = await (orig() as Promise<Record<string, unknown>>);
  return { ...actual, useQueryClient: () => ({ invalidateQueries: vi.fn() }) };
});
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
vi.mock('@/src/lib/db/projectTransitions', async (orig) => {
  const actual = await (orig() as Promise<Record<string, unknown>>);
  return { ...actual, transitionProject: vi.fn().mockResolvedValue(undefined) };
});
vi.mock('@/src/auth/useAuth', () => ({
  useAuth: () => ({ currentUser: { id: 'u-alice', org_id: 'org-1' }, role: 'Project Manager' }),
}));
vi.mock('@/src/auth/impersonation', () => ({
  useEffectiveRole: () => ({ effectiveRole: 'Project Manager', realRole: 'Project Manager' }),
}));
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
  useProjectCommittedSpend: () => ({ data: 0, isPending: false, isError: false, refetch: vi.fn() }),
}));
vi.mock('@/src/hooks/useTasks', () => ({
  useTasks: () => ({ data: [], isPending: false, isError: false, refetch: vi.fn() }),
  useAssignableProfiles: () => ({ data: [], isPending: false, isError: false }),
  useTaskMutations: () => ({
    create: { mutateAsync: vi.fn(), isPending: false }, update: { mutateAsync: vi.fn(), isPending: false },
    updateStatus: { mutateAsync: vi.fn(), isPending: false }, remove: { mutateAsync: vi.fn(), isPending: false },
    addDependency: { mutateAsync: vi.fn(), isPending: false }, removeDependency: { mutateAsync: vi.fn(), isPending: false },
  }),
}));
vi.mock('@/src/hooks/useDocuments', () => ({
  useDocuments: () => ({ data: [], isPending: false, isError: false, refetch: vi.fn() }),
  useDocumentMutations: () => ({
    create: { mutateAsync: vi.fn(), isPending: false }, update: { mutateAsync: vi.fn(), isPending: false },
    transition: { mutateAsync: vi.fn(), isPending: false }, remove: { mutateAsync: vi.fn(), isPending: false },
  }),
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
const navigate = vi.fn();
vi.mock('react-router-dom', async (orig) => {
  const actual = await (orig() as Promise<Record<string, unknown>>);
  return { ...actual, useNavigate: () => navigate };
});

const onHandRow = {
  id: 'p1', name: 'Innovate Corp HQ Fit-Out', code: 'PRJ-001', status: 'Ongoing Project',
  client_id: 'c2', project_manager_id: 'u-alice', contract_value: 5000000, budget: 4700000,
  spent: 2100000, start_date: '2026-01-01', end_date: '2026-12-18', contract_date: '2026-01-10',
  customer_contract_ref: 'CPO-2026-001', client: { name: 'Innovate Corp' }, pm: { full_name: 'Alice Manager' },
} as unknown as ProjectWithRefs;

const pipelineRow = {
  id: 'd1', name: 'Acme Tender Bid', code: 'OPP-0042', status: 'Tender Submitted',
  client_id: 'c1', project_manager_id: 'u-alice', contract_value: 1200000, budget: 0,
  spent: 0, start_date: null, end_date: null, contract_date: null,
  customer_contract_ref: null, client: { name: 'Acme' }, pm: { full_name: 'Alice Manager' },
} as unknown as ProjectWithRefs;

// A manager (PM real role) viewing a deal sees the pipeline lens's lifecycle controls
// (A-1 gate = Admin·Exec·PM). The role reaches usePermission via the mocked useEffectiveRole
// (above) → 'Project Manager', so the journey (lifecycle controls shown) is preserved.
const renderAt = (path: string) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <ToastProvider>
        <Routes>
          <Route path="/projects/:projectId" element={<ProjectDetail />} />
        </Routes>
      </ToastProvider>
    </MemoryRouter>,
  );

beforeEach(() => {
  navigate.mockClear();
  projectsState.data = [];
  projectsState.isPending = false;
  pipelineState.data = { stages: [], projects: [] };
});

describe('ProjectDetail — stage-adaptive lens (AC-IXD-PROJ-004)', () => {
  it('AC-IXD-PROJ-004: an ON-HAND record renders the delivery tabs + the contract-value SoD editor (no pipeline lens)', () => {
    projectsState.data = [onHandRow];
    renderAt('/projects/p1');

    // header is shared across lenses
    expect(screen.getByRole('heading', { name: 'Innovate Corp HQ Fit-Out' })).toBeInTheDocument();
    // delivery lens: the 5 section tabs are present
    expect(screen.getByRole('tablist', { name: /project sections/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Budget' })).toBeInTheDocument();
    // the contract-value SoD editor row is mounted on a won/on-hand project
    expect(screen.getByTestId('contract-value-sod')).toBeInTheDocument();
    // the pipeline lens is NOT mounted
    expect(screen.queryByLabelText('Project stage journey')).toBeNull();
    expect(screen.queryByRole('button', { name: /Advance to/i })).toBeNull();
  });

  it('AC-IXD-PROJ-008 (ADR-0021): a PIPELINE (pre-win) record renders the project journey banner ABOVE the full delivery tabs (so budget/tasks/procurement are reachable pre-win)', () => {
    projectsState.data = [pipelineRow];
    // the live status/value also flows through the pipeline cache
    pipelineState.data = {
      stages: [],
      projects: [{ id: 'd1', name: 'Acme Tender Bid', client_name: 'Acme', status: 'Tender Submitted', contract_value: 1200000, win_probability: 0.5 }],
    };
    renderAt('/projects/d1');

    // shared header
    expect(screen.getByRole('heading', { name: 'Acme Tender Bid' })).toBeInTheDocument();
    // project journey banner: project stage stepper + the Advance/Mark won/Mark lost affordances
    expect(screen.getByLabelText('Project stage journey')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Advance to/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Mark won/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Mark lost/i })).toBeInTheDocument();
    // ADR-0021: the delivery tabs ARE now mounted pre-win (the budget/tasks/procurement planning
    // surface a PM needs while pursuing the deal) — this is the override of ADR-0020 §1.
    expect(screen.getByRole('tablist', { name: /project sections/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Budget' })).toBeInTheDocument();
    // the contract-value SoD editor stays delivery-only (the deal's value lives in the banner).
    expect(screen.queryByTestId('contract-value-sod')).toBeNull();
  });
});
