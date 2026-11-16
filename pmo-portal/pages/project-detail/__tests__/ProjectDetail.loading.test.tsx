/** AC-NBR-007: the project shell renders while the overview read lands. */
import { beforeEach, describe, it, expect, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import { renderWithQueryClient as render } from '@/test/renderWithQueryClient';
import { MemoryRouter, Route, Routes } from 'react-router';
import React from 'react';
import { ImpersonationProvider } from '@/src/auth/impersonation';
import { ToastProvider } from '@/src/components/ui';
import type { Role } from '@/src/auth/AuthContext';
const overviewState = vi.hoisted(() => ({ isLoading: true }));
vi.mock('@/src/hooks/useProjectOverviewRead', () => ({ useProjectOverviewRead: () => ({ isLoading: overviewState.isLoading }) }));
vi.mock('../BillingMilestonesBlock', () => ({ BillingMilestonesBlock: () => null }));
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

// Controlled timing for the one genuinely lazy panel in this fixture (#1198). Everything the
// Overview composes is stubbed synchronously, so Materials is the only chunk whose import can
// still be in flight when a render settles; holding it open reproduces a cold chunk import on
// demand instead of depending on machine load.
const materialsChunk = vi.hoisted(() => {
  let release: (() => void) | undefined;
  let ready = false;
  const gate = new Promise<void>((resolve) => {
    release = () => {
      ready = true;
      resolve();
    };
  });
  return { gate, isReady: () => ready, release: () => release?.() };
});

// Stub tab contents — we only test which tab is active, not what's inside them.
vi.mock('../tabs/MaterialsTab', () => ({
  default: () => {
    if (!materialsChunk.isReady()) throw materialsChunk.gate;
    return <div data-testid="tab-materials">Materials</div>;
  },
}));
vi.mock('../tabs/BudgetTab', () => ({ default: () => <div data-testid="tab-budget">Budget</div> }));
vi.mock('../tabs/ProcurementTab', () => ({ default: () => <div data-testid="tab-procurement">Procurement</div> }));
vi.mock('../tabs/TasksTab', () => ({ default: () => <div data-testid="tab-tasks">Tasks</div> }));
vi.mock('../tabs/DocumentsTab', () => ({ default: () => <div data-testid="tab-documents">Documents</div> }));
vi.mock('../../sales/DealBand', () => ({ default: () => <div>Pipeline</div> }));
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
vi.mock('@/src/hooks/useProjectPosition', () => ({
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

const detailRoute = (realRole: Role, path: string) => (
  <ImpersonationProvider realRole={realRole}>
    <ToastProvider>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/projects/:projectId/:tab" element={<ProjectDetail />} />
          <Route path="/projects/:projectId" element={<ProjectDetail />} />
        </Routes>
      </MemoryRouter>
    </ToastProvider>
  </ImpersonationProvider>
);

const renderAs = (realRole: Role, path: string) => render(detailRoute(realRole, path));

beforeEach(() => { overviewState.isLoading = true; });

describe('AC-NBR-007 project shell renders while the overview read is pending', () => {
  it('shows the header and tabs at once; only the content region is loading', async () => {
    renderAs('Project Manager', '/projects/p1');
    expect(screen.getByTestId('stubbed-header')).toBeInTheDocument();
    expect(screen.getByRole('tablist', { name: /project sections/i })).toBeInTheDocument();
    const panel = screen.getByRole('tabpanel');
    expect(within(panel).getByTestId('project-detail-panel-loading')).toBeInTheDocument();
  });

  it('does not unmount the header or tablist when the overview settles', async () => {
    const view = renderAs('Project Manager', '/projects/p1');
    const header = screen.getByTestId('stubbed-header');
    const tablist = screen.getByRole('tablist', { name: /project sections/i });
    overviewState.isLoading = false;
    view.rerender(detailRoute('Project Manager', '/projects/p1'));
    await waitFor(() => expect(within(screen.getByRole('tabpanel')).queryByTestId('project-detail-panel-loading')).not.toBeInTheDocument());
    expect(screen.getByTestId('stubbed-header')).toBe(header);
    expect(screen.getByRole('tablist', { name: /project sections/i })).toBe(tablist);
  });

  it('a non-overview tab never waits on the overview read', async () => {
    renderAs('Project Manager', '/projects/p1/tasks');
    expect(await screen.findByTestId('tab-tasks')).toBeInTheDocument();
  });
});
