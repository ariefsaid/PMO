/**
 * HOME4: the company home's feature floor (docs: feature diff of the two company homes, dev 0.36.0). Every fact, drill
 * and column dev's home had is reachable again, each in its named place in the composition. Data sources are stubbed;
 * the needs read is served as items so each test names the rows it expects.
 */
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import { ToastProvider } from '@/src/components/ui/Toast';

const base = {
  active_projects: 2,
  active_delivery_projects: 2,
  active_delivery_actual_project_count: 1,
  risk_unchecked_projects: 0,
  on_hand_value: 8_000_000,
  on_hand_contract_remaining: 6_000_000,
  on_hand_realized_margin: null,
  on_hand_realized_margin_by_currency: [],
  on_hand_value_by_currency: [{ currency: 'USD', contract_value: 8_000_000, actual_known: 2_000_000, contract_remaining: 6_000_000, actual_coverage_count: 2, actual_coverage_total: 2, realized_margin_known: null, unknown_projects: 0 }],
  on_hand_actual_coverage_count: 2,
  on_hand_actual_coverage_total: 2,
  pipeline_projected_margin: null,
  pipeline_total_value_by_currency: [{ currency: 'USD', total_value: 2_000_000, weighted_value: 800_000, forecast_margin: null, no_active_budget: 0 }],
  projects_at_risk: 0,
  projects_by_status: [{ status: 'Ongoing Project', count: 2 }],
  procurements_by_status: [{ status: 'Requested', count: 3 }, { status: 'Ordered', count: 2 }],
  top_projects: [],
  attention_projects: [] as unknown[],
};
const attn = (id: string, name: string, over: Record<string, unknown> = {}) => ({
  id, name, short_name: null, client_name: null, contract_value: 2_000_000, currency: 'USD', budget: 1_500_000, spent: 600_000, actual_complete: true, actual_currency: 'USD', budget_currency: 'USD',
  status: 'Ongoing Project', attention_signals: 0, overdue_items: 0, overdue_tasks: 0, overdue_milestones: 0, overdue_invoices: 0, waiting_approvals: 0, over_budget: false, budget_used_ratio: 0.4, ...over,
});
const h = vi.hoisted(() => ({
  role: 'Executive' as string,
  dash: null as unknown,
  items: [] as unknown[],
  overdue: undefined as unknown,
  projects: [] as unknown[],
  procurements: [] as unknown[],
  budgets: [] as unknown[],
  pipeline: { stages: [], projects: [] } as unknown,
  workOrders: { totals: [], incompleteCount: 0 } as unknown,
}));

vi.mock('@/src/hooks/useErpPurchases', () => ({ useErpPurchases: () => ({ data: [], isPending: false, isError: false }) }));
vi.mock('@/src/hooks/useWorkOrderBilling', () => ({ useUnbilledWorkOrders: () => ({ data: h.workOrders, isPending: false, isError: false, refetch: vi.fn() }) }));
vi.mock('@/src/hooks/useOrgCurrency', () => ({ useOrgCurrency: () => 'USD', useOrgCurrencyState: () => ({ currency: 'USD', isResolved: true, isError: false }) }));
vi.mock('@/src/hooks/useFxOrgDay', () => ({ useFxOrgDay: () => ({ day: '2026-10-27', isPending: false, isError: false, retry: vi.fn() }) }));
vi.mock('@/src/hooks/useRevenue', () => ({
  useSalesInvoices: () => ({ data: [], isPending: false, isError: false, refetch: vi.fn() }),
  useOverdueInvoiceFacts: () => ({ data: [], isPending: false, isError: false, refetch: vi.fn() }),
  useIncomingPayments: () => ({ data: [], isPending: false, isError: false, refetch: vi.fn() }),
  usePaidPaymentFacts: () => ({ data: [], isPending: false, isError: false, refetch: vi.fn() }),
  useHasAnySalesInvoice: () => ({ data: true, isPending: false, isLoading: false, isError: false, refetch: vi.fn() }),
  useHasAnyIncomingPayment: () => ({ data: true, isPending: false, isLoading: false, isError: false, refetch: vi.fn() }),
}));
vi.mock('@/src/hooks/useInvoicesAwaitingViewer', () => ({ useInvoicesAwaitingViewer: () => ({ rows: [], isPending: false, isError: false, refetch: vi.fn() }) }));
vi.mock('@/src/hooks/useManagementPack', () => ({ useManagementPack: () => ({ data: { months: [], rows: [], totals: [] }, isPending: false, isError: false, refetch: vi.fn() }) }));
vi.mock('@/src/lib/db/dashboard', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/src/lib/db/dashboard')>()), getExecutiveDashboard: async () => h.dash }));
vi.mock('@/src/hooks/useDashboard', () => ({
  useDashboard: () => ({ data: h.dash, isPending: false, isError: false, refetch: vi.fn() }),
  usePMDashboardProjects: () => ({ data: [], isPending: false, isError: false, refetch: vi.fn() }),
  useFinanceBudgetReview: () => ({ data: h.budgets, isPending: false, isError: false, refetch: vi.fn() }),
  useSalesPipeline: () => ({ data: h.pipeline, isPending: false, isError: false, refetch: vi.fn() }),
  useWinRate: () => ({ data: null, isPending: false, isError: false, refetch: vi.fn() }),
  useLossBreakdown: () => ({ data: undefined, isPending: true, isError: false, refetch: vi.fn() }),
}));
vi.mock('@/src/components/dashboard/restructure/useNeedsYou', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/src/components/dashboard/restructure/useNeedsYou')>()),
  useNeedsYou: () => ({ items: h.items, areaItems: h.items, approvals: [], overdueInvoices: h.overdue, approvalsPending: false, approvalsError: false, isPending: false, isError: false, refetch: vi.fn() }),
}));
vi.mock('@/src/hooks/useProjectsDelivery', () => ({ useProjectsDelivery: () => ({ data: {}, isPending: false, isError: false, refetch: vi.fn() }) }));
vi.mock('@/src/hooks/useProcurements', () => ({ useProcurements: () => ({ data: h.procurements, isPending: false, isError: false, refetch: vi.fn() }) }));
vi.mock('@/src/hooks/useErpSnapshots', () => ({
  useActualsSnapshot: () => ({ data: [], isPending: false, isError: false, refetch: vi.fn() }),
  useApAgingSnapshot: () => ({ data: [], isPending: false, isError: false, refetch: vi.fn() }),
  useArAgingSnapshot: () => ({ data: [], isPending: false, isError: false, refetch: vi.fn() }),
}));
vi.mock('@/src/hooks/useCompanies', () => ({ useCompanies: () => ({ data: [], isPending: false, isError: false }) }));
vi.mock('@/src/hooks/useCompanyCollections', () => ({ useCompanyCollections: () => ({ customerLinks: new Map() }) }));
vi.mock('@/src/hooks/useProjects', () => ({ useProjectIdentity: () => ({ data: [] }), useProjects: () => ({ data: h.projects, isPending: false, isError: false, refetch: vi.fn() }) }));
vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: { id: 'u1', org_id: 'org-1' }, role: h.role }) }));
vi.mock('@/src/auth/impersonation', () => ({ useEffectiveRole: () => ({ effectiveRole: h.role, realRole: h.role }) }));

import { CompanyDashboard } from './CompanyDashboard';

const renderHome = (role: 'Executive' | 'Admin' | 'Finance' = 'Executive') => {
  h.role = role;
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter><ToastProvider><CompanyDashboard role={role} /></ToastProvider></MemoryRouter>
    </QueryClientProvider>,
  );
};
const openPageHelp = () => {
  fireEvent.click(screen.getByRole('button', { name: 'About Dashboard' }));
  return screen.getByTestId('figure-help-list');
};
const item = (id: string, count: number, label: string, href: string, over: Record<string, unknown> = {}) => ({ id, count, label, href, tone: 'warn', ...over });
const procurement = (id: string, over: Record<string, unknown> = {}) => ({
  id, title: `PO ${id}`, status: 'Vendor Invoiced', currency: 'USD', project: { name: 'River project' }, vendor: { name: 'Acme' },
  vendor_invoiced_at: '2026-10-01', updated_at: '2026-10-01', ...over,
});
const budget = (id: string, name: string, over: Record<string, unknown> = {}) => ({
  id, name, short_name: null, status: 'Ongoing Project', currency: 'USD', budget_currency: 'USD', budget: 100_000, spent: 120_000, actual_complete: true, actual_currency: 'USD', variance: 20_000, ledger_owned: true, ...over,
});

beforeEach(() => {
  localStorage.removeItem('home-layout');
  h.dash = { ...base };
  h.items = [];
  h.overdue = undefined;
  h.projects = [];
  h.procurements = [];
  h.budgets = [];
  h.pipeline = { stages: [], projects: [] };
  h.workOrders = { totals: [], incompleteCount: 0 };
});

describe('HOME4 floor: the finding line and the page help', () => {
  it('says the company-wide all-clear when no checked project is off track and none is unchecked', () => {
    h.dash = { ...base, attention_projects: [attn('p1', 'River project')] };
    renderHome();
    expect(screen.getByTestId('home-finding')).toHaveTextContent('All 2 active projects on track');
  });

  it('names the known overdue amount in the finance clause', () => {
    h.overdue = { count: 2, knownTotals: [{ currency: 'USD', amount: 45_000 }], unknownBalances: 0, oldestDays: 120 };
    renderHome();
    expect(screen.getByRole('link', { name: /2 client invoices overdue, oldest 120 days · \$45K/ })).toHaveAttribute('href', '/finance/receivables?overdue=true');
  });

  it('a two-currency overdue amount puts the second currency on its own line', () => {
    h.overdue = { count: 2, knownTotals: [{ currency: 'EUR', amount: 10_000 }, { currency: 'USD', amount: 45_000 }], unknownBalances: 0, oldestDays: 120 };
    renderHome();
    const clause = screen.getByRole('link', { name: /2 client invoices overdue/ });
    expect(clause).toHaveTextContent('$45K');
    expect(within(clause).getByText('+ EUR 10K')).toHaveClass('block');
  });

  it('keeps the overdue amount out while any overdue balance is unknown (never a partial sum)', () => {
    h.overdue = { count: 2, knownTotals: [{ currency: 'USD', amount: 45_000 }], unknownBalances: 1, oldestDays: 120 };
    renderHome();
    expect(screen.getByTestId('home-finding')).not.toHaveTextContent('$45K');
  });

  it('the page help carries the actuals coverage, the share-of-contract basis and the purchasing scope', () => {
    h.dash = { ...base, attention_projects: [attn('p1', 'River project'), attn('p2', 'Quiet project', { spent: null, actual_complete: false })] };
    renderHome();
    const help = openPageHelp();
    expect(help).toHaveTextContent('Actuals available for 1 of 2 active delivery projects.');
    expect(help).toHaveTextContent('1 project has incomplete spending');
    expect(help).toHaveTextContent('recorded spending divided by contract value');
    expect(help).toHaveTextContent('Purchases made directly in the accounting system are not counted');
    expect(help).toHaveTextContent('Remaining amount and count from open work orders');
    expect(help).toHaveTextContent('Won and lost projects are excluded');
    expect(help).toHaveTextContent('Count and value of projects recorded as won');
    expect(help).toHaveTextContent('A project budget is over its recorded spend comparison');
    expect(help).toHaveTextContent('whose recorded due date has passed');
  });
});

describe('HOME4 floor: Waits on you', () => {
  it('Executive sees budgets running over and procurements awaiting approval, each with its scoped drill', () => {
    h.items = [
      item('procurement-approvals', 3, 'procurements awaiting approval', '/procurement?status=Requested'),
      item('budgets-over', 2, 'budgets running over', '/projects', { tone: 'lost' }),
    ];
    renderHome();
    const waits = screen.getByTestId('waits-on-you');
    expect(within(waits).getByRole('link', { name: /3\s*procurements awaiting approval/ })).toHaveAttribute('href', '/procurement?status=Requested');
    expect(within(waits).getByRole('link', { name: /2\s*budgets running over/ })).toHaveAttribute('href', '/projects');
  });

  it('Admin takes the same composition as the Executive', () => {
    h.items = [item('procurement-approvals', 1, 'procurement awaiting approval', '/procurement?status=Requested')];
    renderHome('Admin');
    expect(within(screen.getByTestId('waits-on-you')).getByRole('link', { name: /procurement awaiting approval/ })).toHaveAttribute('href', '/procurement?status=Requested');
    expect(screen.getByTestId('sales-overview')).toBeInTheDocument();
  });

  it('Finance sees budgets running over beside its money rows, and the rows keep their amounts', () => {
    h.items = [
      item('supplier-invoices', 4, 'supplier invoices to pay', '/procurement?status=Vendor+Invoiced', { amount: '$40K' }),
      item('budgets-over', 2, 'budgets running over', '/projects', { tone: 'lost' }),
    ];
    renderHome('Finance');
    const waits = screen.getByTestId('waits-on-you');
    expect(within(waits).getByRole('link', { name: /supplier invoices to pay/ })).toHaveTextContent('$40K');
    expect(within(waits).getByRole('link', { name: /2\s*budgets running over/ })).toHaveAttribute('href', '/projects');
  });
});

describe('HOME4 floor: Project health rows', () => {
  it('each row names its manager, its share of contract spent, and keeps a menu to the project, its budget and its procurements', () => {
    h.dash = { ...base, attention_projects: [attn('p1', 'River project')] };
    h.projects = [{ id: 'p1', name: 'River project', pm: { full_name: 'Dana Lee' } }, { id: 'p2', name: 'Other', pm: null }, { id: 'p3', name: 'Third', pm: null }];
    renderHome();
    const card = screen.getByTestId('project-health');
    const row = within(card).getByRole('link', { name: /River project/ });
    expect(row).toHaveTextContent('Dana Lee');
    // $600K spent of a $2M contract.
    expect(row).toHaveTextContent('30% of contract');
    fireEvent.click(within(card).getByRole('button', { name: 'Row actions for River project' }));
    expect(screen.getByRole('menuitem', { name: 'Open budget' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Open procurements' })).toBeInTheDocument();
    expect(within(card).getByRole('link', { name: 'All 3 projects' })).toHaveAttribute('href', '/projects');
  });

  it('no share of contract is printed when spending is incomplete or in another currency', () => {
    h.dash = { ...base, attention_projects: [attn('p1', 'River project', { actual_currency: 'EUR' })] };
    renderHome();
    expect(within(screen.getByTestId('project-health')).getByRole('link', { name: /River project/ })).not.toHaveTextContent('of contract');
  });
});

describe('HOME4 floor: figures, sales and purchasing', () => {
  it('the figures band carries what is still to invoice on work orders, with its count and drill', () => {
    h.workOrders = { totals: [{ currency: 'USD', remaining: 250_000, count: 3 }], incompleteCount: 0 };
    renderHome();
    const band = screen.getByRole('region', { name: 'Company figures' });
    const label = within(band).getByText('Still to invoice on work orders');
    const tileEl = label.closest('a') ?? label.parentElement!.parentElement!.parentElement!;
    expect(within(band).getByText('$250K')).toBeInTheDocument();
    expect(within(band).getByText('3 work orders')).toBeInTheDocument();
    expect(tileEl).toBeTruthy();
  });

  it('the pipeline shows its gross beside the weighted total, and each stage its gross value', () => {
    h.pipeline = { stages: [{ status: 'Leads', count: 2, total_value: 3_000_000, weighted_value: 600_000, win_probability: 0.2 }], projects: [{ id: 'o1', name: 'One', status: 'Leads', currency: 'USD', contract_value: 3_000_000 }] };
    renderHome();
    const sales = screen.getByTestId('sales-overview');
    expect(sales).toHaveTextContent('Gross $2M');
    expect(within(sales).getByRole('link', { name: /Leads · 2: \$600K weighted of \$3M gross/ })).toHaveAttribute('href', '/sales?status=Leads');
  });

  it('a stage with projects in two currencies shows each currency gross on its own line, never one sum labelled in the home currency', () => {
    // The stage read sums contract values across currencies (4,000,000 here): the gross is grouped from the stage's own projects instead.
    h.pipeline = {
      stages: [{ status: 'Leads', count: 2, total_value: 4_000_000, weighted_value: 600_000, win_probability: 0.2 }],
      projects: [
        { id: 'o1', name: 'One', status: 'Leads', currency: 'USD', contract_value: 3_000_000 },
        { id: 'o2', name: 'Two', status: 'Leads', currency: 'EUR', contract_value: 1_000_000 },
      ],
    };
    renderHome();
    const stage = within(screen.getByTestId('sales-overview')).getByRole('link', { name: /Leads · 2/ });
    expect(stage).toHaveAccessibleName(/\$3M.*EUR\s1M/);
    expect(stage).not.toHaveTextContent('$4M');
    expect(within(stage).getByText('+ EUR 1M')).toHaveClass('block');
  });

  it('a two-currency pipeline gross keeps the second currency on its own line', () => {
    h.dash = { ...base, pipeline_total_value_by_currency: [{ currency: 'USD', total_value: 2_000_000, weighted_value: 800_000, forecast_margin: null, no_active_budget: 0 }, { currency: 'EUR', total_value: 1_000_000, weighted_value: 100_000, forecast_margin: null, no_active_budget: 0 }] };
    renderHome();
    const sales = screen.getByTestId('sales-overview');
    expect(sales).toHaveTextContent('Gross $2M');
    expect(within(sales).getByText('+ EUR 1M')).toHaveClass('block');
  });

  it('each purchasing stage is a drill to its procurements, named with its count', () => {
    renderHome();
    const purchasing = screen.getByTestId('chart-purchasing');
    expect(within(purchasing).getByRole('link', { name: 'Request 3' })).toHaveAttribute('href', '/procurement?stage=request');
    expect(within(purchasing).getByRole('link', { name: 'Order 2' })).toHaveAttribute('href', '/procurement?stage=order');
  });

  it('Finance has the Sales and Purchasing blocks too', () => {
    renderHome('Finance');
    expect(screen.getByTestId('sales-overview')).toBeInTheDocument();
    expect(screen.getByTestId('chart-purchasing')).toBeInTheDocument();
  });
});

describe('HOME4 floor: the finance tables', () => {
  it('Ready to pay keeps its Project and Status columns and counts the invoices with no recorded amount', () => {
    // No supplier invoice document is recorded on either, so neither unpaid amount is known.
    h.procurements = [procurement('a'), procurement('b')];
    renderHome('Finance');
    const table = within(screen.getByTestId('ready-to-pay')).getByRole('table');
    expect(within(table).getByRole('columnheader', { name: 'Project' })).toBeInTheDocument();
    expect(within(table).getAllByText('Supplier invoiced').length).toBeGreaterThan(0);
    expect(within(table).getAllByText('River project').length).toBeGreaterThan(0);
    expect(screen.getByTestId('ready-to-pay')).toHaveTextContent('2 supplier invoices have no recorded amount yet');
  });

  it('Budget review is on the Finance home with its project status, its basis caption and View all', () => {
    h.budgets = [budget('b1', 'River project'), budget('b2', 'Quiet project', { spent: null, actual_complete: false, variance: null })];
    renderHome('Finance');
    const card = screen.getByTestId('budget-review');
    expect(within(card).getByRole('columnheader', { name: 'Project status' })).toBeInTheDocument();
    expect(card).toHaveTextContent('Top 5 active budgets by variance · 1 has incomplete spending');
    expect(within(card).getByRole('link', { name: 'View all' })).toHaveAttribute('href', '/projects');
    const help = openPageHelp();
    expect(help).toHaveTextContent('Variance is spending minus budget');
    expect(help).toHaveTextContent('so due state is unknown');
  });
});
