import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { MemoryRouter, useLocation } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ToastProvider } from '@/src/components/ui';
import { FinanceI18nTestProvider } from './__tests__/financeI18nTestProvider';

const state = vi.hoisted(() => ({
  budget: { data: 0, isPending: false, isError: false, refetch: vi.fn() },
  versions: { data: [] as unknown[], isPending: false, isError: false, refetch: vi.fn() },
  position: { actualsPending: false, actualsError: false, refetchActuals: vi.fn(), hasBudget: true, canSeeActual: true, rows: [] as unknown[], unknown: 0 },
  procurements: { data: [] as unknown[], isPending: false, isError: false, refetch: vi.fn() },
  pushRows: [] as unknown[],
  projectionRows: [] as unknown[],
  fiscalYears: [{ fiscalYear: 'FY-2026', isActivePush: true }],
  retryPush: vi.fn().mockResolvedValue({ pushState: 'pushed' }),
  saveEtc: vi.fn().mockResolvedValue(undefined),
  releaseHold: vi.fn().mockResolvedValue(undefined),
  role: 'Project Manager',
  activate: vi.fn().mockResolvedValue({ pushState: 'pushed' }),
  archive: vi.fn().mockResolvedValue(undefined),
  clone: vi.fn().mockResolvedValue('v-clone'),
  deleteDraft: vi.fn().mockResolvedValue(undefined),
  createVersion: vi.fn().mockResolvedValue({ id: 'v-new' }),
  createLineItem: vi.fn().mockResolvedValue({ id: 'li-new' }),
  deleteLineItem: vi.fn().mockResolvedValue(undefined),
  updateLineItem: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/src/hooks/useBudget', () => ({
  useProjectBudget: () => state.budget,
  useBudgetVersions: () => state.versions,
  useBudgetActivationMode: () => ({ data: 'allowed', isPending: false, isError: false }),
  useBudgetMutations: () => ({
    createVersion: { mutateAsync: state.createVersion, isPending: false },
    cloneVersion: { mutateAsync: state.clone, isPending: false },
    activate: { mutateAsync: state.activate, isPending: false },
    archive: { mutateAsync: state.archive, isPending: false },
    deleteDraft: { mutateAsync: state.deleteDraft, isPending: false },
    createLineItem: { mutateAsync: state.createLineItem, isPending: false },
    updateLineItem: { mutateAsync: state.updateLineItem, isPending: false },
    deleteLineItem: { mutateAsync: state.deleteLineItem, isPending: false },
  }),
}));
vi.mock('@/src/hooks/useProcurements', () => ({ useProjectProcurements: () => state.procurements }));
vi.mock('./project-detail/useProjectPosition', () => ({ useBudgetPosition: () => state.position }));
vi.mock('@/src/hooks/useUsers', () => ({ useUsers: () => ({ data: [], isPending: false }) }));
vi.mock('@/src/hooks/useOrgCurrency', () => ({ useOrgCurrency: () => 'USD' }));
vi.mock('@/src/hooks/useErpnextBinding', () => ({ useErpnextBinding: () => ({ data: { status: 'active' }, isPending: false }) }));
vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: { id: 'u1', org_id: 'org-1' } }) }));
vi.mock('@/src/auth/impersonation', () => ({
  useEffectiveRole: () => ({ effectiveRole: state.role, realRole: state.role, canImpersonate: false, viewAs: vi.fn() }),
}));
vi.mock('@/src/components/m365/BudgetDocumentLinks', () => ({
  BudgetDocumentLinks: ({ versionId }: { versionId: string }) => <div data-testid={`evidence-${versionId}`}>Evidence documents</div>,
}));
vi.mock('@/src/lib/repositories/budgetProjection', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/src/lib/repositories/budgetProjection')>();
  return {
    ...actual,
    fetchBudgetPushStatus: vi.fn().mockImplementation(() => Promise.resolve(state.pushRows)),
    retryActiveBudgetPush: state.retryPush,
    releaseActiveBudgetPushHold: state.releaseHold,
    fetchBudgetProjection: vi.fn().mockImplementation(() => Promise.resolve(state.projectionRows)),
    listBudgetFiscalYears: vi.fn().mockImplementation(() => Promise.resolve(state.fiscalYears)),
    upsertBudgetProjectionEtc: state.saveEtc,
  };
});

import ProjectBudget from './ProjectBudget';
import type { ProjectWithRefs } from '@/src/lib/db/projects';
import type { BudgetVersionWithItems } from '@/src/lib/db/budgets';

const project = {
  id: 'p-1', currency: 'USD', tax_treatment: 'exclusive', tax_rate: null,
  tax_base_numerator: 1, tax_base_denominator: 1,
} as unknown as ProjectWithRefs;

const line = (id: string, category: string, description: string, amount: number) => ({
  id,
  budget_version_id: 'v1',
  category,
  description,
  budgeted_amount: amount,
  actual_amount: 0,
  fiscal_year: 'FY-2026',
  org_id: 'org-1',
});

const active = (lines = [line('li-active', 'Labor', 'Design', 100)]) => ({
  id: 'v-active', status: 'Active' as const, name: 'Approved plan', version: 1,
  project_id: 'p-1', org_id: 'org-1', currency: 'USD', created_at: '2026-01-01T00:00:00Z',
  activated_at: '2026-01-02T00:00:00Z', created_by: 'u2', activation_basis: null, editor_ids: [], line_items: lines,
  total: lines.reduce((sum, item) => sum + Number(item.budgeted_amount), 0),
});

const draft = (overrides: Record<string, unknown> = {}) => ({
  id: 'v-draft', status: 'Draft' as const, name: 'Revised plan', version: 2,
  project_id: 'p-1', org_id: 'org-1', currency: 'USD', created_at: '2026-02-01T00:00:00Z',
  activated_at: null, created_by: 'u2', editor_ids: [], activation_basis: null,
  line_items: [line('li-draft', 'Labor', 'Design', 125)], total: 125, ...overrides,
});

const queryClient = () => new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
const RouteSearch = () => <output data-testid="route-search">{useLocation().search}</output>;
const renderPage = (initialEntries: string[] = ['/projects/p-1/budget']) => render(
  <FinanceI18nTestProvider>
    <QueryClientProvider client={queryClient()}>
      <MemoryRouter initialEntries={initialEntries}>
        <RouteSearch />
        <ToastProvider><ProjectBudget projectId="p-1" project={project} /></ToastProvider>
      </MemoryRouter>
    </QueryClientProvider>
  </FinanceI18nTestProvider>,
);

beforeEach(() => {
  vi.clearAllMocks();
  state.budget = { data: 0, isPending: false, isError: false, refetch: vi.fn() };
  state.versions = { data: [], isPending: false, isError: false, refetch: vi.fn() };
  state.position = { actualsPending: false, actualsError: false, refetchActuals: vi.fn(), hasBudget: true, canSeeActual: true, rows: [], unknown: 0 };
  state.procurements = { data: [], isPending: false, isError: false, refetch: vi.fn() };
  state.pushRows = [];
  state.projectionRows = [];
  state.fiscalYears = [{ fiscalYear: 'FY-2026', isActivePush: true }];
  state.role = 'Project Manager';
});

describe('ProjectBudget Option A', () => {
  it('renders the approved summary, category columns, versions card, draft waiting banner, and bulk actions', async () => {
    state.versions.data = [active() as unknown as BudgetVersionWithItems, draft() as unknown as BudgetVersionWithItems];
    state.position.rows = [{ category: 'Labor', budget: 100, actual: 35 }];
    state.procurements.data = [{ status: 'Ordered', budget_category: 'Labor', approved_total_value: 15, total_value: 15, currency: 'USD' }];

    renderPage();

    expect(screen.getByTestId('budget-option-a')).toBeInTheDocument();
    expect(screen.getByText('Draft waiting for approval')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Edit draft' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Activate v2' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Budget vs actual' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Forecast' })).toBeInTheDocument();
    expect(screen.getByRole('table', { name: 'Budget vs actual by category' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Committed' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: '% used' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Budget versions' })).toHaveTextContent('Approved plan');
    expect(screen.getAllByText('Budget').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Spent').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Committed').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Left').length).toBeGreaterThan(0);

    await userEvent.click(screen.getByRole('checkbox', { name: 'Select Labor' }));
    expect(screen.getByRole('toolbar', { name: 'Selected categories' })).toHaveTextContent('1 selected');
    expect(screen.getByRole('button', { name: 'Export rows' })).toBeInTheDocument();
  });

  it('opens the category drawer on row activation and keeps unavailable ledger details explicit', async () => {
    state.versions.data = [active() as unknown as BudgetVersionWithItems];
    state.position.rows = [{ category: 'Labor', budget: 100, actual: 35 }];
    renderPage();

    await userEvent.click(screen.getByRole('button', { name: 'Open Labor budget details' }));

    const drawer = screen.getByRole('dialog', { name: 'Labor' });
    expect(screen.getByTestId('route-search')).toHaveTextContent('?open=Labor');
    expect(within(drawer).getByText('Records behind the spending')).toBeInTheDocument();
    expect(within(drawer).getByText('Transaction-level ledger records are unavailable in the project finance summary.')).toBeInTheDocument();
    expect(within(drawer).getByText('Notes')).toBeInTheDocument();
    expect(within(drawer).getByText('No category notes are recorded.')).toBeInTheDocument();
    expect(within(drawer).getByRole('link', { name: 'Open full page' })).toHaveAttribute('href', '/projects/p-1/budget');
    await userEvent.click(within(drawer).getByRole('button', { name: 'Close' }));
    expect(screen.getByTestId('route-search')).toBeEmptyDOMElement();
    expect(screen.queryByRole('dialog', { name: 'Labor' })).not.toBeInTheDocument();
  });

  it('switches to the fiscal-year forecast and exposes projection values', async () => {
    state.versions.data = [active() as unknown as BudgetVersionWithItems];
    state.projectionRows = [{
      category: 'Labor', pmoBudgetAmount: 100, actualsToDate: 35, actualsAsOf: '2026-02-01T00:00:00Z',
      pmoEtc: 50, projectedFinalCost: 85, projectedVariance: 15, projectedUtilization: 85, attributionKnown: true,
    }];

    renderPage();
    await userEvent.click(screen.getByRole('tab', { name: 'Forecast' }));

    expect(await screen.findByRole('table', { name: 'Budget forecast by category' })).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Fiscal year' })).toHaveValue('FY-2026');
    expect(screen.getByRole('columnheader', { name: 'Cost to finish' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Forecast final' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Forecast remaining' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Open Labor forecast details' }));
    const drawer = screen.getByRole('dialog', { name: 'Labor' });
    expect(screen.getByTestId('route-search')).toHaveTextContent('?budgetView=forecast&open=Labor');
    expect(within(drawer).getByRole('link', { name: 'Open full page' })).toHaveAttribute('href', '/projects/p-1/budget?budgetView=forecast');
  });

  it('reopens a category drawer from the open query parameter', () => {
    state.versions.data = [active() as unknown as BudgetVersionWithItems];
    state.position.rows = [{ category: 'Labor', budget: 100, actual: 35 }];
    renderPage(['/projects/p-1/budget?open=Labor']);

    expect(screen.getByRole('dialog', { name: 'Labor' })).toBeInTheDocument();
  });

  it('lets a PM edit and save a fiscal-year cost-to-finish estimate', async () => {
    state.versions.data = [active() as unknown as BudgetVersionWithItems];
    state.projectionRows = [{
      category: 'Labor', pmoBudgetAmount: 100, actualsToDate: 35, actualsAsOf: '2026-02-01T00:00:00Z',
      pmoEtc: 50, projectedFinalCost: 85, projectedVariance: 15, projectedUtilization: 85, attributionKnown: true,
    }];

    renderPage();
    await userEvent.click(screen.getByRole('tab', { name: 'Forecast' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Edit cost to finish' }));
    const amount = screen.getByRole('textbox', { name: 'Cost to finish for Labor' });
    await userEvent.clear(amount);
    await userEvent.type(amount, '60');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(state.saveEtc).toHaveBeenCalledWith('p-1', 'FY-2026', 'Labor', 60));
  });

  it('withholds finance figures from Engineer even if the view is mounted directly', () => {
    state.role = 'Engineer';
    state.versions.data = [active() as unknown as BudgetVersionWithItems];
    state.position = { ...state.position, canSeeActual: false };

    renderPage();

    expect(screen.queryByText('100')).not.toBeInTheDocument();
    expect(screen.queryByRole('table', { name: 'Budget vs actual by category' })).not.toBeInTheDocument();
    expect(screen.getByText('Budget details are available to project management and finance.')).toBeInTheDocument();
  });

  it('keeps activation SoD and the PM draft editor reachable from the banner', async () => {
    state.versions.data = [active() as unknown as BudgetVersionWithItems, draft({ editor_ids: ['u1'] }) as unknown as BudgetVersionWithItems];
    renderPage();

    expect(screen.queryByRole('button', { name: 'Activate v2' })).not.toBeInTheDocument();
    expect(screen.getByText('Waiting for approval by finance')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Edit draft' }));
    expect(screen.getByTestId('budget-draft-editor')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /add line item/i })).toBeInTheDocument();
  });

  it('keeps version comparison and Microsoft evidence reachable in the versions drawer', async () => {
    state.versions.data = [active() as unknown as BudgetVersionWithItems, draft() as unknown as BudgetVersionWithItems];
    renderPage();

    await userEvent.click(screen.getByRole('button', { name: 'Manage versions' }));
    const drawer = screen.getByRole('dialog', { name: 'Budget versions' });
    expect(within(drawer).getByTestId('evidence-v-active')).toBeInTheDocument();
    expect(within(drawer).getByTestId('evidence-v-draft')).toBeInTheDocument();
    await userEvent.click(within(drawer).getByRole('button', { name: 'Compare' }));
    expect(within(drawer).getByRole('table', { name: 'Version comparison' })).toBeInTheDocument();
  });
});
