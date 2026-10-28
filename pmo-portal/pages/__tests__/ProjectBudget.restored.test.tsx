/**
 * Project budget behaviours whose tests were deleted in the #1402 restructure (BudgetTab, ProjectBudget,
 * wave6), re-asserted against the shipped page: where the Forecast is offered, version selection, the
 * Active budget as the reference figure, and the Forecast edit right. Only hooks and the repository
 * seam are mocked.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { MemoryRouter } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ToastProvider } from '@/src/components/ui';
import { FinanceI18nTestProvider } from './financeI18nTestProvider';

const state = vi.hoisted(() => ({
  versions: { data: [] as unknown[], isPending: false, isError: false, refetch: vi.fn() },
  binding: { data: { status: 'active' } as { status: string } | null | undefined, isPending: false, isError: false },
  role: 'Project Manager',
  pushRows: [] as unknown[],
  projectionRows: [] as unknown[],
  fiscalYears: [{ fiscalYear: 'FY-2026', isActivePush: true }] as unknown[],
  createVersion: vi.fn(),
  saveEtc: vi.fn(),
  retryPush: vi.fn(),
  releaseHold: vi.fn(),
}));

vi.mock('@/src/hooks/useBudget', () => ({
  useProjectBudget: () => ({ data: 0, isPending: false, isError: false, refetch: vi.fn() }),
  useBudgetVersions: () => state.versions,
  useBudgetActivationMode: () => ({ data: 'allowed', isPending: false, isError: false }),
  useBudgetMutations: () => ({
    createVersion: { mutateAsync: state.createVersion, isPending: false },
    cloneVersion: { mutateAsync: vi.fn(), isPending: false },
    activate: { mutateAsync: vi.fn(), isPending: false },
    archive: { mutateAsync: vi.fn(), isPending: false },
    deleteDraft: { mutateAsync: vi.fn(), isPending: false },
    createLineItem: { mutateAsync: vi.fn(), isPending: false },
    updateLineItem: { mutateAsync: vi.fn(), isPending: false },
    deleteLineItem: { mutateAsync: vi.fn(), isPending: false },
  }),
}));
vi.mock('@/src/hooks/useProcurements', () => ({ useProjectProcurements: () => ({ data: [], isPending: false, isError: false }) }));
vi.mock('../project-detail/useProjectPosition', () => ({
  useBudgetPosition: () => ({ actualsPending: false, actualsError: false, refetchActuals: vi.fn(), hasBudget: true, canSeeActual: true, rows: [], unknown: 0 }),
}));
vi.mock('@/src/hooks/useUsers', () => ({ useUsers: () => ({ data: [], isPending: false }) }));
vi.mock('@/src/hooks/useOrgCurrency', () => ({ useOrgCurrency: () => 'USD' }));
vi.mock('@/src/hooks/useErpnextBinding', () => ({ useErpnextBinding: () => state.binding }));
vi.mock('@/src/hooks/useProjectFinances', () => ({ useProjectFinances: () => ({ data: undefined }) }));
vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: { id: 'u1', org_id: 'org-1' } }) }));
vi.mock('@/src/auth/impersonation', () => ({
  useEffectiveRole: () => ({ effectiveRole: state.role, realRole: state.role, canImpersonate: false, viewAs: vi.fn() }),
}));
vi.mock('@/src/components/m365/BudgetDocumentLinks', () => ({ BudgetDocumentLinks: () => null }));
vi.mock('@/src/lib/repositories/budgetProjection', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/src/lib/repositories/budgetProjection')>()),
  fetchBudgetPushStatus: vi.fn().mockImplementation(() => Promise.resolve(state.pushRows)),
  retryActiveBudgetPush: state.retryPush,
  releaseActiveBudgetPushHold: state.releaseHold,
  fetchBudgetProjection: vi.fn().mockImplementation(() => Promise.resolve(state.projectionRows)),
  fetchActiveBudgetCategoryPhasing: vi.fn().mockImplementation(() => Promise.resolve({ years: { Labor: ['FY-2026'] }, unphased: {} })),
  listBudgetFiscalYears: vi.fn().mockImplementation(() => Promise.resolve(state.fiscalYears)),
  upsertBudgetProjectionEtc: state.saveEtc,
}));

import ProjectBudget from '../ProjectBudget';
import type { ProjectWithRefs } from '@/src/lib/db/projects';

const project = { id: 'p-1', currency: 'USD', tax_treatment: 'exclusive', tax_rate: null } as unknown as ProjectWithRefs;

const line = (id: string, versionId: string, category: string, amount: number, fiscal_year: string | null = 'FY-2026') => ({
  id, budget_version_id: versionId, category, description: `${category} work`, budgeted_amount: amount, actual_amount: 0, fiscal_year, org_id: 'org-1',
});
const version = (id: string, status: 'Active' | 'Draft' | 'Archived', n: number, lines: ReturnType<typeof line>[]) => ({
  id, status, name: `${status} plan`, version: n, project_id: 'p-1', org_id: 'org-1', currency: 'USD',
  created_at: '2026-01-01T00:00:00Z', activated_at: status === 'Active' ? '2026-01-02T00:00:00Z' : null,
  created_by: 'u2', editor_ids: [], activation_basis: null, line_items: lines,
  total: lines.reduce((sum, item) => sum + item.budgeted_amount, 0),
});
const ACTIVE = version('v-active', 'Active', 1, [line('a-1', 'v-active', 'Labor', 4700000)]);
const DRAFT = version('v-draft', 'Draft', 2, [line('d-1', 'v-draft', 'Materials', 125000)]);
const ARCHIVED = version('v-arch', 'Archived', 0, [line('r-1', 'v-arch', 'Travel', 9000)]);
const PROJECTION_ROW = {
  category: 'Labor', pmoBudgetAmount: 100, actualsToDate: 35, actualsAsOf: '2026-02-01T00:00:00Z',
  pmoEtc: 50, projectedFinalCost: 85, projectedVariance: 15, projectedUtilization: 0.85, attributionKnown: true,
};
const PUSH = { pushState: 'pushed', fiscalYear: 'FY-2026', pushError: null, unmappedCategories: null, erpBudgetName: 'BUDGET-0007', holdReleasable: false, staleAttribution: false };

const renderPage = (initialEntries: string[] = ['/projects/p-1/budget']) => render(
  <FinanceI18nTestProvider>
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })}>
      <MemoryRouter initialEntries={initialEntries}>
        <ToastProvider><ProjectBudget projectId="p-1" project={project} /></ToastProvider>
      </MemoryRouter>
    </QueryClientProvider>
  </FinanceI18nTestProvider>,
);

beforeEach(() => {
  vi.clearAllMocks();
  state.versions = { data: [ACTIVE], isPending: false, isError: false, refetch: vi.fn() };
  state.binding = { data: { status: 'active' }, isPending: false, isError: false };
  state.role = 'Project Manager';
  state.pushRows = [];
  state.projectionRows = [PROJECTION_ROW];
  state.fiscalYears = [{ fiscalYear: 'FY-2026', isActivePush: true }];
  state.createVersion.mockResolvedValue({ id: 'v-new' });
  state.saveEtc.mockResolvedValue(undefined);
  state.retryPush.mockResolvedValue({ pushState: 'pushed' });
  state.releaseHold.mockResolvedValue(undefined);
});

describe('the ERP Forecast is offered only where it can mean something (LOW-2, SUB-D)', () => {
  it('LOW-2 an org with an ACTIVE erpnext binding and an Active budget gets the Forecast, ahead of the version ledger (UX-034)', async () => {
    renderPage(['/projects/p-1/budget?budgetView=forecast']);
    const forecast = await screen.findByTestId('budget-forecast-view');
    expect(screen.getByRole('tab', { name: 'Forecast' })).toBeInTheDocument();
    const ledger = screen.getByRole('region', { name: 'Budget versions' });
    expect(forecast.compareDocumentPosition(ledger) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it.each([
    ['no erpnext binding', { data: null, isPending: false, isError: false }],
    ['a DISCONNECTED binding', { data: { status: 'disconnected' }, isPending: false, isError: false }],
    ['a binding still loading', { data: undefined, isPending: true, isError: false }],
    ['a binding read that FAILED', { data: undefined, isPending: false, isError: true }],
  ])('LOW-2 %s never mounts the Forecast — no unfollowable ERP advice, PMO budget still shown', (_label, binding) => {
    state.binding = binding;
    renderPage(['/projects/p-1/budget?budgetView=forecast']);
    expect(screen.getByRole('table', { name: 'Budget vs actual by category' })).toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: 'Forecast' })).not.toBeInTheDocument();
    expect(screen.queryByTestId('budget-forecast-view')).not.toBeInTheDocument();
    expect(screen.queryByText(/Forecast appears once/)).not.toBeInTheDocument();
  });

  it.each([[[]], [[DRAFT]], [[DRAFT, ARCHIVED]]])('SUB-D the Forecast mounts only with an ACTIVE budget version (%#)', (versions) => {
    state.versions.data = versions;
    renderPage(['/projects/p-1/budget?budgetView=forecast']);
    expect(screen.queryByRole('tab', { name: 'Forecast' })).not.toBeInTheDocument();
    expect(screen.queryByTestId('budget-forecast-view')).not.toBeInTheDocument();
  });

  it('OD-BUDGET-3 Finance can edit the cost to finish for a category', async () => {
    state.role = 'Finance';
    renderPage(['/projects/p-1/budget?budgetView=forecast']);
    await userEvent.click(await screen.findByRole('button', { name: 'Edit cost to finish' }));
    const amount = screen.getByRole('textbox', { name: 'Cost to finish for Labor' });
    await userEvent.clear(amount);
    await userEvent.type(amount, '60');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(state.saveEtc).toHaveBeenCalledWith('p-1', 'FY-2026', 'Labor', 60));
  });

  it('H-4 with no fiscal year on record, an unrecorded push is still stated (enforcement does not depend on the year)', async () => {
    state.role = 'Finance';
    state.fiscalYears = [];
    state.projectionRows = [];
    state.pushRows = [{ ...PUSH, pushState: 'never-pushed', fiscalYear: null, erpBudgetName: null }];
    renderPage(['/projects/p-1/budget?budgetView=forecast']);
    expect(await screen.findByText('Choose a fiscal year to view the ERP forecast')).toBeInTheDocument();
    await userEvent.click(screen.getByText('Sources and budget enforcement'));
    expect(await screen.findByTestId('budget-erp-notice')).toHaveTextContent('No ERP budget yet');
  });
});

describe('version selection (AC-BD)', () => {
  const versionSelect = () => screen.getByRole('combobox', { name: 'Version' }) as HTMLSelectElement;

  it('AC-BD-01/02 a labelled Version selector defaults to the Active version even when it is not first', () => {
    state.versions.data = [ARCHIVED, ACTIVE, DRAFT];
    renderPage();
    expect(versionSelect().value).toBe('v-active');
  });

  it('AC-BD-03 with no Active version it defaults to the Draft, never an Archived one', () => {
    state.versions.data = [ARCHIVED, DRAFT];
    renderPage();
    expect(versionSelect().value).toBe('v-draft');
  });

  it('AC-BD-04 switching the selector swaps the table to the selected version lines', async () => {
    state.versions.data = [ACTIVE, DRAFT];
    renderPage();
    const table = () => screen.getByRole('table', { name: 'Budget vs actual by category' });
    expect(within(table()).queryByText('Materials')).not.toBeInTheDocument();
    await userEvent.selectOptions(versionSelect(), 'v-draft');
    expect(within(table()).getByText('Materials')).toBeInTheDocument();
    expect(within(table()).queryByText('Labor')).not.toBeInTheDocument();
  });

  it('AC-BD-09 a selected Draft that is deleted falls back to the Active version without a crash', async () => {
    state.versions.data = [ACTIVE, DRAFT];
    const view = renderPage();
    await userEvent.selectOptions(versionSelect(), 'v-draft');
    state.versions = { ...state.versions, data: [ACTIVE] };
    view.rerender(
      <FinanceI18nTestProvider>
        <QueryClientProvider client={new QueryClient()}>
          <MemoryRouter><ToastProvider><ProjectBudget projectId="p-1" project={project} /></ToastProvider></MemoryRouter>
        </QueryClientProvider>
      </FinanceI18nTestProvider>,
    );
    expect(versionSelect().value).toBe('v-active');
    expect(within(screen.getByRole('table', { name: 'Budget vs actual by category' })).getByText('Labor')).toBeInTheDocument();
  });

  it('UX-033 while a Draft is open, the Active budget stays in view as the reference figure', async () => {
    state.versions.data = [ACTIVE, DRAFT];
    renderPage();
    await userEvent.selectOptions(versionSelect(), 'v-draft');
    const figures = screen.getByRole('region', { name: 'Budget figures' });
    expect(within(figures).getByText('$4.7M')).toBeInTheDocument();
    expect(within(figures).queryByText(/125/)).not.toBeInTheDocument();
  });

  it('DD-MONEY-4 with only a Draft, the page says there is no Active budget and never presents the Draft as the budget', () => {
    state.versions.data = [DRAFT];
    renderPage();
    expect(screen.getByText('No active budget')).toBeInTheDocument();
    const figures = screen.getByRole('region', { name: 'Budget figures' });
    expect(within(figures).queryByText(/125/)).not.toBeInTheDocument();
    // The Budget tile is unknown (a dash), never the Draft total and never $0.
    expect(figures.textContent).toMatch(/^Budget—Spent/);
  });

  it('B1 New version (list state) confirms before writing and the confirm names the entered version', async () => {
    renderPage();
    await userEvent.click(screen.getByRole('button', { name: 'New version' }));
    await userEvent.type(screen.getByRole('textbox', { name: 'Version name' }), 'Budget v2');
    await userEvent.click(screen.getByRole('button', { name: 'Create' }));
    expect(state.createVersion).not.toHaveBeenCalled();
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveTextContent('named "Budget v2"');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create version' }));
    expect(state.createVersion).toHaveBeenCalledWith({ projectId: 'p-1', name: 'Budget v2' });
  });

  it('BU-1 a newly created version becomes the version in view', async () => {
    const created = version('v-new', 'Draft', 2, []);
    state.createVersion.mockImplementationOnce(async () => {
      state.versions = { ...state.versions, data: [ACTIVE, created] };
      return created;
    });
    renderPage();
    await userEvent.click(screen.getByRole('button', { name: 'New version' }));
    await userEvent.type(screen.getByRole('textbox', { name: 'Version name' }), 'Budget v2');
    await userEvent.click(screen.getByRole('button', { name: 'Create' }));
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Create version' }));
    await waitFor(() => expect(versionSelect().value).toBe('v-new'));
  });

  it('SUB-D with zero versions the page says "no budget" once, and offers to create one', () => {
    state.versions = { ...state.versions, data: [] };
    renderPage();
    expect(screen.getByText('No budget versions yet')).toBeInTheDocument();
    expect(screen.queryByText('No active budget')).not.toBeInTheDocument();
  });

  it('AC-BFY-016 an Active version shows each line fiscal year but offers no way to change it', async () => {
    renderPage();
    await userEvent.click(screen.getByRole('row', { name: /Labor/ }));
    expect(screen.getByText(/Fiscal year: FY-2026/)).toBeInTheDocument();
    expect(screen.queryByLabelText(/fiscal year/i, { selector: 'input, select, textarea' })).not.toBeInTheDocument();
  });
});

describe('SP-4 ERP push state follows #1402 role scope', () => {
  it.each(['Project Manager', 'Executive', 'Engineer'])('hides push state and the accounting column from %s', (role) => {
    state.role = role;
    state.pushRows = [PUSH];
    renderPage();
    expect(screen.queryByRole('columnheader', { name: 'Accounting system' })).not.toBeInTheDocument();
    expect(screen.queryByTestId('budget-erp-notice')).not.toBeInTheDocument();
  });

  it.each(['Finance', 'Admin'])('shows push state and the accounting column to %s', async (role) => {
    state.role = role;
    state.pushRows = [
      PUSH,
      { ...PUSH, pushState: 'held', fiscalYear: 'FY-2027', pushError: 'command-held', erpBudgetName: null, holdReleasable: true },
    ];
    renderPage();
    await userEvent.click(screen.getByText('Sources and budget enforcement'));
    const notice = await screen.findByTestId('budget-erp-notice');
    expect(screen.getByRole('columnheader', { name: 'Accounting system' })).toBeInTheDocument();
    expect(notice).toHaveTextContent('Enforced by ERPNext');
    expect(notice).toHaveTextContent('BUDGET-0007');
    expect(notice).toHaveTextContent('FY-2027');
    expect(within(notice).queryByRole('button', { name: 'Retry the push' })).not.toBeInTheDocument();
    if (role === 'Admin') {
      expect(within(notice).getByRole('button', { name: 'Release the hold' })).toBeInTheDocument();
    } else {
      expect(within(notice).queryByRole('button', { name: 'Release the hold' })).not.toBeInTheDocument();
    }
  });
});
