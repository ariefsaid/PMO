import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { MemoryRouter } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ToastProvider } from '@/src/components/ui';
import { FinanceI18nTestProvider } from './__tests__/financeI18nTestProvider';

const state = vi.hoisted(() => ({
  budget: { data: 0, isPending: false, isError: false, refetch: vi.fn() },
  versions: { data: [] as unknown[], isPending: false, isError: false, refetch: vi.fn() },
  position: { actualsPending: false, actualsError: false, refetchActuals: vi.fn(), hasBudget: true, canSeeActual: true, rows: [] as unknown[], unknown: 0 },
  procurements: { data: [] as unknown[], isPending: false, isError: false, refetch: vi.fn() },
  pushRows: [] as unknown[],
  retryPush: vi.fn().mockResolvedValue({ pushState: 'pushed' }),
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
  useBudgetActivationMode: () => ({ data: undefined, isPending: false, isError: false }),
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
vi.mock('@/src/hooks/useOrgCurrency', () => ({ useOrgCurrency: () => 'USD' }));
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
  };
});

import ProjectBudget from './ProjectBudget';
import type { ProjectWithRefs } from '@/src/lib/db/projects';
import type { BudgetVersionWithItems } from '@/src/lib/db/budgets';
import { formatNumberMax2 } from '@/src/lib/format';

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
  org_id: 'org-1',
});

const active = (lines = [line('li-active', 'Labor', 'Design', 100)]) => ({
  id: 'v-active', status: 'Active' as const, name: 'Approved plan', version: 1,
  project_id: 'p-1', org_id: 'org-1', currency: 'USD', created_at: '2026-01-01T00:00:00Z',
  activated_at: '2026-01-02T00:00:00Z', activation_basis: null, line_items: lines,
  total: lines.reduce((sum, item) => sum + Number(item.budgeted_amount), 0),
});

const draft = (overrides: Record<string, unknown> = {}) => ({
  id: 'v-draft', status: 'Draft' as const, name: 'Revised plan', version: 2,
  project_id: 'p-1', org_id: 'org-1', currency: 'USD', created_at: '2026-02-01T00:00:00Z',
  activated_at: null, created_by: 'u2', editor_ids: [], activation_basis: null,
  line_items: [line('li-draft', 'Labor', 'Design', 125)], total: 125, ...overrides,
});

const queryClient = () => new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
const renderPage = () => render(
  <FinanceI18nTestProvider>
    <QueryClientProvider client={queryClient()}>
      <MemoryRouter>
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
  state.role = 'Project Manager';
});

describe('ProjectBudget restructured tab', () => {
  it('leads with active budget by category, keeps committed separate, and expands line details', async () => {
    const lines = [line('li-labor', 'Labor', 'Design', 60), line('li-build', 'Labor', 'Build', 40)];
    state.versions.data = [active(lines) as unknown as BudgetVersionWithItems];
    state.position.rows = [{ category: 'Labor', budget: 100, actual: 120 }];
    state.procurements.data = [
      { status: 'Ordered', budget_category: 'Labor', approved_total_value: 40, total_value: 45, currency: 'USD' },
      { status: 'Paid', budget_category: 'Labor', approved_total_value: null, total_value: 10, currency: 'USD' },
      { status: 'Approved', budget_category: 'Labor', approved_total_value: 500, total_value: 500, currency: 'USD' },
    ];

    renderPage();

    const table = screen.getByRole('table', { name: 'Budget by category' });
    expect(within(table).getByRole('columnheader', { name: 'Category' })).toBeInTheDocument();
    expect(within(table).getByRole('columnheader', { name: 'Budget' })).toBeInTheDocument();
    expect(within(table).getByRole('columnheader', { name: 'Spent' })).toBeInTheDocument();
    expect(within(table).getByRole('columnheader', { name: 'Left' })).toBeInTheDocument();
    expect(within(table).queryByText('Total')).not.toBeInTheDocument();
    const answer = screen.getByText('20 over budget');
    expect(answer).toHaveClass('text-destructive-text');
    expect(screen.getByText('Spent 120 of 100')).toBeInTheDocument();
    expect(answer.compareDocumentPosition(table) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const phoneRows = screen.getByRole('list', { name: 'Budget categories' });
    expect(phoneRows).toHaveClass('md:hidden');
    expect(within(phoneRows).getByRole('button', { name: /Labor/ })).toHaveTextContent(/120 of 100.*20 over/i);
    expect(within(table).getAllByText(formatNumberMax2(120))).toHaveLength(1);
    expect(within(table).getAllByText(/committed/)).toHaveLength(1);
    expect(within(table).getAllByText(/20 over/)).toHaveLength(1);
    expect(within(table).getByText(/20 over/)).toHaveClass('text-destructive-text');
    expect(within(table).queryByText(formatNumberMax2(500))).not.toBeInTheDocument();

    await userEvent.click(within(table).getByRole('button', { name: /expand labor/i }));
    const detail = screen.getByRole('region', { name: /labor line items/i });
    expect(detail).toHaveTextContent('Design');
    expect(detail).toHaveTextContent(formatNumberMax2(60));
    expect(detail).toHaveTextContent('Build');
    expect(detail).toHaveTextContent(formatNumberMax2(40));
  });

  it('shows a signed proposed change above the active table and keeps the draft editor available', () => {
    state.versions.data = [active() as unknown as BudgetVersionWithItems, draft() as unknown as BudgetVersionWithItems];
    state.position.rows = [{ category: 'Labor', budget: 100, actual: 30 }];
    renderPage();

    const proposed = screen.getByRole('region', { name: 'Proposed update' });
    expect(within(proposed).getByText('+25')).toHaveClass('text-destructive-text');
    expect(within(proposed).getByText('Current')).toBeInTheDocument();
    expect(within(proposed).getByText('Proposed')).toBeInTheDocument();
    expect(within(proposed).getByRole('button', { name: /add line item/i })).toBeInTheDocument();
    expect(within(proposed).getByRole('button', { name: /^Activate$/i })).toBeInTheDocument();
    expect(proposed.compareDocumentPosition(screen.getByRole('table', { name: 'Budget by category' })) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('withholds activation from an editor while retaining the finance approval guidance', () => {
    state.versions.data = [active() as unknown as BudgetVersionWithItems, draft({ editor_ids: ['u1'] }) as unknown as BudgetVersionWithItems];
    renderPage();

    const proposed = screen.getByRole('region', { name: 'Proposed update' });
    expect(within(proposed).queryByRole('button', { name: /^Activate$/i })).not.toBeInTheDocument();
    expect(within(proposed).getByText('Waiting for approval by finance')).toBeInTheDocument();
  });

  it('hides draft line editing on phone while keeping activation available', () => {
    state.role = 'Finance';
    state.versions.data = [draft() as unknown as BudgetVersionWithItems];
    renderPage();

    const addLine = screen.getByRole('button', { name: /add line item/i });
    expect(addLine.closest('[data-testid="budget-draft-editor"]')).toHaveClass('hidden', 'md:block');
    expect(screen.getByText('Edit the budget on a larger screen.')).toHaveClass('md:hidden');
    expect(screen.getByRole('button', { name: /^Activate$/i })).toBeInTheDocument();
  });

  it('lists versions and evidence in the drawer and compares any two versions', async () => {
    state.versions.data = [active() as unknown as BudgetVersionWithItems, draft() as unknown as BudgetVersionWithItems];
    renderPage();

    await userEvent.click(screen.getByRole('button', { name: 'Versions' }));
    const drawer = screen.getByRole('dialog', { name: 'Budget versions' });
    expect(within(drawer).getByText('Approved plan')).toBeInTheDocument();
    expect(within(drawer).getByText('Revised plan')).toBeInTheDocument();
    expect(within(drawer).getByTestId('evidence-v-active')).toBeInTheDocument();
    expect(within(drawer).getByTestId('evidence-v-draft')).toBeInTheDocument();

    await userEvent.click(within(drawer).getByRole('button', { name: 'Compare' }));
    await userEvent.selectOptions(within(drawer).getByRole('combobox', { name: 'Version A' }), 'v-active');
    await userEvent.selectOptions(within(drawer).getByRole('combobox', { name: 'Version B' }), 'v-draft');
    expect(within(drawer).getByRole('table', { name: 'Version comparison' })).toHaveTextContent('+25');
  });

  it('shows one setup link for categories without linked actuals, gated to accounting managers', () => {
    state.role = 'Admin';
    state.versions.data = [active() as unknown as BudgetVersionWithItems];
    state.position.rows = [{ category: 'Labor', budget: 100, actual: null }];
    state.position.unknown = 1;
    renderPage();

    const laborRow = screen.getByRole('row', { name: /Labor/i });
    expect(within(laborRow).getAllByRole('cell')[1]).toHaveTextContent(/^$/);
    expect(screen.getByRole('link', { name: 'Finish spending setup' })).toHaveAttribute('href', '/administration/accounting#budget-account-map');
    expect(screen.queryByText(/not available/i)).not.toBeInTheDocument();
  });

  it('keeps the spending setup action restricted to accounting managers', () => {
    state.versions.data = [active() as unknown as BudgetVersionWithItems];
    state.position.rows = [{ category: 'Labor', budget: 100, actual: null }];
    state.position.unknown = 1;
    state.role = 'Project Manager';
    renderPage();

    expect(screen.queryByRole('link', { name: 'Finish spending setup' })).not.toBeInTheDocument();
    expect(screen.getByText(/Spending isn't linked yet/)).toBeInTheDocument();
  });

  it('waits for spending to settle before calling it unlinked', () => {
    state.versions.data = [active() as unknown as BudgetVersionWithItems];
    state.position.rows = [{ category: 'Labor', budget: 100, actual: null }];
    state.position.unknown = 1;
    state.position.actualsPending = true;
    renderPage();

    expect(screen.getByText('Checking spending…')).toBeInTheDocument();
    expect(screen.queryByText(/Spending isn't linked yet/)).not.toBeInTheDocument();
  });

  it('offers retry for a failed spending read without claiming it is unlinked', async () => {
    state.role = 'Admin';
    state.versions.data = [active() as unknown as BudgetVersionWithItems];
    state.position.rows = [{ category: 'Labor', budget: 100, actual: null }];
    state.position.unknown = 1;
    state.position.actualsError = true;
    renderPage();

    const status = screen.getByText("Couldn't check spending.").closest<HTMLElement>('[role="status"]');
    expect(status).toBeInTheDocument();
    expect(screen.queryByText(/Spending isn't linked yet/)).not.toBeInTheDocument();
    await userEvent.click(within(status!).getByRole('button', { name: 'Retry' }));
    expect(state.position.refetchActuals).toHaveBeenCalledOnce();
  });

  it('keeps ERP enforcement status compact and visible only to Admin and Finance', async () => {
    state.versions.data = [active() as unknown as BudgetVersionWithItems];
    state.pushRows = [{ pushState: 'held', pushError: 'budget-category-unmapped', unmappedCategories: ['Labor'], fiscalYear: '2026', holdReleasable: true }];
    state.role = 'Project Manager';
    const hidden = renderPage();
    expect(screen.queryByText(/ERPNext is not enforcing/i)).not.toBeInTheDocument();
    hidden.unmount();

    state.role = 'Finance';
    renderPage();
    const notice = await screen.findByRole('status', { name: /ERP budget enforcement/i });
    expect(notice).toHaveTextContent('ERPNext is still enforcing the previous budget for this project.');
    expect(notice).toHaveTextContent('Labor');
    expect(notice).not.toHaveTextContent('budget-category-unmapped');
    expect(within(notice).getByRole('link', { name: /budget account map/i })).toHaveAttribute('href', '/administration/accounting#budget-account-map');
    await userEvent.click(within(notice).getByRole('button', { name: 'Retry the push' }));
    expect(state.retryPush).toHaveBeenCalledWith('p-1', '2026');
  });
});
