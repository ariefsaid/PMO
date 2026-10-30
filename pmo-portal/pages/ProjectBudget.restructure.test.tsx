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
  activationPrecheck: {
    data: { status: 'ready', erpCheck: 'available', fiscalYearNames: ['FY-2026'], issues: [] },
    isPending: false,
    isError: false,
    refetch: vi.fn(),
  },
  position: { actualsPending: false, actualsError: false, refetchActuals: vi.fn(), hasBudget: true, canSeeActual: true, rows: [] as unknown[], unknown: 0 },
  procurements: { data: [] as unknown[], isPending: false, isError: false, refetch: vi.fn() },
  pushRows: [] as unknown[],
  archiveTargets: { data: [] as unknown[], refetch: vi.fn().mockResolvedValue({ data: [], error: null }) },
  projectionRows: [] as unknown[],
  phasing: { years: {} as Record<string, string[]>, unphased: {} as Record<string, true> },
  fiscalYears: [{ fiscalYear: 'FY-2026', isActivePush: true }],
  retryPush: vi.fn().mockResolvedValue({ pushState: 'pushed' }),
  saveEtc: vi.fn().mockResolvedValue(undefined),
  releaseHold: vi.fn().mockResolvedValue(undefined),
  role: 'Project Manager',
  binding: { status: 'active' } as { status: string } | null,
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
  useBudgetActivationPrecheck: () => state.activationPrecheck,
  useBudgetArchiveTargets: () => state.archiveTargets,
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
vi.mock('@/src/hooks/useErpnextBinding', () => ({ useErpnextBinding: () => ({ data: state.binding, isPending: false }) }));
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
    fetchActiveBudgetCategoryPhasing: vi.fn().mockImplementation(() => Promise.resolve(state.phasing)),
    listBudgetFiscalYears: vi.fn().mockImplementation(() => Promise.resolve(state.fiscalYears)),
    upsertBudgetProjectionEtc: state.saveEtc,
  };
});

import ProjectBudget from './ProjectBudget';
import type { ProjectWithRefs } from '@/src/lib/db/projects';
import type { BudgetVersionWithItems } from '@/src/lib/db/budgets';
import { buildBudgetSummaryRows, committedTotal } from './project-detail/budget/budgetModel';

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
  state.activationPrecheck = {
    data: { status: 'ready', erpCheck: 'available', fiscalYearNames: ['FY-2026'], issues: [] },
    isPending: false,
    isError: false,
    refetch: vi.fn(),
  };
  state.position = { actualsPending: false, actualsError: false, refetchActuals: vi.fn(), hasBudget: true, canSeeActual: true, rows: [], unknown: 0 };
  state.procurements = { data: [], isPending: false, isError: false, refetch: vi.fn() };
  state.pushRows = [];
  state.archiveTargets = { data: [], refetch: vi.fn().mockResolvedValue({ data: [], error: null }) };
  state.projectionRows = [];
  state.phasing = { years: { Labor: ['FY-2026'], Materials: ['FY-2027'], Travel: ['FY-2026'] }, unphased: {} };
  state.fiscalYears = [{ fiscalYear: 'FY-2026', isActivePush: true }];
  state.role = 'Project Manager';
  state.binding = { status: 'active' };
});

describe('ProjectBudget Option A', () => {
  it('renders the approved summary, category columns, versions card, draft waiting banner, and bulk actions', async () => {
    // This case includes the Finance-only activation affordance; PM read access and SoD stay
    // covered by the PM summary and activation/PM-draft cases below.
    state.role = 'Finance';
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

  it('AC-1402 summary tiles show the same spent and committed totals as the table, not a dash', () => {
    state.versions.data = [active() as unknown as BudgetVersionWithItems];
    state.position.rows = [{ category: 'Labor', budget: 100, actual: 35 }];
    state.procurements.data = [{ status: 'Ordered', budget_category: 'Labor', approved_total_value: 15, total_value: 15, currency: 'USD' }];

    renderPage();

    expect(screen.queryByRole('button', { name: 'Spending is unknown or unavailable.' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Commitments are unknown or unavailable.' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Left is unknown/ })).not.toBeInTheDocument();
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
      pmoEtc: 50, projectedFinalCost: 85, projectedVariance: 15, projectedUtilization: 0.85, attributionKnown: true,
    }];

    renderPage();
    await userEvent.click(screen.getByRole('tab', { name: 'Forecast' }));

    expect(await screen.findByRole('table', { name: 'Budget forecast by category' })).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Fiscal year' })).toHaveValue('FY-2026');
    expect(screen.getByRole('columnheader', { name: 'Cost to finish' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Forecast final' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Forecast remaining / (overrun)' })).toBeInTheDocument();
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
      pmoEtc: 50, projectedFinalCost: 85, projectedVariance: 15, projectedUtilization: 0.85, attributionKnown: true,
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
    expect(screen.getByText('You drafted or edited this version, so someone else must activate it.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Edit draft' }));
    expect(screen.getByTestId('budget-draft-editor')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /add line item/i })).toBeInTheDocument();
  });

  it('M8: Clone to revise selects the returned Draft in the version selector', async () => {
    const archivedVersion = { ...active(), id: 'v-archived', status: 'Archived', version: 2 } as unknown as BudgetVersionWithItems;
    state.versions.data = [archivedVersion];
    state.clone.mockImplementationOnce(async () => {
      state.versions.data = [archivedVersion, draft({ id: 'v-clone' }) as unknown as BudgetVersionWithItems];
      return 'v-clone';
    });
    renderPage();
    await userEvent.click(screen.getByRole('button', { name: 'Manage versions' }));
    const drawer = screen.getByRole('dialog', { name: 'Budget versions' });
    await userEvent.click(within(drawer).getByRole('button', { name: 'Clone to revise' }));
    await userEvent.click(screen.getByRole('button', { name: 'Clone version' }));
    await waitFor(() => expect(screen.getByRole('combobox', { name: 'Version' })).toHaveValue('v-clone'));
  });

  it.each(['Active', 'Archived'] as const)('M8: read-only %s category detail includes each line fiscal year', async (status) => {
    const activeVersion = active([line('li-active', 'Labor', 'Design', 100)]) as unknown as BudgetVersionWithItems;
    const archivedLine = { ...line('li-archived', 'Labor', 'Design legacy', 80), fiscal_year: 'FY-2027' };
    const archivedVersion = { ...active([archivedLine]), id: 'v-archived', status: 'Archived', version: 2 } as unknown as BudgetVersionWithItems;
    state.versions.data = [activeVersion, archivedVersion];
    renderPage();
    if (status === 'Archived') await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Version' }), 'v-archived');
    await userEvent.click(screen.getByRole('row', { name: /Labor/ }));
    expect(screen.getByText(status === 'Active' ? /Fiscal year: FY-2026/ : /Fiscal year: FY-2027/)).toBeInTheDocument();
  });

  it('M13: an unstamped Active version offers the clone action beside the recovery instructions', async () => {
    state.role = 'Finance';
    state.versions.data = [active() as unknown as BudgetVersionWithItems];
    state.pushRows = [{ pushState: 'unstamped-activation', fiscalYear: 'FY-2026', pushError: null, unmappedCategories: null, erpBudgetName: null, holdReleasable: false, staleAttribution: false }];
    renderPage();
    await userEvent.click(screen.getByText('Sources and budget enforcement'));
    expect(screen.getByText(/Clone the active version or edit the existing draft, then activate it/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Clone to revise' }));
    expect(screen.getByRole('heading', { name: 'Clone to a new draft?' })).toBeInTheDocument();
  });

  it('M20: a forecast deep link falls back to plan when the organization has no active ERP binding', () => {
    state.versions.data = [active() as unknown as BudgetVersionWithItems];
    state.binding = null;
    renderPage(['/projects/p-1/budget?budgetView=forecast']);
    expect(screen.getByRole('table', { name: 'Budget vs actual by category' })).toBeInTheDocument();
    expect(screen.queryByTestId('budget-forecast-view')).not.toBeInTheDocument();
  });

  it('M20: a forecast deep link falls back to plan when there is no Active budget', () => {
    state.versions.data = [draft() as unknown as BudgetVersionWithItems];
    renderPage(['/projects/p-1/budget?budgetView=forecast']);
    expect(screen.queryByTestId('budget-forecast-view')).not.toBeInTheDocument();
    expect(screen.getByText('No active budget')).toBeInTheDocument();
  });

  it('M11: incomplete forecast totals name categories, explain row causes, and show the ledger timestamp', async () => {
    state.versions.data = [active() as unknown as BudgetVersionWithItems];
    state.projectionRows = [
      { category: 'Labor', pmoBudgetAmount: 100, actualsToDate: null, actualsAsOf: null, pmoEtc: 5, projectedFinalCost: null, projectedVariance: null, projectedUtilization: null, attributionKnown: true },
      { category: 'Materials', pmoBudgetAmount: null, actualsToDate: 10, actualsAsOf: '2026-10-20T00:00:00Z', pmoEtc: 2, projectedFinalCost: 12, projectedVariance: null, projectedUtilization: null, attributionKnown: true },
      { category: 'Travel', pmoBudgetAmount: 100, actualsToDate: null, actualsAsOf: '2026-10-20T00:00:00Z', pmoEtc: 0, projectedFinalCost: null, projectedVariance: null, projectedUtilization: null, attributionKnown: true },
      { category: 'Equipment', pmoBudgetAmount: null, actualsToDate: 10, actualsAsOf: '2026-10-20T00:00:00Z', pmoEtc: 0, projectedFinalCost: 10, projectedVariance: null, projectedUtilization: null, attributionKnown: true },
      { category: 'Professional Fees', pmoBudgetAmount: null, actualsToDate: 10, actualsAsOf: '2026-10-20T00:00:00Z', pmoEtc: 0, projectedFinalCost: 10, projectedVariance: null, projectedUtilization: null, attributionKnown: false },
    ];
    state.phasing = { years: { Labor: ['FY-2026'], Materials: ['FY-2027'], 'Professional Fees': ['FY-2026'] }, unphased: { 'Professional Fees': true } };
    renderPage(['/projects/p-1/budget?budgetView=forecast']);
    expect(await screen.findByTestId('forecast-incomplete')).toHaveTextContent('Incomplete categories: Labor, Materials, Travel, Equipment, Professional Fees');
    expect(await screen.findByText(/Labor: No ledger reading is available/)).toBeInTheDocument();
    expect(await screen.findByText(/Materials: Budgeted in another fiscal year: FY-2027/)).toBeInTheDocument();
    expect(await screen.findByText(/Travel: No accounting ledger account is mapped/)).toBeInTheDocument();
    expect(await screen.findByText(/Equipment: No budget line is recorded/)).toBeInTheDocument();
    expect(await screen.findByText(/Professional Fees: Budget attribution is stale or incomplete/)).toBeInTheDocument();
    expect(screen.getByText(/Recorded spending as of/)).toBeInTheDocument();
  });

  it('M14: an empty fiscal-year projection explains activation, ERP push, and the first ledger posting', async () => {
    state.versions.data = [active() as unknown as BudgetVersionWithItems];
    state.projectionRows = [];
    renderPage(['/projects/p-1/budget?budgetView=forecast']);
    expect(await screen.findByText(/Activate and push a budget version for this fiscal year/)).toBeInTheDocument();
    expect(screen.getByText(/wait for the first ERP ledger posting to sync/)).toBeInTheDocument();
  });

  it('M11: a projection row says when no budget exists for its fiscal year', async () => {
    state.versions.data = [active() as unknown as BudgetVersionWithItems];
    state.phasing = { years: {}, unphased: {} };
    state.projectionRows = [{ category: 'Labor', pmoBudgetAmount: null, actualsToDate: 10, actualsAsOf: '2026-10-20T00:00:00Z', pmoEtc: 0, projectedFinalCost: null, projectedVariance: null, projectedUtilization: null, attributionKnown: true }];
    renderPage(['/projects/p-1/budget?budgetView=forecast']);
    expect(await screen.findByText(/Labor: No budget is recorded for this fiscal year/)).toBeInTheDocument();
  });

  it('M12: a partial cost-to-finish save names saved and failed categories and keeps the classified row reason', async () => {
    state.versions.data = [active() as unknown as BudgetVersionWithItems];
    state.projectionRows = [
      { category: 'Labor', pmoBudgetAmount: 100, actualsToDate: 10, actualsAsOf: '2026-10-20T00:00:00Z', pmoEtc: 5, projectedFinalCost: 15, projectedVariance: 85, projectedUtilization: 0.15, attributionKnown: true },
      { category: 'Materials', pmoBudgetAmount: 100, actualsToDate: 20, actualsAsOf: '2026-10-20T00:00:00Z', pmoEtc: 2, projectedFinalCost: 22, projectedVariance: 78, projectedUtilization: 0.22, attributionKnown: true },
    ];
    state.saveEtc.mockImplementation(async (_project, _year, category) => {
      if (category === 'Materials') throw new Error('Write rejected');
    });
    renderPage(['/projects/p-1/budget?budgetView=forecast']);
    await userEvent.click(await screen.findByRole('button', { name: 'Edit cost to finish' }));
    await userEvent.clear(screen.getByRole('textbox', { name: 'Cost to finish for Labor' }));
    await userEvent.type(screen.getByRole('textbox', { name: 'Cost to finish for Labor' }), '7');
    await userEvent.clear(screen.getByRole('textbox', { name: 'Cost to finish for Materials' }));
    await userEvent.type(screen.getByRole('textbox', { name: 'Cost to finish for Materials' }), '9');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(state.saveEtc).toHaveBeenCalledTimes(2));
    expect(await screen.findByText(/Saved: Labor\. Not saved: Materials\./)).toBeInTheDocument();
    expect(screen.getByText(/Not saved\./)).toBeInTheDocument();
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

describe('ProjectBudget rulings (C4/C5/C6/F11/B1/L12)', () => {
  const bigActive = () => active([line('li-1', 'Labor', 'Design', 4_500_000)]) as unknown as BudgetVersionWithItems;

  it('keeps the active budget currency when a different draft is selected', async () => {
    state.versions.data = [{ ...active([line('li-1', 'Labor', 'Design', 4_500_000)]), currency: 'EUR' }, draft({ currency: 'GBP' })];
    state.position.rows = [{ category: 'Labor', budget: 100, actual: 35 }];
    state.procurements.data = [{ status: 'Ordered', budget_category: 'Labor', approved_total_value: 15, total_value: 15, currency: 'USD' }];
    renderPage();
    const tiles = screen.getByRole('region', { name: 'Budget figures' });
    expect(within(tiles).getByText('€4.5M')).toHaveAttribute('title', '€4,500,000');
    expect(within(tiles).getByText('$35')).toBeInTheDocument();
    expect(within(tiles).getByText('$15')).toBeInTheDocument();
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Version' }), 'v-draft');
    expect(within(tiles).getByText('€4.5M')).toHaveAttribute('title', '€4,500,000');
    expect(screen.getByRole('table', { name: 'Budget vs actual by category' })).toHaveTextContent('125');
    expect(screen.getAllByText(/^USD ·/).length).toBeGreaterThan(0);
    const table = screen.getByRole('table', { name: 'Budget vs actual by category' });
    expect(table).toHaveTextContent('GBP 125');
    expect(table).not.toHaveTextContent('75');
    expect(table).not.toHaveTextContent('40%');
    expect(table).not.toHaveTextContent('On track');
    await userEvent.click(screen.getByRole('button', { name: 'Open Labor budget details' }));
    expect(screen.getByRole('dialog', { name: 'Labor' })).toHaveTextContent('GBP 125');
  });

  it.each(['Active', 'Archived'])('keeps %s budget in its own basis and leaves mixed comparisons unavailable', async (status) => {
    const version = { ...active(), status, currency: 'GBP', total: 125, line_items: [line('foreign', 'Labor', 'Design', 125)] };
    state.versions.data = [version];
    state.position.rows = [{ category: 'Labor', budget: 125, actual: 35 }];
    state.procurements.data = [{ status: 'Ordered', budget_category: 'Labor', approved_total_value: 15, total_value: 15, currency: 'USD' }];
    renderPage();
    const table = screen.getByRole('table', { name: 'Budget vs actual by category' });
    expect(table).toHaveTextContent('GBP 125');
    expect(table).not.toHaveTextContent('75');
    expect(table).not.toHaveTextContent('40%');
    expect(table).not.toHaveTextContent('On track');
  });

  it('compares version amounts only when their recorded currencies match', async () => {
    state.versions.data = [{ ...active(), currency: 'GBP' }, draft({ currency: 'EUR' }), { ...draft({ currency: 'GBP' }), id: 'v-archived', status: 'Archived', version: 3 }];
    renderPage();
    const versionRegion = screen.getByRole('region', { name: 'Budget versions' });
    expect(versionRegion).toHaveTextContent('GBP 100');
    expect(versionRegion).toHaveTextContent('EUR 125');
    await userEvent.click(screen.getByRole('button', { name: 'Manage versions' }));
    const drawer = screen.getByRole('dialog', { name: 'Budget versions' });
    await userEvent.click(within(drawer).getByRole('button', { name: 'Compare' }));
    const table = within(drawer).getByRole('table', { name: 'Version comparison' });
    expect(table).toHaveTextContent('GBP 100');
    expect(table).toHaveTextContent('EUR 125');
    expect(within(table).getAllByText('—').length).toBeGreaterThan(0);
    await userEvent.selectOptions(within(drawer).getByRole('combobox', { name: 'Version B' }), 'v-archived');
    expect(table).toHaveTextContent('+GBP 25');
  });

  it('shows a same-currency change between foreign version totals', () => {
    state.versions.data = [{ ...active(), currency: 'GBP' }, draft({ currency: 'GBP' })];
    renderPage();
    const versions = screen.getByRole('region', { name: 'Budget versions' });
    expect(versions).toHaveTextContent('+GBP 25');
  });

  it('keeps the forecast editor available with a foreign active budget', async () => {
    state.versions.data = [{ ...active(), currency: 'GBP' }];
    state.projectionRows = [{ category: 'Labor', pmoBudgetAmount: 100, actualsToDate: 35, actualsAsOf: '2026-10-20T00:00:00Z', pmoEtc: 15, projectedFinalCost: 50, projectedVariance: 50, projectedUtilization: 0.5, attributionKnown: true }];
    renderPage(['/projects/p-1/budget?budgetView=forecast']);
    expect(await screen.findByRole('button', { name: 'Edit cost to finish' })).toBeInTheDocument();
    const forecast = screen.getByRole('table', { name: 'Budget forecast by category' });
    expect(forecast).toHaveTextContent('£100');
    expect(forecast).not.toHaveTextContent('50%');
  });

  it.each([null, ''])('falls back to project currency when the active currency is %s', async (currency) => {
    state.versions.data = [{ ...active(), currency }];
    renderPage();
    expect(within(screen.getByRole('region', { name: 'Budget figures' })).getByText('$100')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Manage versions' }));
    expect(within(screen.getByRole('dialog', { name: 'Budget versions' })).getByText(/\$100/)).toBeInTheDocument();
  });

  it('shows no active amount when only a draft exists', () => {
    state.versions.data = [draft({ currency: 'EUR' })];
    renderPage();
    expect(screen.getByText('No active budget')).toBeInTheDocument();
    const tiles = screen.getByRole('region', { name: 'Budget figures' });
    expect(within(tiles).queryByText('€125')).not.toBeInTheDocument();
    expect(within(tiles).getAllByText('—').length).toBeGreaterThan(0);
  });

  it('F11: summary tiles show short amounts with the full amount kept for hover and screen readers', () => {
    state.versions.data = [bigActive()];
    state.position.rows = [{ category: 'Labor', budget: 4_500_000, actual: 1_780_000 }];
    renderPage();
    const tiles = screen.getByRole('region', { name: 'Budget figures' });
    expect(within(tiles).getByText('$4.5M')).toHaveAttribute('title', '$4,500,000');
    expect(within(tiles).getByText('$4,500,000')).toHaveClass('sr-only');
  });

  it('C5/C6: table amounts are bare numbers with no trailing .00, under the one currency and tax heading', () => {
    state.versions.data = [bigActive()];
    state.position.rows = [{ category: 'Labor', budget: 4_500_000, actual: 1_780_000.4 }];
    renderPage();
    const table = screen.getByRole('table', { name: 'Budget vs actual by category' });
    expect(within(table).getAllByText('4,500,000').length).toBeGreaterThan(0);
    // A real fraction is money and is kept; a whole amount never grows a .00.
    expect(within(table).getAllByText('1,780,000.4').length).toBeGreaterThan(0);
    expect(within(table).queryByText(/\$/)).not.toBeInTheDocument();
    expect(within(table).queryByText(/\.00$/)).not.toBeInTheDocument();
    expect(screen.getAllByText(/^USD ·/).length).toBeGreaterThan(0);
  });

  it('C4: an Uncategorized row with commitments and no budget says Not budgeted, never Unavailable; unknown authors are left out', () => {
    state.versions.data = [{ ...active(), created_by: 'someone-gone' } as unknown as BudgetVersionWithItems];
    state.position.rows = [{ category: 'Labor', budget: 100, actual: 35 }];
    state.procurements.data = [{ status: 'Ordered', budget_category: null, approved_total_value: 40, total_value: 40, currency: 'USD' }];
    renderPage();
    expect(screen.getByRole('row', { name: /Uncategorized/ })).toHaveTextContent('Not budgeted');
    expect(screen.queryByText(/Unavailable|unavailable$/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Author unavailable/)).not.toBeInTheDocument();
  });

  it('L12: the Committed tile is the same shared total the Overview shows, Uncategorized included', () => {
    state.versions.data = [active()] as unknown as BudgetVersionWithItems[];
    state.position.rows = [{ category: 'Labor', budget: 100, actual: 35 }];
    const procurements = [
      { status: 'Ordered', budget_category: 'Labor', approved_total_value: 15, total_value: 15, currency: 'USD' },
      { status: 'Vendor Invoiced', budget_category: null, approved_total_value: null, total_value: 62, currency: 'USD' },
    ];
    state.procurements.data = procurements;
    const shared = committedTotal(buildBudgetSummaryRows({
      lines: [{ category: 'Labor', description: null, budgeted_amount: 100 }],
      actuals: [{ category: 'Labor', budget: 100, actual: 35 }],
      procurements, canReadProcurements: true, currency: 'USD',
    }));
    expect(shared).toBe(77);
    renderPage();
    expect(within(screen.getByRole('region', { name: 'Budget figures' })).getByText('$77')).toBeInTheDocument();
  });

  it('B1/C4: the category drawer has one main action, Open full page and a ⋯ menu, and points to Forecast instead of placeholder figures', async () => {
    state.versions.data = [active() as unknown as BudgetVersionWithItems];
    state.position.rows = [{ category: 'Labor', budget: 100, actual: 35 }];
    renderPage(['/projects/p-1/budget?open=Labor']);
    const drawer = screen.getByRole('dialog', { name: 'Labor' });
    expect(within(drawer).getByRole('button', { name: 'Adjust in a draft' })).toBeInTheDocument();
    expect(within(drawer).getByRole('link', { name: 'Open full page' })).toBeInTheDocument();
    await userEvent.click(within(drawer).getByRole('button', { name: 'Labor actions' }));
    expect(screen.getByRole('menuitem', { name: 'Export category' })).toBeInTheDocument();
    expect(within(drawer).queryByText('Available in Forecast by fiscal year.')).not.toBeInTheDocument();
    await userEvent.click(within(drawer).getByRole('button', { name: 'Open Forecast' }));
    expect(screen.getByTestId('route-search')).toHaveTextContent('budgetView=forecast');
  });
});
