/**
 * AC-IFW-RECORD-02 — Delivery project: the tab bar (tablist) renders BEFORE the "Progress curve"
 * (S-curve), so the actionable tab surface is above the fold.
 *
 * Lens-D regression invariant: a delivery project renders getByRole('tablist') BEFORE the S-curve
 * "Progress curve" heading in document order.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import { ToastProvider } from '@/src/components/ui';
import ProjectDetail from '../ProjectDetail';
import type { ProjectWithRefs } from '@/src/lib/db/projects';
import type { MilestoneWithProgress } from '@/src/lib/db/milestones';

// ── shared mutable state ─────────────────────────────────────────────────────
const projectsState = {
  data: [] as ProjectWithRefs[],
  isPending: false,
  isError: false,
  refetch: vi.fn(),
};

const milestonesState = {
  data: [] as MilestoneWithProgress[],
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
  useOpportunity: () => ({ data: undefined, isPending: false }),
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

const navigate = vi.fn();
vi.mock('react-router-dom', async (orig) => {
  const actual = await (orig() as Promise<Record<string, unknown>>);
  return { ...actual, useNavigate: () => navigate };
});

// ── delivery project fixture ─────────────────────────────────────────────────
const deliveryRow: ProjectWithRefs = {
  id: 'del1',
  name: 'Meridian Office Build',
  code: 'PRJ-101',
  status: 'Ongoing Project',
  client_id: 'c1',
  project_manager_id: 'u-pm',
  contract_value: 3000000,
  budget: 2800000,
  spent: 1000000,
  start_date: '2026-01-01',
  end_date: '2026-12-31',
  contract_date: '2026-01-05',
  customer_contract_ref: 'REF-101',
  archived_at: null,
  created_at: '2026-01-01T00:00:00Z',
  last_update: '2026-01-01T00:00:00Z',
  org_id: 'org-1',
  client: { name: 'Meridian Corp' },
  pm: { full_name: 'PM Name' },
} as unknown as ProjectWithRefs;

const milestonePhases: MilestoneWithProgress[] = [
  {
    id: 'm1',
    name: 'Foundation',
    project_id: 'del1',
    target_date: '2026-06-30',
    weight: 50,
    input_pct: 60,
    effective_pct: 60,
    task_count: 2,
    org_id: 'org-1',
    created_at: '2026-01-01T00:00:00Z',
  } as unknown as MilestoneWithProgress,
];

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

// ── tests ─────────────────────────────────────────────────────────────────────
describe('AC-IFW-RECORD-02: delivery project — tab bar renders before the S-curve', () => {
  beforeEach(() => {
    projectsState.data = [deliveryRow];
    projectsState.isPending = false;
    projectsState.isError = false;
    milestonesState.data = milestonePhases;
    navigate.mockClear();
  });

  it('AC-IFW-RECORD-02: the tablist (Project sections) appears BEFORE "Progress curve" in document order', () => {
    renderAt('/projects/del1');

    const tablist = screen.getByRole('tablist', { name: /project sections/i });
    const progressCurveHeading = screen.getByText('Progress curve');

    // tablist must come BEFORE the S-curve heading in the DOM
    // compareDocumentPosition returns DOCUMENT_POSITION_FOLLOWING (4) if the argument
    // comes AFTER the node — i.e., the S-curve heading follows the tablist.
    const pos = tablist.compareDocumentPosition(progressCurveHeading);
    expect(pos & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('AC-IFW-RECORD-02: the S-curve IS rendered for a delivery project (data available)', () => {
    renderAt('/projects/del1');

    // For a delivery project with milestones, the S-curve should be present
    expect(screen.getByText('Progress curve')).toBeInTheDocument();
  });

  it('AC-IFW-RECORD-02: the PipelineLens deal banner is NOT rendered for a delivery project', () => {
    renderAt('/projects/del1');

    expect(screen.queryByLabelText('Project stage journey')).toBeNull();
    expect(screen.queryByRole('button', { name: /Advance to/i })).toBeNull();
  });
});
