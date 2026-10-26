/** Role-invariant default route and named money-group accessibility on the full page. */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import { renderWithQueryClient as render } from '@/test/renderWithQueryClient';
import { MemoryRouter, Route, Routes } from 'react-router';
import React from 'react';
import { ImpersonationProvider } from '@/src/auth/impersonation';
import { ToastProvider } from '@/src/components/ui';
import type { Role } from '@/src/auth/AuthContext';
import type { ProjectWithRefs } from '@/src/lib/db/projects';

vi.mock('@/src/hooks/useProjectFinances', () => ({ useProjectFinances: () => ({ data: { project_id: 'p1', contract_invoiced: null, remaining_to_invoice: null, invoices: [], budget: null, actuals: { currency: null, as_of: null, total: null, excludes_restricted_rows: false, categories: [] } }, isPending: false, isError: false, refetch: vi.fn() }) }));
vi.mock('@/src/hooks/useProjectVatEditability', () => ({ useProjectVatEditability: () => ({ data: { eligible: true, reason: null, hasInvoices: false }, isPending: false, isFetching: false, isError: false, refetch: vi.fn() }) }));
vi.mock('@/src/hooks/useOrgCurrency', () => ({ useOrgCurrency: () => 'USD', useOrgCurrencyState: () => ({ currency: 'USD', isResolved: true, isError: false }) }));
vi.mock('@/src/hooks/useFxOrgDay', () => ({ useFxOrgDay: () => ({ day: '2026-10-12', isPending: false, isError: false, retry: vi.fn() }) }));
vi.mock('@/src/hooks/useFxRates', () => ({ useFxRate: () => ({ data: null, isPending: false, isError: false, refetch: vi.fn() }) }));

// ── Mutable data box — lets each test control the project list ────────────────
const { projectsBox } = vi.hoisted(() => ({
  projectsBox: { data: [] as ProjectWithRefs[], isPending: false },
}));

// ── Module mocks ──────────────────────────────────────────────────────────────

// #566: the Overview tab renders <ProjectDrawdown>, whose data states are covered separately.
// Keep it in its loading state here so it contributes no text of its own to position assertions.
vi.mock('@/src/hooks/useRevenue', async (orig) => ({
  ...(await orig<typeof import('@/src/hooks/useRevenue')>()),
  useSalesInvoices: () => ({ data: [], isPending: false, isError: false, refetch: vi.fn() }),
}));

vi.mock('@/src/hooks/useWorkOrders', () => ({
  useProjectDrawdown: () => ({ data: null, isPending: true, isError: false, refetch: vi.fn() }),
}));

vi.mock('@/src/hooks/useProjects', () => ({
  useProjects: () => ({ data: projectsBox.data, isPending: projectsBox.isPending }),
  // #840: the detail route reads ONE project by id (any stage), never the whole list.
  useProject: (id: string) => {
    const l = (({ data: projectsBox.data, isPending: projectsBox.isPending })) as { data?: { id: string }[] | null; isPending?: boolean; isError?: boolean; refetch?: () => void };
    return { isPending: false, isError: false, refetch: vi.fn(), ...l, data: (l.data ?? []).find((p) => p.id === id) ?? null };
  },
  useClientCompanies: () => ({ data: [], isError: false }),
  useProjectManagers: () => ({ data: [], isError: false }),
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

vi.mock('@/src/auth/useAuth', () => ({
  useAuth: () => ({ currentUser: { id: 'u-alice', org_id: 'org-1' }, role: 'Project Manager' }),
}));

vi.mock('@tanstack/react-query', async (orig) => {
  const actual = await (orig() as Promise<Record<string, unknown>>);
  return { ...actual, useQueryClient: () => ({ invalidateQueries: vi.fn() }) };
});

vi.mock('@/src/hooks/useProjectFinances', () => ({ useProjectFinances: () => ({ data: undefined, isPending: false, isError: false }) }));
vi.mock('@/src/hooks/useBudget', () => ({
  useProjectBudget: () => ({ data: 0, isPending: false, isError: false, refetch: vi.fn() }),
  useBudgetVersions: () => ({ data: [], isPending: false, isError: false, refetch: vi.fn() }),
  useBudgetMutations: () => ({
    createVersion: { mutateAsync: vi.fn() },
    activate: { mutateAsync: vi.fn() },
    archive: { mutateAsync: vi.fn() },
    cloneVersion: { mutateAsync: vi.fn() },
    deleteDraft: { mutateAsync: vi.fn() },
    createLineItem: { mutateAsync: vi.fn() },
    deleteLineItem: { mutateAsync: vi.fn() },
  }),
}));

vi.mock('@/src/hooks/useProcurements', () => ({
  useProcurements: () => ({ data: [], isPending: false, isError: false, refetch: vi.fn() }),
  useProjectProcurements: () => ({ data: [], isPending: false, isError: false, refetch: vi.fn() }),
  useProjectCommittedSpend: () => ({ data: 2_100_000, isPending: false, isError: false, refetch: vi.fn() }),
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
vi.mock('@/src/hooks/useMilestones', () => ({
  useMilestones: () => ({ data: [], isPending: false, isError: false, refetch: vi.fn() }),
  useMilestoneMutations: () => ({
    create: { mutateAsync: vi.fn(), isPending: false },
    update: { mutateAsync: vi.fn(), isPending: false },
    remove: { mutateAsync: vi.fn(), isPending: false },
    setTaskMilestone: { mutateAsync: vi.fn(), isPending: false },
  }),
}));

vi.mock('@/src/lib/db/projectTransitions', async (orig) => {
  const actual = await (orig() as Promise<Record<string, unknown>>);
  return { ...actual, transitionProject: vi.fn().mockResolvedValue(undefined) };
});

vi.mock('@/src/hooks/useDashboard', () => ({
  useSalesPipeline: () => ({ data: { stages: [], projects: [] } }),
}));

const navigate = vi.fn();
vi.mock('react-router', async (orig) => {
  const actual = await (orig() as Promise<Record<string, unknown>>);
  return { ...actual, useNavigate: () => navigate };
});

// ── Fixture ───────────────────────────────────────────────────────────────────

const onHandRow: ProjectWithRefs = {
  id: 'p1',
  name: 'Innovate Corp HQ Fit-Out',
  code: 'PRJ-001',
  status: 'Ongoing Project',
  client_id: 'c2',
  project_manager_id: 'u-alice',
  contract_value: 5_000_000,
  currency: 'USD',
  budget: 4_700_000,
  spent: 2_100_000,
  start_date: '2026-01-01',
  end_date: '2026-12-18',
  contract_date: '2026-01-10',
  customer_contract_ref: 'CPO-2026-001',
  client: { name: 'Innovate Corp' },
  pm: { full_name: 'Alice Manager' },
} as unknown as ProjectWithRefs;

// ── Render helper ─────────────────────────────────────────────────────────────

import ProjectDetail from '../ProjectDetail';

vi.mock('@/src/components/comments/CommentsSection', () => ({ CommentsSection: () => null }));
// ProjectErpLink reads the org's ERP binding through react-query; it has its own test (AC-SETUP-001).
vi.mock('@/pages/project-detail/ProjectErpLink', () => ({ ProjectErpLink: () => null }));

/**
 * Render the full ProjectDetail page on a selected route for a given real role.
 */
const renderPage = async (realRole: Role, path = '/projects/p1/overview') => {
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
  await waitFor(() => expect(screen.queryByTestId('project-detail-panel-loading')).not.toBeInTheDocument(), { timeout: 60_000 });
  return view;
};

beforeEach(() => {
  projectsBox.data = [onHandRow];
  projectsBox.isPending = false;
  navigate.mockClear();
});

// ═════════════════════════════════════════════════════════════════════════════
// AC-IXD-PROJ-W5-C3 D15 — Rendered DOM position (full-page render)
// ═════════════════════════════════════════════════════════════════════════════

describe('AC-PD-OV-01: role-invariant Overview money position', () => {
  it.each(['Engineer', 'Project Manager'] as const)(
    'CW-7 opens the same Overview money position for %s on the base project route',
    async (role) => {
      await renderPage(role, '/projects/p1');

      const navigation = screen.getByRole('navigation', { name: 'Project sections' });
      expect(within(navigation).getByRole('link', { name: 'Overview' })).toHaveAttribute('aria-current', 'page');
      const position = screen.getByRole('region', { name: 'Money position' });
      expect(within(position).getByTestId('overview-contract-value')).toBeInTheDocument();
      expect(within(position).getByRole('group', { name: 'Spending' })).toBeInTheDocument();
    },
  );
});
