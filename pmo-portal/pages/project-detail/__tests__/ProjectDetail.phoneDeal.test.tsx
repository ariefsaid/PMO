/**
 * #2421 — the deal page on a phone: one menu name per language, the stage shown once.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import { ToastProvider } from '@/src/components/ui';
import ProjectDetail from '../ProjectDetail';
import type { ProjectWithRefs } from '@/src/lib/db/projects';
import { repositories } from '@/src/lib/repositories';

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
// The signed-in role (real JWT role); PM by default, switched per test.
const session = vi.hoisted(() => ({ role: 'Project Manager' }));

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
vi.mock('@/src/hooks/useProjectOverviewRead', () => ({ useProjectOverviewRead: () => ({ isLoading: false }) }));
vi.mock('../BillingMilestonesBlock', () => ({ BillingMilestonesBlock: () => null }));
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
    returnVersion: { mutateAsync: vi.fn(), isPending: false },
    resubmitVersion: { mutateAsync: vi.fn(), isPending: false },
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
    archive: { mutateAsync: vi.fn(), isPending: false },
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
  useAuth: () => ({ currentUser: { id: 'u-pm', org_id: 'org-1' }, role: session.role }),
}));

vi.mock('@/src/auth/impersonation', () => ({
  useEffectiveRole: () => ({ effectiveRole: session.role, realRole: session.role }),
}));

vi.mock('@/src/lib/db/projectTransitions', async (orig) => {
  const actual = await (orig() as Promise<Record<string, unknown>>);
  return { ...actual, transitionProject: vi.fn().mockResolvedValue(undefined) };
});

vi.mock('@tanstack/react-query', async (orig) => {
  const actual = await (orig() as Promise<Record<string, unknown>>);
  return { ...actual, useQueryClient: () => ({ invalidateQueries: vi.fn(), getQueryData: vi.fn() }) };
});

const navigate = vi.fn();
vi.mock('react-router', async (orig) => {
  const actual = await (orig() as Promise<Record<string, unknown>>);
  return { ...actual, useNavigate: () => navigate };
});

const phone = () => vi.stubGlobal('matchMedia', vi.fn().mockImplementation((query: string) => ({
  matches: false, media: query, onchange: null,
  addEventListener: vi.fn(), removeEventListener: vi.fn(), addListener: vi.fn(), removeListener: vi.fn(), dispatchEvent: vi.fn(),
})));

const renderPhone = async () => {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={['/projects/opp1']}>
        <ToastProvider>
          <Routes><Route path="/projects/:projectId" element={<ProjectDetail />} /></Routes>
        </ToastProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  const panel = screen.getByRole('tabpanel');
  await waitFor(() => expect(within(panel).queryByTestId('project-detail-panel-loading')).not.toBeInTheDocument());
};

describe('#2421: the deal page at phone width', () => {
  beforeEach(() => {
    phone();
    session.role = 'Project Manager';
    vi.spyOn(repositories.project, 'winEligibility').mockResolvedValue('allowed');
  });
  afterEach(() => vi.unstubAllGlobals());

  it('#2421: the page carries every menu once, and no two buttons share a name', async () => {
    await renderPhone();
    const names = screen.getAllByRole('button').map((b) => b.getAttribute('aria-label') ?? b.textContent?.trim() ?? '').filter((n) => /actions/i.test(n));
    expect(new Set(names).size).toBe(names.length);
  });

  it('#2421: the stage is read once on the phone band', async () => {
    await renderPhone();
    expect(screen.getAllByText(/^tender submitted$/i)).toHaveLength(1);
  });

  it('#2421: Mark lost is tapped from the phone menu and asks for a reason', async () => {
    await renderPhone();
    await userEvent.click(screen.getByRole('button', { name: 'More actions' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: /Mark lost/i }));
    expect(await screen.findByRole('alertdialog')).toBeInTheDocument();
  });
});

describe('#2421: one Bahasa term for the More actions menu', () => {
  it('#2421: every "More actions" string in Bahasa is the same words', async () => {
    const read = async (ns: string) => (await import(`../../../public/locales/id/${ns}.json`)).default;
    const common = await read('common');
    const project = await read('project');
    const finance = await read('finance');
    const terms = new Set([common.uxs14.moreActions, project.projectDetail.pipeline.moreActions, finance.receivables.moreActions]);
    expect([...terms]).toEqual(['Tindakan lainnya']);
  });
});
