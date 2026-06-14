/**
 * AC-IFW-RECORD-01 — Pre-win detail: sales levers (PipelineLens) render ABOVE the delivery
 * planner (MilestoneStrip) and ABOVE the S-curve; and the S-curve is hidden for pre-win records.
 *
 * Lens-D regression invariant: a pre-win record renders the Opportunity-journey stepper and
 * Next-actions (sales levers) BEFORE the delivery phases section AND before the "Progress curve"
 * heading. The empty S-curve is not rendered at all for pre-win records.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
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

// ── module mocks ─────────────────────────────────────────────────────────────
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

vi.mock('@/src/lib/db/opportunity', () => ({
  // The pre-win record is NOT in the active cache (projectsState=[]) — falls back to useOpportunity.
  // Use 'Tender Submitted' so legal targets include 'Won, Pending KoM' (enabling the Mark won button).
  useOpportunity: () => ({
    data: {
      id: 'opp1',
      name: 'Alpha Solar Bid',
      code: 'OPP-0001',
      status: 'Tender Submitted',
      client_id: 'c1',
      project_manager_id: 'u-pm',
      contract_value: 500000,
      start_date: null,
      end_date: null,
      contract_date: null,
      customer_contract_ref: null,
      client: { name: 'Alpha Corp' },
      pm: { full_name: 'PM Name' },
    },
    isPending: false,
  }),
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
  useProjectCommittedSpend: () => ({ data: 0, isPending: false, isError: false, refetch: vi.fn() }),
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
vi.mock('react-router-dom', async (orig) => {
  const actual = await (orig() as Promise<Record<string, unknown>>);
  return { ...actual, useNavigate: () => navigate };
});

// ── render helper ────────────────────────────────────────────────────────────
const freshClient = () => new QueryClient({ defaultOptions: { queries: { retry: false } } });
const renderAt = (path: string) =>
  render(
    <QueryClientProvider client={freshClient()}>
      <MemoryRouter initialEntries={[path]}>
        <ToastProvider>
          <Routes>
            <Route path="/projects/:projectId" element={<ProjectDetail />} />
          </Routes>
        </ToastProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );

// ── tests ────────────────────────────────────────────────────────────────────
describe('AC-IFW-RECORD-01: pre-win detail layout — sales levers above delivery planner and S-curve', () => {
  beforeEach(() => {
    projectsState.data = [];
    projectsState.isPending = false;
    projectsState.isError = false;
    milestonesState.data = [];
    navigate.mockClear();
  });

  it('AC-IFW-RECORD-01: pre-win record renders PipelineLens (Opportunity journey / Next actions) BEFORE the Delivery phases section', () => {
    renderAt('/projects/opp1');

    // The PipelineLens "Deal stage journey" stepper must be in the DOM
    const dealJourney = screen.getByLabelText('Deal stage journey');
    // The "Opportunity journey" heading in PipelineLens card
    const opportunityJourneyHeading = screen.getByText('Opportunity journey');

    expect(dealJourney).toBeInTheDocument();
    expect(opportunityJourneyHeading).toBeInTheDocument();

    // T1: The prewin-compact-planner affordance is always present (M2 implementation — the compact
    // one-liner always renders for a pre-win empty planner, making the ordering check unconditional).
    // The compact div renders AFTER the PipelineLens in document order.
    const compactPlanner = screen.getByTestId('prewin-compact-planner');
    expect(compactPlanner).toBeInTheDocument();

    // The compact planner must come AFTER the "Opportunity journey" heading in document order.
    const pos = opportunityJourneyHeading.compareDocumentPosition(compactPlanner);
    // DOCUMENT_POSITION_FOLLOWING (4): compactPlanner comes AFTER opportunityJourneyHeading
    expect(pos & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('AC-IFW-RECORD-01: pre-win record does NOT render the "Progress curve" (S-curve hidden for pre-win)', () => {
    renderAt('/projects/opp1');

    // The S-curve heading must not be present for a pre-win record
    expect(screen.queryByText('Progress curve')).toBeNull();
  });

  it('AC-IFW-RECORD-01: pre-win record renders the Advance / Mark won / Mark lost sales levers', () => {
    renderAt('/projects/opp1');

    // The sales action buttons from PipelineLens must be visible
    expect(screen.getByRole('button', { name: /Advance to/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Mark won/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Mark lost/i })).toBeInTheDocument();
  });

  it('AC-IFW-RECORD-01 (M2): pre-win + empty planner renders a compact one-line affordance, NOT the full "Plan this project\'s delivery phases" band', () => {
    // milestonesState.data = [] (from beforeEach) — empty planner, pre-win record
    renderAt('/projects/opp1');

    // The full EmptyPlanningPrompt heading must NOT be visible on pre-win
    expect(screen.queryByText(/Plan this project's delivery phases/i)).not.toBeInTheDocument();

    // A compact affordance (one-liner) must be present instead
    expect(screen.getByTestId('prewin-compact-planner')).toBeInTheDocument();
  });
});
