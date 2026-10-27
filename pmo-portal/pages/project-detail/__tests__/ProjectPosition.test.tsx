import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, renderHook, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { renderWithQueryClient } from '@/test/renderWithQueryClient';
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
  tasks: [] as unknown[],
}));

vi.mock('@/src/auth/usePermission', () => ({
  usePermission: () => (action: string, entity: string) => {
    if (entity === 'salesInvoice' && action === 'view') return state.forceInvoiceView || state.role !== 'Engineer';
    if (entity === 'salesInvoice' && action === 'create') return ['Admin', 'Executive', 'Finance'].includes(state.role);
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
}));
vi.mock('@/src/hooks/useProcurements', () => ({
  useProjectProcurements: () => ({ data: state.procurements, isPending: state.procurementsPending, isError: state.procurementsError, refetch: state.procurementsRefetch }),
  useProjectCommittedSpend: () => ({ data: 0, isPending: false, isError: false, refetch: vi.fn() }),
}));
vi.mock('@/src/hooks/useProgressBilling', () => ({ useProjectBilling: () => ({ data: state.billing, isPending: false, isError: false, refetch: vi.fn() }) }));
vi.mock('@/src/hooks/useTasks', () => ({ useTasks: () => ({ data: state.tasks, isPending: false, isError: false, refetch: vi.fn() }) }));

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
  state.tasks = [];
});

describe('project money position', () => {
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
    expect(result.current.items.slice(0, 2).every((item) => item.tone === 'danger')).toBe(true);
    expect(result.current.items[0]).toMatchObject({ what: 'Project over budget', to: '/projects/p1/budget' });
    expect(result.current.items[1]?.size).toContain('40 USD unpaid');
    expect(result.current.items[2]?.what).toContain('Design');
    expect(result.current.items[3]?.what).toBe('Procurement waiting for your approval');
  });

  it('returns no attention items for the Engineer delivery lens', () => {
    state.role = 'Engineer';
    // Exercise the lens rule independently of the invoice permission gate: even if a stale or
    // overbroad reader supplies receivables, the delivery lens must not surface money attention.
    state.forceInvoiceView = true;
    state.versions = [budgetVersion([{ category: 'Labor', budgeted_amount: '100' }])];
    state.finances = actuals([{ category: 'Labor', mapped: true, amount: '130' }]);
    state.invoices = [invoice()];
    state.milestones = [{ id: 'm1', name: 'Late phase', target_date: '2000-01-01', effective_pct: 40, task_count: 2 }];
    state.procurements = [{ id: 'req-1', status: 'Requested', requested_by_id: 'other', approvalRoute: { route: 'flat', approvers: [] } }];

    const { result } = renderHook(() => useProjectAttention(project(), 'delivery'));
    expect(result.current.items).toEqual([]);
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
  it('shows only the pre-win estimated budget and planned-phases line', () => {
    state.versions = [budgetVersion([{ category: 'Labor', budgeted_amount: '100' }])];
    state.finances = actuals([{ category: 'Labor', mapped: true, amount: '150' }]);
    state.milestones = [{ id: 'm1', name: 'Should not leak', weight: 1, effective_pct: 50, target_date: null, task_count: 1 }];
    renderWithQueryClient(
      <MemoryRouter>
        <CostBlock project={project({ budget: 1200 })} isPipeline />
        <DeliveryBlock projectId="p1" isPipeline />
      </MemoryRouter>,
    );
    expect(screen.getByText('Estimated budget 1,200')).toBeInTheDocument();
    expect(screen.getByText('Phases are planned once the deal is won.')).toBeInTheDocument();
    expect(screen.queryByText(/over budget|within budget|% delivered|Should not leak/i)).not.toBeInTheDocument();
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

  it('hides phase editing below the medium breakpoint', () => {
    renderWithQueryClient(<MemoryRouter><DeliveryBlock projectId="p1" /></MemoryRouter>);
    expect(screen.getByRole('button', { name: 'Update phases' })).toHaveClass('max-md:hidden');
  });

  it('links an overdue task to its task anchor and uses destructive text for urgency', () => {
    state.tasks = [{ id: 'task-17', name: 'Review drawings', status: 'In Progress', assignee_id: 'viewer-1', end_date: '2000-01-01' }];
    renderWithQueryClient(<MemoryRouter><MyOpenTasks projectId="p1" /></MemoryRouter>);
    expect(screen.getByRole('link', { name: /Review drawings/i })).toHaveAttribute('href', '/projects/p1/tasks#task-task-17');
    expect(screen.getByText(/Overdue ·/)).toHaveClass('text-destructive-text');
  });
});

describe('contract billing block', () => {
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
    expect(screen.getByText('Contract billing')).toBeInTheDocument();
    expect(screen.getByText('Match payments')).toHaveAttribute('href', '/incoming-payments');
    expect(screen.queryByText('Received', { exact: true })).not.toBeInTheDocument();
    expect(screen.queryByText('Outstanding', { exact: true })).not.toBeInTheDocument();
    expect(screen.queryByText(/not available/i)).not.toBeInTheDocument();
  });
});
