import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, renderHook, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { renderWithQueryClient } from '@/test/renderWithQueryClient';
import { ToastProvider } from '@/src/components/ui';
import type { ProjectWithRefs } from '@/src/lib/db/projects';

const state = vi.hoisted(() => ({
  role: 'Project Manager',
  forceInvoiceView: false,
  orgCurrency: 'IDR',
  fxRateCalls: [] as unknown[][],
  versions: [] as unknown[],
  finances: null as unknown,
  financePending: false,
  financeError: false,
  financeRefetch: vi.fn(),
  invoices: [] as unknown[],
  invoicesPending: false,
  invoicesError: false,
  invoicesRefetch: vi.fn(),
  milestones: [] as unknown[],
  milestonesPending: false,
  milestonesError: false,
  milestonesRefetch: vi.fn(),
  procurements: [] as unknown[],
  procurementsPending: false,
  procurementsError: false,
  procurementsRefetch: vi.fn(),
  billing: { contractLines: [] as unknown[] },
  boqItems: [] as unknown[],
  tasks: [] as unknown[],
}));

vi.mock('@/src/auth/usePermission', () => ({
  usePermission: () => (action: string, entity: string) => {
    if (entity === 'salesInvoice' && action === 'view') return state.forceInvoiceView || state.role !== 'Engineer';
    if (entity === 'salesInvoice' && action === 'create') return ['Admin', 'Executive', 'Finance'].includes(state.role);
    if (entity === 'milestone' && action !== 'view') return ['Admin', 'Project Manager'].includes(state.role);
    if (entity === 'project' && action === 'edit') return ['Admin', 'Project Manager'].includes(state.role);
    if (entity === 'procurement' && action === 'transition') return state.role !== 'Engineer';
    if (entity === 'procurement' && action === 'view') return true;
    return true;
  },
}));
vi.mock('@/src/auth/useAuth', () => ({
  useAuth: () => ({ currentUser: { id: 'viewer-1', org_id: 'org-1' }, role: state.role }),
}));
vi.mock('@/src/auth/impersonation', () => ({
  useEffectiveRole: () => ({ effectiveRole: state.role, realRole: state.role }),
}));
vi.mock('@/src/hooks/useBudget', () => ({
  useBudgetVersions: () => ({ data: state.versions, isPending: false, isError: false, refetch: vi.fn() }),
}));
vi.mock('@/src/hooks/useProjectFinances', () => ({
  useProjectFinances: () => ({ data: state.finances, isPending: state.financePending, isError: state.financeError, refetch: state.financeRefetch }),
}));
vi.mock('@/src/hooks/useRevenue', () => ({
  useSalesInvoices: () => ({ data: state.invoices, isPending: state.invoicesPending, isError: state.invoicesError, refetch: state.invoicesRefetch }),
}));
vi.mock('@/src/hooks/useFxOrgDay', () => ({
  useFxOrgDay: () => ({ day: '2026-10-27', isPending: false, isError: false, retry: vi.fn() }),
}));
vi.mock('@/src/hooks/useOrgCurrency', () => ({
  useOrgCurrencyState: () => ({ currency: state.orgCurrency, isResolved: true, isError: false }),
}));
vi.mock('@/src/hooks/useFxRates', () => ({
  useFxRate: (...args: unknown[]) => {
    state.fxRateCalls.push(args);
    return { data: { rate: 16_300, rate_date: '2026-10-09' }, isPending: false, isError: false, refetch: vi.fn() };
  },
}));
vi.mock('@/src/hooks/useMilestones', () => ({
  useMilestones: () => ({ data: state.milestones, isPending: state.milestonesPending, isError: state.milestonesError, refetch: state.milestonesRefetch }),
  useMilestoneMutations: () => ({ create: { mutateAsync: vi.fn() }, update: { mutateAsync: vi.fn() }, remove: { mutateAsync: vi.fn() } }),
}));
vi.mock('@/src/hooks/useProcurements', () => ({
  useProjectProcurements: () => ({ data: state.procurements, isPending: state.procurementsPending, isError: state.procurementsError, refetch: state.procurementsRefetch }),
  useProjectCommittedSpend: () => ({ data: 0, otherCurrencies: [], commitmentSource: 'pmo', ledgerBasis: 'erp', ownershipPending: false, ownershipError: false, isPending: false, isError: false, refetch: vi.fn() }),
}));
vi.mock('@/src/hooks/useProgressBilling', () => ({ useBoqItems: () => ({ data: state.boqItems, isPending: false, isError: false, refetch: vi.fn() }), useProjectBilling: () => ({ data: state.billing, isPending: false, isError: false, refetch: vi.fn() }) }));
vi.mock('@/src/hooks/useTasks', () => ({ useTasks: () => ({ data: state.tasks, isPending: false, isError: false, refetch: vi.fn() }) }));
vi.mock('../ProjectProfitLossSection', () => ({ default: () => null }));

import { useBudgetPosition, useOverdueReceivables, useProjectAttention } from '../useProjectPosition';
import { CostBlock, DeliveryBlock, MoneyBlock } from '../ProjectBlocks';
import { PrimaryProjectAction } from '../ProjectSections';
import { ProjectAttention } from '../ProjectAttention';
import { MyOpenTasks } from '../ProjectActivity';

const project = (overrides: Partial<ProjectWithRefs> = {}) => ({
  id: 'p1', status: 'Ongoing Project', currency: 'USD', contract_value: 1_000,
  contract_date: '2026-10-10', tax_treatment: null,
  ...overrides,
}) as ProjectWithRefs;

const budgetVersion = (lineItems: unknown[]) => ({
  id: 'bv1', status: 'Active', line_items: lineItems,
});

const actuals = (categories: unknown[], currency = 'USD') => ({ actuals: { currency, categories } });

const invoice = (overrides: Record<string, unknown> = {}) => ({
  id: 'inv-1', status: 'Submitted', invoice_date: '2026-10-01', erp_due_date: '2026-10-20',
  erp_payment_terms_days: 30, erp_outstanding_amount: '50', grand_total: '9999',
  ...overrides,
});

beforeEach(() => {
  state.role = 'Project Manager';
  state.forceInvoiceView = false;
  state.orgCurrency = 'IDR';
  state.fxRateCalls = [];
  state.versions = [];
  state.finances = null;
  state.financePending = false;
  state.financeError = false;
  state.financeRefetch.mockReset();
  state.invoices = [];
  state.invoicesPending = false;
  state.invoicesError = false;
  state.invoicesRefetch.mockReset();
  state.milestones = [];
  state.milestonesPending = false;
  state.milestonesError = false;
  state.milestonesRefetch.mockReset();
  state.procurements = [];
  state.procurementsPending = false;
  state.procurementsError = false;
  state.procurementsRefetch.mockReset();
  state.billing = { contractLines: [] };
  state.boqItems = [];
  state.tasks = [];
});

afterEach(() => vi.useRealTimers());

describe('project money position', () => {
  it('uses the organization day when deciding whether project phases are late', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-28T00:15:00.000Z'));
    state.milestones = [{ id: 'm1', name: 'Design', target_date: '2026-10-27', effective_pct: 40, task_count: 2 }];

    const { result } = renderHook(() => useProjectAttention(project(), 'pm'));
    expect(result.current.items.some((item) => item.key === 'phases')).toBe(false);
  });

  it('keeps spent unknown unless every Active-budget category has a mapped actual', () => {
    state.versions = [budgetVersion([
      { category: 'Labor', budgeted_amount: '100' },
      { category: 'Materials', budgeted_amount: '100' },
    ])];
    state.finances = actuals([
      { category: 'Labor', mapped: true, amount: '90' },
      { category: 'Materials', mapped: false, amount: '20' },
    ]);

    const { result } = renderHook(() => useBudgetPosition(project()));
    expect(result.current.spent).toBeNull();
    expect(result.current.unknown).toBe(1);
  });

  it('withholds budget comparisons when actuals are in another currency', () => {
    state.versions = [budgetVersion([{ category: 'Labor', budgeted_amount: '100' }])];
    state.finances = actuals([{ category: 'Labor', mapped: true, amount: '90' }], 'EUR');

    const { result } = renderHook(() => useBudgetPosition(project()));
    expect(result.current.rows[0]?.actual).toBeNull();
    expect(result.current.spent).toBeNull();
    expect(result.current.unknown).toBe(1);
  });

  it('sorts known over-budget categories by the largest overrun first', () => {
    state.versions = [budgetVersion([
      { category: 'Labor', budgeted_amount: '100' },
      { category: 'Materials', budgeted_amount: '100' },
      { category: 'Equipment', budgeted_amount: '100' },
    ])];
    state.finances = actuals([
      { category: 'Labor', mapped: true, amount: '140' },
      { category: 'Materials', mapped: true, amount: '180' },
      { category: 'Equipment', mapped: true, amount: '120' },
    ]);

    const { result } = renderHook(() => useBudgetPosition(project()));
    expect(result.current.overRows.map((row) => row.category)).toEqual(['Materials', 'Labor', 'Equipment']);
    expect(result.current.spent).toBe(440);
  });

  it('uses only complete unpaid balances for overdue receivables and otherwise shows age without invoice totals', () => {
    state.invoices = [
      invoice({ id: 'inv-1', erp_due_date: '2026-10-20', erp_outstanding_amount: '50', grand_total: '9999' }),
      invoice({ id: 'inv-2', erp_due_date: '2026-10-23', erp_outstanding_amount: null, grand_total: '8888' }),
    ];

    const { result } = renderHook(() => useOverdueReceivables(project()));
    expect(result.current.data).toMatchObject({ count: 2, oldest: 7, balance: null });

    const attention = renderHook(() => useProjectAttention(project(), 'money'));
    const ar = attention.result.current.items.find((item) => item.key === 'ar');
    expect(ar?.size).toBe('7 days past due');
    expect(ar?.size).not.toContain('9999');
    expect(ar?.size).not.toContain('8888');
  });

  it('shows the summed unpaid balance only when every overdue invoice balance is known', () => {
    state.invoices = [
      invoice({ id: 'inv-1', erp_due_date: '2026-10-20', erp_outstanding_amount: '50' }),
      invoice({ id: 'inv-2', erp_due_date: '2026-10-23', erp_outstanding_amount: '25' }),
    ];

    const { result } = renderHook(() => useOverdueReceivables(project()));
    expect(result.current.data).toMatchObject({ count: 2, oldest: 7, balance: 75 });
  });

  it('collects over-budget, overdue, late-phase and waiting-request actions with danger items first', () => {
    const twoDaysAgo = new Date(Date.now() - 2 * 86_400_000).toISOString().slice(0, 10);
    state.versions = [budgetVersion([{ category: 'Labor', budgeted_amount: '100' }])];
    state.finances = actuals([{ category: 'Labor', mapped: true, amount: '130' }]);
    state.invoices = [invoice({ id: 'inv-1', erp_due_date: '2026-10-20', erp_outstanding_amount: '40' })];
    state.milestones = [{ id: 'm1', name: 'Design', target_date: twoDaysAgo, effective_pct: 40, task_count: 2 }];
    state.procurements = [{
      id: 'req-1', status: 'Requested', requested_by_id: 'another-user',
      approvalRoute: { route: 'flat', approvers: [] },
    }];

    const { result } = renderHook(() => useProjectAttention(project(), 'pm'));
    expect(result.current.items.map((item) => item.key)).toEqual(['budget', 'ar', 'phases', 'approve']);
    // N16: a late phase carries the same red as the phase rows, not the warning tone.
    expect(result.current.items.find((item) => item.key === 'phases')?.tone).toBe('danger');
    expect(result.current.items.slice(0, 2).every((item) => item.tone === 'danger')).toBe(true);
    expect(result.current.items[0]).toMatchObject({ what: 'Project over budget', to: '/projects/p1/budget' });
    expect(result.current.items[1]?.size).toContain('40 USD unpaid');
    expect(result.current.items[2]?.what).toContain('Design');
    expect(result.current.items[3]?.what).toBe('Procurement waiting for your approval');
  });

  it('shows the Engineer only their overdue or blocked task attention', () => {
    state.role = 'Engineer';
    // Exercise the lens rule independently of the invoice permission gate: even if a stale or
    // overbroad reader supplies receivables, the delivery lens must not surface money attention.
    state.forceInvoiceView = true;
    state.versions = [budgetVersion([{ category: 'Labor', budgeted_amount: '100' }])];
    state.finances = actuals([{ category: 'Labor', mapped: true, amount: '130' }]);
    state.invoices = [invoice()];
    state.milestones = [{ id: 'm1', name: 'Late phase', target_date: '2000-01-01', effective_pct: 40, task_count: 2 }];
    state.procurements = [{ id: 'req-1', status: 'Requested', requested_by_id: 'other', approvalRoute: { route: 'flat', approvers: [] } }];
    state.tasks = [
      { id: 'task-1', name: 'Review drawings', status: 'Blocked', assignee_id: 'viewer-1', end_date: '2000-01-01' },
      { id: 'task-2', name: 'Someone else task', status: 'Blocked', assignee_id: 'other', end_date: '2000-01-01' },
      { id: 'task-3', name: 'Finished task', status: 'Done', assignee_id: 'viewer-1', end_date: '2000-01-01' },
    ];

    const { result } = renderHook(() => useProjectAttention(project(), 'delivery'));
    expect(result.current.items).toHaveLength(1);
    expect(result.current.items[0]).toMatchObject({
      key: 'task-task-1', what: 'Review drawings is blocked', tone: 'danger',
      action: 'Open task', to: '/projects/p1/tasks?open=task-1',
    });
    expect(result.current.items[0]?.what).not.toContain('budget');
  });

  it.each(['milestones', 'budget actuals', 'receivables', 'procurements'])(
    'does not declare the project clear while %s is pending', (source) => {
      if (source === 'milestones') state.milestonesPending = true;
      if (source === 'budget actuals') {
        state.versions = [budgetVersion([{ category: 'Labor', budgeted_amount: '100' }])];
        state.financePending = true;
      }
      if (source === 'receivables') state.invoicesPending = true;
      if (source === 'procurements') state.procurementsPending = true;

      const { result } = renderHook(() => useProjectAttention(project(), 'pm'));
      expect(result.current.isPending).toBe(true);
      const view = render(<ProjectAttention items={result.current.items} isPending={result.current.isPending} />);
      expect(view.getByRole('heading', { name: 'Needs attention' })).toBeInTheDocument();
      expect(view.queryByText(/Nothing needs you/i)).not.toBeInTheDocument();
    },
  );

  it('reports one failed spending check with a retry instead of a clear state', async () => {
    state.versions = [budgetVersion([{ category: 'Labor', budgeted_amount: '100' }])];
    state.financeError = true;
    const { result } = renderHook(() => useProjectAttention(project(), 'pm'));
    const view = render(
      <ProjectAttention items={result.current.items} isPending={result.current.isPending} error={result.current.error} />,
    );
    expect(view.getByText("Couldn't check spending")).toBeInTheDocument();
    expect(view.queryByText(/Nothing needs you/i)).not.toBeInTheDocument();
    await userEvent.click(view.getByRole('button', { name: 'Retry' }));
    expect(state.financeRefetch).toHaveBeenCalled();
  });
});

describe('project primary invoice action', () => {
  it('prioritizes Chase payment while an invoice is overdue', async () => {
    state.role = 'Finance';
    state.finances = { remaining_to_invoice: 500 };
    state.invoices = [invoice({ erp_due_date: '2026-10-20', erp_outstanding_amount: '50' })];

    renderWithQueryClient(
      <MemoryRouter><PrimaryProjectAction project={project()} isPipeline={false} /></MemoryRouter>,
    );
    expect(screen.getByRole('button', { name: 'Chase payment' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Raise invoice' })).not.toBeInTheDocument();
  });

  it('offers Raise invoice at the five-percent remaining threshold and nothing below it', () => {
    state.role = 'Finance';
    state.invoices = [];
    state.finances = { remaining_to_invoice: 50 };
    const view = renderWithQueryClient(
      <MemoryRouter><PrimaryProjectAction project={project()} isPipeline={false} /></MemoryRouter>,
    );
    expect(screen.getByRole('button', { name: 'Raise invoice' })).toBeInTheDocument();

    view.unmount();
    state.finances = { remaining_to_invoice: 49 };
    renderWithQueryClient(
      <MemoryRouter><PrimaryProjectAction project={project()} isPipeline={false} /></MemoryRouter>,
    );
    expect(screen.queryByRole('button', { name: 'Raise invoice' })).not.toBeInTheDocument();
  });

  it.each([
    ['pipeline deal', 'Finance', true],
    ['role without invoice permission', 'Engineer', false],
  ])('offers no invoice action for a %s', (_case, role, isPipeline) => {
    state.role = role;
    state.finances = { remaining_to_invoice: 500 };
    state.invoices = [];

    renderWithQueryClient(
      <MemoryRouter><PrimaryProjectAction project={project()} isPipeline={isPipeline} /></MemoryRouter>,
    );
    expect(screen.queryByRole('button', { name: 'Chase payment' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Raise invoice' })).not.toBeInTheDocument();
  });

  it('uses accepted unclaimed contract quantities when contract lines exist', () => {
    state.role = 'Finance';
    state.invoices = [];
    state.finances = { remaining_to_invoice: 10 };
    state.billing = { contractLines: [{ allocations: [
      { acceptedQuantity: 8, claimedQuantity: 5 },
      { acceptedQuantity: 4, claimedQuantity: 4 },
    ] }] };

    renderWithQueryClient(
      <MemoryRouter><PrimaryProjectAction project={project()} isPipeline={false} /></MemoryRouter>,
    );
    expect(screen.getByRole('button', { name: 'Raise invoice' })).toBeInTheDocument();
  });

  it('does not raise an invoice when all accepted contract quantities have been claimed', () => {
    state.role = 'Finance';
    state.invoices = [];
    state.finances = { remaining_to_invoice: 500 };
    state.billing = { contractLines: [{ allocations: [
      { acceptedQuantity: 8, claimedQuantity: 8 },
    ] }] };

    renderWithQueryClient(
      <MemoryRouter><PrimaryProjectAction project={project()} isPipeline={false} /></MemoryRouter>,
    );
    expect(screen.queryByRole('button', { name: 'Raise invoice' })).not.toBeInTheDocument();
  });

  it('offers only Chase payment in contract-only mode', () => {
    state.role = 'Finance';
    state.invoices = [];
    state.finances = { remaining_to_invoice: 500 };
    renderWithQueryClient(
      <MemoryRouter><PrimaryProjectAction project={project()} isPipeline={false} chaseOnly /></MemoryRouter>,
    );
    expect(screen.queryByRole('button', { name: 'Raise invoice' })).not.toBeInTheDocument();
  });

  it('takes Raise invoice to Contract & billing and omits it in contract-only mode', async () => {
    state.role = 'Finance';
    state.invoices = [];
    state.finances = { remaining_to_invoice: 50 };
    renderWithQueryClient(
      <MemoryRouter initialEntries={['/projects/p1/overview']}>
        <Routes>
          <Route path="/projects/p1/overview" element={<PrimaryProjectAction project={project()} isPipeline={false} />} />
          <Route path="/projects/p1/contract" element={<p>Contract &amp; billing surface</p>} />
        </Routes>
      </MemoryRouter>,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Raise invoice' }));
    expect(screen.getByText('Contract & billing surface')).toBeInTheDocument();
  });
});

describe('pipeline overview blocks and engineer task links', () => {
  it('keeps the pre-win budget estimate while making the phase planner reachable', () => {
    state.versions = [budgetVersion([{ category: 'Labor', budgeted_amount: '100' }])];
    state.finances = actuals([{ category: 'Labor', mapped: true, amount: '150' }]);
    state.milestones = [{ id: 'm1', name: 'Should not leak', weight: 1, effective_pct: 50, target_date: null, task_count: 1 }];
    renderWithQueryClient(
      <ToastProvider><MemoryRouter>
        <CostBlock project={project({ budget: 1200 })} isPipeline />
        <DeliveryBlock projectId="p1" isPipeline />
      </MemoryRouter></ToastProvider>,
    );
    expect(screen.getByText('Estimated budget 1,200')).toBeInTheDocument();
    expect(screen.getByText('Should not leak')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add phase' })).toBeInTheDocument();
    expect(screen.queryByText(/over budget|within budget/i)).not.toBeInTheDocument();
  });

  it('keeps an unknown budget total without a false within-budget claim and names one setup fix', () => {
    state.role = 'Admin';
    state.versions = [budgetVersion([{ category: 'Labor', budgeted_amount: '100' }])];
    state.finances = actuals([{ category: 'Labor', mapped: false, amount: null }]);
    renderWithQueryClient(<MemoryRouter><CostBlock project={project()} /></MemoryRouter>);
    expect(screen.getByText('Budget 100')).toBeInTheDocument();
    expect(screen.queryByText(/within budget/i)).not.toBeInTheDocument();
    expect(screen.getByText("Spending isn't linked yet.")).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Finish spending setup' })).toHaveAttribute('href', '/administration/accounting#budget-account-map');
    expect(screen.queryByText(/categories have no spending linked yet/i)).not.toBeInTheDocument();
  });

  it('shows category rows worst first and opens the Budget area from a category row', () => {
    state.role = 'Admin';
    state.versions = [budgetVersion([
      { category: 'Labor', budgeted_amount: '100' },
      { category: 'Materials', budgeted_amount: '100' },
    ])];
    state.finances = actuals([
      { category: 'Labor', mapped: true, amount: '150' },
      { category: 'Materials', mapped: true, amount: '50' },
    ]);
    renderWithQueryClient(<MemoryRouter><CostBlock project={project()} /></MemoryRouter>);
    const links = screen.getAllByRole('link', { name: /Open .* in Budget/ });
    expect(links.map((link) => link.getAttribute('aria-label'))).toEqual([
      'Open Labor in Budget', 'Open Materials in Budget',
    ]);
    expect(links[0]).toHaveAttribute('href', '/projects/p1/budget');
  });

  it('keeps phase editing reachable on phone layouts', () => {
    renderWithQueryClient(<MemoryRouter><DeliveryBlock projectId="p1" /></MemoryRouter>);
    expect(screen.getByRole('button', { name: 'Update phases' })).not.toHaveClass('max-md:hidden');
  });

  it('links an overdue task to its task anchor and uses destructive text for urgency', () => {
    state.tasks = [{ id: 'task-17', name: 'Review drawings', status: 'In Progress', assignee_id: 'viewer-1', end_date: '2000-01-01' }];
    renderWithQueryClient(<MemoryRouter><MyOpenTasks projectId="p1" /></MemoryRouter>);
    expect(screen.getByRole('link', { name: /Review drawings/i })).toHaveAttribute('href', '/projects/p1/tasks?open=task-17');
    expect(screen.getByText(/Overdue ·/)).toHaveClass('text-destructive-text');
  });
});

describe('contract billing block', () => {
  it('AC-1402-M1/M5/M6 keeps full finance provenance in a quiet Money position Details disclosure', async () => {
    state.role = 'Finance';
    state.finances = {
      contract_invoiced: '250', remaining_to_invoice: '750',
      invoices: [{ currency: 'USD', invoice_count: 2, invoiced: '250', settled: '100', outstanding: '150', missing_outstanding: 0, work_revenue: '230', tax_basis: 'mixed' }],
      cash_received: { state: 'known', buckets: [{ currency: 'USD', amount: '100' }] },
      actuals: { currency: 'USD', total: '100.00', as_of: '2026-10-25T00:00:00Z', excludes_restricted_rows: true, tagged_total: '80.00', attributed_total: '20.00', categories: [{ category: 'Labor', mapped: true, amount: '100.00', attributed_amount: '20.00' }, { category: 'Travel', mapped: false, amount: null }] },
    };
    state.versions = [budgetVersion([{ category: 'Labor', budgeted_amount: '200' }])];

    renderWithQueryClient(<MemoryRouter><MoneyBlock project={project()} /></MemoryRouter>);

    await userEvent.click(screen.getByText('Details', { exact: true }));
    expect(screen.getByText('Project finances')).toBeInTheDocument();
    expect(screen.getByText('2 invoices')).toBeInTheDocument();
    expect(screen.getByText(/Updated/)).toBeInTheDocument();
    expect(screen.getByText('Spending setup details')).toBeInTheDocument();
    expect(screen.getByText('Show category details')).toBeInTheDocument();
    expect(screen.getByText('Contract remaining after cost')).toBeInTheDocument();
    const currencySection = within(screen.getByTestId('project-finances-USD'));
    expect(currencySection.getByText('Invoiced')).toBeInTheDocument();
    expect(currencySection.getByText('Settled')).toBeInTheDocument();
    expect(currencySection.getByText('Outstanding')).toBeInTheDocument();
    expect(currencySection.getByText('Billed-work revenue')).toBeInTheDocument();
    expect(currencySection.getByText('Mixed tax bases')).toBeInTheDocument();
    expect(screen.getByText('Remaining to invoice')).toBeInTheDocument();
  });

  it('shows the contract-to-paid cascade from BoQ, work-order allocation, and invoice facts', () => {
    state.boqItems = [{ id: 'boq-1', quantity: 10, rate: 100 }];
    state.billing = { contractLines: [{ allocations: [
      { boqItemId: 'boq-1', quantity: 5, acceptedQuantity: 4 },
    ] }] };
    state.invoices = [{ ...invoice(), currency: 'USD', amount: 250, erp_outstanding_amount: 50 }];
    state.finances = {
      contract_invoiced: '250', remaining_to_invoice: '750', invoices: [],
      cash_received: { state: 'known', buckets: [{ currency: 'USD', amount: '150' }], receipt_count: 1 },
      actuals: { currency: 'USD', total: '100.00', as_of: null, excludes_restricted_rows: false, categories: [] },
    };

    renderWithQueryClient(<MemoryRouter><MoneyBlock project={project()} /></MemoryRouter>);
    expect(screen.getByRole('heading', { name: 'Money position' })).toBeInTheDocument();
    // L5: one answer leads, biggest — the invoiced share of the contract — and the cascade follows as a compact strip.
    expect(screen.getByText('25% invoiced')).toHaveClass('text-2xl');
    expect(screen.getByText('20% paid')).toBeInTheDocument();
    expect(screen.getByRole('progressbar', { name: 'Delivered is 40% of contract' })).toBeInTheDocument();
    expect(screen.getByText('1,000')).toBeInTheDocument();
    expect(screen.getByText('500')).toBeInTheDocument();
    expect(screen.getByText('400')).toBeInTheDocument();
    expect(screen.getByText('250')).toBeInTheDocument();
    expect(screen.getByText('200')).toBeInTheDocument();
  });

  it('explains settled invoice value that has no matched receipt and links to matching', () => {
    state.boqItems = [{ id: 'boq-1', quantity: 10, rate: 100 }];
    state.billing = { contractLines: [] };
    state.invoices = [{ ...invoice(), currency: 'USD', amount: 250, erp_outstanding_amount: 50 }];
    state.finances = {
      contract_invoiced: '250', remaining_to_invoice: '750', invoices: [],
      cash_received: { state: 'known', buckets: [{ currency: 'USD', amount: '150' }], receipt_count: 1 },
      actuals: { currency: 'USD', total: '100.00', as_of: null, excludes_restricted_rows: false, categories: [] },
    };

    renderWithQueryClient(<MemoryRouter><MoneyBlock project={project()} /></MemoryRouter>);
    expect(screen.getByText(/50 is settled in accounting but no receipt is matched to it yet\./)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Match payments' })).toHaveAttribute('href', '/incoming-payments');
  });

  it('AC-FX-011: shows the contract equivalent using the project contract date', () => {
    state.finances = {
      contract_invoiced: '100', remaining_to_invoice: '900', invoices: [],
      cash_received: { state: 'known', buckets: [{ currency: 'USD', amount: '0' }] },
    };

    renderWithQueryClient(
      <MemoryRouter><MoneyBlock project={project()} /></MemoryRouter>,
    );
    expect(screen.getAllByText('≈ Rp 16,300,000 (JISDOR 2026-10-09)').length).toBeGreaterThan(0);
    expect(state.fxRateCalls).toContainEqual(['USD', 'IDR', '2026-10-10', true]);
  });

  it('AC-FX-011: shows no contract equivalent when the date is missing or the contract is already IDR', () => {
    state.finances = {
      contract_invoiced: '100', remaining_to_invoice: '900', invoices: [],
      cash_received: { state: 'known', buckets: [{ currency: 'USD', amount: '0' }] },
    };
    const withoutContractDate = renderWithQueryClient(
      <MemoryRouter><MoneyBlock project={project({ contract_date: null })} /></MemoryRouter>,
    );
    expect(screen.queryByText(/JISDOR|No JISDOR rate/i)).not.toBeInTheDocument();
    expect(state.fxRateCalls).toContainEqual(['USD', 'IDR', null, false]);
    withoutContractDate.unmount();

    state.fxRateCalls = [];
    renderWithQueryClient(
      <MemoryRouter><MoneyBlock project={project({ currency: 'IDR' })} /></MemoryRouter>,
    );
    expect(screen.queryByText(/JISDOR/)).not.toBeInTheDocument();
    expect(state.fxRateCalls).toContainEqual(['USD', 'IDR', '2026-10-10', false]);
  });

  it('omits unknown received values and offers Match payments without a not-available figure', () => {
    state.finances = {
      contract_invoiced: '100',
      remaining_to_invoice: null,
      invoices: [{ currency: 'USD', missing_outstanding: 1, outstanding: null }],
      cash_received: { state: 'unknown', buckets: [] },
    };

    renderWithQueryClient(
      <MemoryRouter><MoneyBlock project={project()} /></MemoryRouter>,
    );
    expect(screen.getByText('Money position')).toBeInTheDocument();
    expect(screen.getByText('Match payments')).toHaveAttribute('href', '/incoming-payments');
    // C4: an unknown cash figure is left out (no label with a placeholder value); the reason is said once.
    expect(screen.queryByText('Cash received', { exact: true })).not.toBeInTheDocument();
    expect(screen.queryByText(/Unavailable|Not available/)).not.toBeInTheDocument();
    expect(screen.queryByText('Received', { exact: true })).not.toBeInTheDocument();
    expect(screen.queryByText('Outstanding', { exact: true })).not.toBeInTheDocument();
    expect(screen.getByText('Receipt-backed cash is not available yet.')).toBeInTheDocument();
  });
});

describe('overview restructure rulings (L5/L6/L10/C4/L12)', () => {
  it('L6/C4: Money position keeps each figure once — no spent-vs-budget pair, no placeholder margin — and says why margin is left out', () => {
    state.role = 'Admin';
    state.versions = [budgetVersion([{ category: 'Labor', budgeted_amount: '100' }])];
    state.invoices = [{ ...invoice(), currency: 'USD', amount: 250, erp_outstanding_amount: 50 }];
    state.finances = {
      contract_invoiced: '250', remaining_to_invoice: '750',
      invoices: [{ currency: 'USD', invoice_count: 1, invoiced: '250', settled: '200', outstanding: '50', missing_outstanding: 0, work_revenue: '230', tax_basis: 'exclusive' }],
      cash_received: { state: 'known', buckets: [{ currency: 'USD', amount: '200' }] },
      actuals: { currency: 'USD', total: null, as_of: null, excludes_restricted_rows: false, categories: [{ category: 'Labor', mapped: false, amount: null }] },
    };
    renderWithQueryClient(<MemoryRouter><MoneyBlock project={project()} /></MemoryRouter>);
    const money = screen.getByRole('region', { name: /Money position/ });
    expect(within(money).queryByText('Spent vs budget')).not.toBeInTheDocument();
    expect(within(money).queryByText('Gross margin')).not.toBeInTheDocument();
    expect(within(money).queryByText(/Unavailable/)).not.toBeInTheDocument();
    expect(within(money).getAllByText(/Gross margin is left out/)).toHaveLength(1);
    expect(within(money).getByText('Cash received')).toBeInTheDocument();
  });

  it('L6: shows a known gross margin in whole units with no .00', () => {
    state.role = 'Admin';
    state.invoices = [{ ...invoice(), currency: 'USD', amount: 250, erp_outstanding_amount: 50 }];
    state.finances = {
      contract_invoiced: '250', remaining_to_invoice: '750',
      invoices: [{ currency: 'USD', invoice_count: 1, invoiced: '250', settled: '200', outstanding: '50', missing_outstanding: 0, work_revenue: '1230.00', tax_basis: 'exclusive' }],
      cash_received: { state: 'known', buckets: [{ currency: 'USD', amount: '200' }] },
      actuals: { currency: 'USD', total: '1000.00', as_of: null, excludes_restricted_rows: false, categories: [{ category: 'Labor', mapped: true, amount: '1000.00' }] },
    };
    renderWithQueryClient(<MemoryRouter><MoneyBlock project={project()} /></MemoryRouter>);
    const money = screen.getByRole('region', { name: /Money position/ });
    expect(within(money).getByText('Gross margin')).toBeInTheDocument();
    expect(within(money).getByText('230')).toBeInTheDocument();
    expect(within(money).queryByText(/\.00/)).not.toBeInTheDocument();
  });

  it('C4: Money position names why cash received is left out — incomplete allocation or an unverified reading', () => {
    state.finances = { contract_invoiced: '100', remaining_to_invoice: '900', invoices: [],
      cash_received: { state: 'incomplete', buckets: [], receipt_count: 1, reasons: ['allocation-unreported'] } };
    const first = renderWithQueryClient(<MemoryRouter><MoneyBlock project={project()} /></MemoryRouter>);
    expect(screen.getByText(/Cash received is left out until every receipt is allocated to an invoice\./)).toBeInTheDocument();
    first.unmount();
    state.finances = { contract_invoiced: '100', remaining_to_invoice: '900', invoices: [],
      cash_received: { state: 'unavailable', buckets: [], reason: 'invalid-reading' } };
    renderWithQueryClient(<MemoryRouter><MoneyBlock project={project()} /></MemoryRouter>);
    expect(screen.getByText(/Cash received is left out because the receipt reading couldn't be verified\./)).toBeInTheDocument();
  });

  it('AC-UWC-009: Money position shows known cash received — a known zero stays 0, and only the project-currency bucket counts', () => {
    state.finances = { contract_invoiced: '100', remaining_to_invoice: '900', invoices: [],
      cash_received: { state: 'known', buckets: [], receipt_count: 0 } };
    const first = renderWithQueryClient(<MemoryRouter><MoneyBlock project={project()} /></MemoryRouter>);
    expect(screen.getByText('Cash received', { exact: true }).parentElement!).toHaveTextContent(/Cash received\s*0$/);
    first.unmount();
    state.finances = { contract_invoiced: '100', remaining_to_invoice: '900', invoices: [],
      cash_received: { state: 'known', buckets: [{ currency: 'USD', amount: '30.00' }, { currency: 'IDR', amount: '7.00' }], receipt_count: 2 } };
    renderWithQueryClient(<MemoryRouter><MoneyBlock project={project()} /></MemoryRouter>);
    expect(screen.getByText('Cash received', { exact: true }).parentElement!).toHaveTextContent(/Cash received\s*30$/);
  });

  it('L10: the phase timeline lists phases only, marks an overdue phase, and links to Tasks › Timeline instead of embedding the Gantt', () => {
    state.milestones = [
      { id: 'phase-1', project_id: 'p1', name: 'Design', sort_order: 1, target_date: '2000-01-15', weight: 1, input_pct: null, task_count: 2, calculated_pct: 50, effective_pct: 50 },
      { id: 'phase-2', project_id: 'p1', name: 'Build', sort_order: 2, target_date: '2999-06-01', weight: 3, input_pct: null, task_count: 0, calculated_pct: 0, effective_pct: 0 },
    ];
    state.tasks = [
      { id: 't1', name: 'Survey the site in detail', status: 'Done', milestone_id: 'phase-1', start_date: '2000-01-01', end_date: '2000-01-05', dependencies: [] },
      { id: 't2', name: 'Draw the plans', status: 'In Progress', milestone_id: 'phase-1', start_date: '2000-01-06', end_date: '2000-01-10', dependencies: [] },
    ];
    renderWithQueryClient(<ToastProvider><MemoryRouter><DeliveryBlock projectId="p1" /></MemoryRouter></ToastProvider>);
    const block = screen.getByRole('region', { name: 'Phase timeline' });
    expect(within(block).queryByText('Survey the site in detail')).not.toBeInTheDocument();
    expect(within(block).queryByText(/larger screen/i)).not.toBeInTheDocument();
    expect(within(block).getByRole('link', { name: 'Open timeline' })).toHaveAttribute('href', '/projects/p1/tasks?view=timeline');
    expect(within(block).getByRole('progressbar', { name: 'Design 50% complete' })).toBeInTheDocument();
    expect(within(block).getByText(/Overdue/)).toBeInTheDocument();
    expect(within(block).getByText('25% of project')).toBeInTheDocument();
  });

  it('L12: Budget vs actual counts committed spend from the same calculation as the Budget tab, Uncategorized included', () => {
    state.role = 'Admin';
    state.versions = [budgetVersion([{ category: 'Labor', budgeted_amount: '1000' }])];
    state.finances = actuals([{ category: 'Labor', mapped: true, amount: '100' }]);
    state.procurements = [
      { status: 'Ordered', budget_category: 'Labor', approved_total_value: 300, total_value: 300, currency: 'USD' },
      { status: 'Vendor Invoiced', budget_category: null, approved_total_value: null, total_value: 62, currency: 'USD' },
      { status: 'Approved', budget_category: 'Labor', approved_total_value: 999, total_value: 999, currency: 'USD' },
    ];
    renderWithQueryClient(<MemoryRouter><CostBlock project={project()} /></MemoryRouter>);
    expect(screen.getByText('Plus 362 committed in purchase orders')).toBeInTheDocument();
    // L12: the Overview's use and headroom are the Budget tab's (spent + committed): 462 of 1,000.
    expect(screen.getByText(/46% used/)).toHaveTextContent('538 remaining');
  });
});

describe('project phase and budget feature floor', () => {
  it('AC-1402-M3 lets permitted owners plan phases for a pre-win project', async () => {
    renderWithQueryClient(<ToastProvider><MemoryRouter><DeliveryBlock projectId="p1" isPipeline /></MemoryRouter></ToastProvider>);
    expect(await screen.findByRole('button', { name: 'Plan delivery phases' })).toBeInTheDocument();
  });

  it('AC-1402-M3 keeps pre-win phase planning unavailable to engineers', async () => {
    state.role = 'Engineer';
    renderWithQueryClient(<ToastProvider><MemoryRouter><DeliveryBlock projectId="p1" isPipeline /></MemoryRouter></ToastProvider>);
    expect(await screen.findByText(/planning starts once this is won/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Plan delivery phases' })).not.toBeInTheDocument();
  });

  it('AC-1402-R4 exposes full phase details to read-only project readers', async () => {
    state.milestones = [{ id: 'phase-1', project_id: 'p1', name: 'Design', sort_order: 1, target_date: null, weight: 2, input_pct: null, task_count: 2, calculated_pct: 50, effective_pct: 50 }];
    state.tasks = [
      { id: 'blocked-1', name: 'Approve drawings', status: 'Blocked', milestone_id: 'phase-1' },
      { id: 'done-1', name: 'Survey site', status: 'Done', milestone_id: 'phase-1' },
    ];
    state.role = 'Engineer';

    renderWithQueryClient(<ToastProvider><MemoryRouter><DeliveryBlock projectId="p1" /></MemoryRouter></ToastProvider>);

    expect(await screen.findByTestId('phase-read-details')).toHaveTextContent('Current phase');
    expect(screen.getByRole('region', { name: 'Phase timeline' })).toHaveTextContent('Design');
    expect(screen.getByText('1 of 2 tasks')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Approve drawings' })).toHaveAttribute('href', '/projects/p1/tasks?open=blocked-1');
    expect(screen.queryByRole('button', { name: 'Update phases' })).not.toBeInTheDocument();
  });

  it('AC-1402-M7 shows remaining budget, total use and eligible At risk status', async () => {
    state.versions = [budgetVersion([{ category: 'Labor', budgeted_amount: '100' }])];
    state.finances = { actuals: { currency: 'USD', total: '95', as_of: null, excludes_restricted_rows: false, categories: [{ category: 'Labor', mapped: true, amount: '95' }] } };

    renderWithQueryClient(<MemoryRouter><CostBlock project={project()} /></MemoryRouter>);

    expect(await screen.findByText(/5 remaining/)).toBeInTheDocument();
    expect(screen.getByText(/95% used/)).toBeInTheDocument();
    expect(screen.getByText('At risk')).toBeInTheDocument();
  });
});
