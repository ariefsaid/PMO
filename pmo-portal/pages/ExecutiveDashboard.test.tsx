import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router';
import React from 'react';
import ExecutiveDashboard from './ExecutiveDashboard';
import { ToastProvider } from '@/src/components/ui/Toast';
import { BahasaProvider } from '@/test/bahasa';

const state = vi.hoisted(() => ({ role: 'Executive', unknownContract: false }));
const needsState = vi.hoisted(() => ({
  items: [{ id: 'approvals', count: 2, label: 'approvals waiting for you', href: '/approvals', tone: 'warn' }],
  areaItems: [
    { id: 'at-risk', count: 2, label: 'projects at risk', href: '/projects?filter=at-risk', tone: 'warn' },
    { id: 'ready-to-bill', count: 1, label: 'work order still to invoice', href: '/projects', tone: 'neutral' },
  ],
  isPending: false,
  isError: false,
  refetch: vi.fn(),
}));
const projectsState = vi.hoisted(() => ({ data: [] as unknown[], isPending: false, isError: false, refetch: vi.fn() }));
const procurementsState = vi.hoisted(() => ({ data: [] as unknown[], isPending: false, isError: false, refetch: vi.fn() }));
const budgetReviewState = vi.hoisted(() => ({ data: [] as unknown[], isPending: false, isError: false, refetch: vi.fn() }));
const pipelineState = vi.hoisted(() => ({ data: { stages: [] as unknown[], projects: [] as unknown[] }, isPending: false, isError: false, refetch: vi.fn() }));
const arAgingState = vi.hoisted(() => ({ data: [] as unknown[], isPending: false, isError: false, refetch: vi.fn() }));
const financePositionState = vi.hoisted(() => ({
  position: { receivablesAgeing: {} as Record<string, unknown>, payablesAgeing: {} as Record<string, unknown> },
  isPending: false, isError: false, retry: vi.fn(),
}));
const defaultToday = [
  { id: 'contract-on-hand', label: 'Contract on hand', value: '$1,000', subline: 'Left after spending: $500', href: '/projects', unavailableReason: 'Contract amount is not available.' },
  { id: 'billed-margin', label: 'Known margin on billed work', value: '$200', subline: 'Known margin amount shown', href: '/finance/receivables' },
  { id: 'pipeline', label: 'Pipeline (weighted)', value: '$300', subline: 'Gross: $600 · Forecast margin: 20%', href: '/sales' },
  { id: 'client-overdue', label: 'Owed by clients · overdue', value: '2', subline: '$400 · Oldest 14 days overdue', href: '/finance/receivables?overdue=true' },
  { id: 'supplier-payables', label: 'Owed to suppliers', value: '$100', href: '/procurement?status=Vendor+Invoiced' },
  { id: 'still-to-invoice', label: 'Still to invoice on work orders', value: '$250', href: '/projects' },
];
const figureState = vi.hoisted(() => ({
  result: null as null | Record<string, unknown>,
}));

// Ready to pay / payables ageing read linked accounting documents (L12); none linked here.
vi.mock('@/src/hooks/useErpPurchases', () => ({ useErpPurchases: () => ({ data: [], isPending: false, isError: false }) }));
vi.mock('@/src/auth/impersonation', () => ({ useEffectiveRole: () => ({ effectiveRole: state.role, realRole: state.role }) }));
vi.mock('@/src/components/dashboard/restructure/useCompanyFigures', () => ({
  useCompanyFigures: () => figureState.result,
}));
vi.mock('@/src/components/dashboard/restructure/useNeedsYou', () => ({
  useNeedsYou: () => needsState,
}));
vi.mock('@/src/hooks/useFxOrgDay', () => ({ useFxOrgDay: () => ({ day: '2026-10-27', isPending: false, isError: false, retry: vi.fn() }) }));
vi.mock('@/src/hooks/useDashboard', () => ({
  useSalesPipeline: () => pipelineState,
  useFinanceBudgetReview: () => budgetReviewState,
  useWinRate: () => ({ data: { wins_count: 2, losses_count: 1, wins_value: 500, losses_value: 250, win_rate_count: 2 / 3, win_rate_value: 2 / 3 }, isPending: false, isError: false, refetch: vi.fn() }),
  useLossBreakdown: () => ({ data: undefined, isPending: true, isError: false, refetch: vi.fn() }),
}));
vi.mock('@/src/hooks/useProcurements', () => ({ useProcurements: () => procurementsState }));
vi.mock('@/src/hooks/useProjects', () => ({ useProjects: () => projectsState }));
vi.mock('@/src/hooks/useCompanies', () => ({
  useCompanies: () => ({ data: [], isPending: false, isError: false, refetch: vi.fn() }),
}));
vi.mock('@/src/hooks/useCompanyCollections', () => ({
  useCompanyCollections: () => ({ customerLinks: new Map<string, string>() }),
}));
vi.mock('@/src/hooks/useErpSnapshots', () => ({
  useActualsSnapshot: () => ({ data: [], isPending: false, isError: false, refetch: vi.fn() }),
  useApAgingSnapshot: () => ({ data: [], isPending: false, isError: false, refetch: vi.fn() }),
  useArAgingSnapshot: () => arAgingState,
}));
vi.mock('@/src/hooks/useFinancePosition', () => ({ useFinancePosition: () => financePositionState }));
vi.mock('@/src/hooks/useOrgCurrency', () => ({ useOrgCurrency: () => 'USD', useOrgCurrencyState: () => ({ currency: 'USD', isResolved: true }) }));
// Identity labels by default; a test sets labelState.real to read the shared label hooks a user sees.
const labelState = vi.hoisted(() => ({ real: false }));
vi.mock('@/src/hooks/useProjectStatusLabel', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/src/hooks/useProjectStatusLabel')>();
  return {
    ...actual,
    useProjectStatusLabel: () => (labelState.real ? actual.useProjectStatusLabel() : (status: string) => status),
    useProcurementStatusLabel: () => (labelState.real ? actual.useProcurementStatusLabel() : (status: string) => status),
  };
});
vi.mock('@/src/components/dashboard/EngineerDashboard', () => ({ EngineerDashboard: () => <div data-testid="engineer-dashboard">Engineer work</div> }));
vi.mock('@/src/components/dashboard/PMDashboard', () => ({ PMDashboard: () => <div data-testid="pm-dashboard">My projects</div> }));

const periodFigures = [
  { id: 'invoiced', label: 'Invoiced · excl. tax', value: '$2,000', href: '/finance/receivables' },
  { id: 'collected', label: 'Collected', value: '$1,000', href: '/finance/receivables?view=payments' },
  { id: 'won', label: 'Won', value: '2 · $500', href: '/projects?status=Won' },
  { id: 'win-rate', label: 'Win rate', value: '66.7%', href: '/sales' },
];

function LocationProbe() {
  const location = useLocation();
  return <output data-testid="location">{location.pathname}{location.search}</output>;
}

function renderPage(initial = '/') {
  return render(<MemoryRouter initialEntries={[initial]}><ToastProvider><LocationProbe /><ExecutiveDashboard /></ToastProvider></MemoryRouter>);
}

function renderBahasaPage() {
  return render(<BahasaProvider locale="id"><MemoryRouter><ToastProvider><ExecutiveDashboard /></ToastProvider></MemoryRouter></BahasaProvider>);
}

beforeEach(() => {
  state.role = 'Executive';
  labelState.real = false;
  needsState.items = [{ id: 'approvals', count: 2, label: 'approvals waiting for you', href: '/approvals', tone: 'warn' }];
  state.unknownContract = false;
  needsState.isPending = false;
  needsState.isError = false;
  needsState.refetch.mockClear();
  projectsState.data = [];
  procurementsState.data = [];
  budgetReviewState.data = [];
  pipelineState.data = { stages: [], projects: [] };
  arAgingState.data = [];
  financePositionState.position = { receivablesAgeing: {}, payablesAgeing: {} };
  needsState.areaItems = [
    { id: 'at-risk', count: 2, label: 'projects at risk', href: '/projects?filter=at-risk', tone: 'warn' },
    { id: 'ready-to-bill', count: 1, label: 'work order still to invoice', href: '/projects', tone: 'neutral' },
  ];
  figureState.result = {
    today: defaultToday.map((figure) => figure.id === 'contract-on-hand' && state.unknownContract ? { ...figure, value: null } : figure),
    period: periodFigures,
    todayPending: false, todayError: false, periodPending: false, periodError: false,
    todayRetry: vi.fn(), periodRetry: vi.fn(),
    dashboard: { top_projects: [], attention_projects: [], projects_by_status: [{ status: 'Ongoing Project', count: 1 }], procurements_by_status: [], pipeline_projected_margin: 0.2, on_hand_actual_coverage_count: 1, on_hand_actual_coverage_total: 1 },
    dashboardPending: false, dashboardError: false, dashboardRetry: vi.fn(),
    pipeline: { projects: [], stages: [] }, pipelinePending: false, pipelineError: false, pipelineRetry: vi.fn(),
    winRateRange: { key: 'test-period', from: new Date(2026, 0, 1), to: new Date(2026, 9, 27) },
    orgCurrency: 'USD', currencyPending: false, organizationToday: '2026-10-27', organizationDayPending: false,
    isEmpty: false,
  };
});

describe('company area hub (#1403)', () => {
  it('AC-DASH-1403-01: Executive sees the KPI strip, plan vs actual, needs attention, sales funnel and billing', () => {
    renderPage();
    for (const area of ['Plan vs actual', 'Needs attention', 'Sales funnel', 'Billing and collections']) {
      expect(screen.getByRole('heading', { name: area })).toBeInTheDocument();
    }
    expect(screen.getByRole('region', { name: 'Company figures' })).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /Help:/ })).toHaveLength(6);
    const atRisk = screen.getByRole('link', { name: '2 projects at risk' });
    expect(atRisk).toHaveAttribute('href', '/projects?filter=at-risk');
    expect(atRisk).toHaveTextContent('2');
    // L6: the still-to-invoice figure lives in its tile, which links to the work; the panel does not repeat it.
    expect(screen.getByRole('link', { name: 'Open related records for Still to invoice on work orders.' })).toHaveAttribute('href', '/projects');
    expect(screen.queryByRole('link', { name: /work order still to invoice/i })).not.toBeInTheDocument();
    // C4: an always-empty "Percent of billed work: —" line is not shown as a value.
    expect(screen.queryByText(/Percent of billed work/)).not.toBeInTheDocument();
  });

  it('L6: overdue and supplier amounts appear once, in their tiles, not again in the area panels', () => {
    state.role = 'Finance';
    needsState.areaItems = [
      { id: 'overdue-invoices', count: 2, label: 'client invoices overdue', amount: '$400', href: '/finance/receivables?overdue=true', tone: 'lost' },
      { id: 'supplier-invoices', count: 1, label: 'supplier invoice to pay', amount: '$100', href: '/procurement?status=Vendor+Invoiced', tone: 'warn' },
      { id: 'procurement-approvals', count: 3, label: 'procurements awaiting approval', href: '/procurement?status=Requested', tone: 'warn' },
    ] as typeof needsState.areaItems;
    renderPage();
    expect(screen.getAllByText(/\$400/)).toHaveLength(1);
    expect(screen.getAllByText(/\$100/)).toHaveLength(1);
    expect(screen.getByRole('link', { name: 'Open related records for Owed by clients · overdue.' })).toHaveAttribute('href', '/finance/receivables?overdue=true');
    // A complementary item with no tile stays in its panel.
    expect(screen.getByRole('link', { name: /3 procurements awaiting approval/ })).toHaveAttribute('href', '/procurement?status=Requested');
  });

  it('L2: the position basis is said once for the page, not repeated in each panel', () => {
    renderPage();
    // #2055: the sentence lives behind the page's ? button, said once when opened.
    expect(screen.queryByText(/record currency/i)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'About Dashboard' }));
    expect(screen.getAllByText(/record currency/i)).toHaveLength(1);
    expect(screen.queryByText(/Selected period:/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Invoice amounts exclude tax/)).not.toBeInTheDocument();
  });

  it('#2055: the sales funnel shows the count on each open stage, has no repeating stage table, and opens the stage', () => {
    pipelineState.data = {
      stages: [{ status: 'Tender Submitted', count: 2, weighted_value: 900 }, { status: 'Negotiation', count: 1, weighted_value: 400 }],
      projects: [],
    };
    renderPage();
    expect(screen.queryByRole('table', { name: 'Pipeline by stage' })).not.toBeInTheDocument();
    const stage = screen.getByRole('button', { name: /Tender Submitted/ });
    expect(stage).toHaveTextContent('2');
    fireEvent.click(stage);
    expect(screen.getByTestId('location')).toHaveTextContent('/sales?status=Tender%20Submitted');
  });

  it('F2: keeps mixed-currency figures visible once in the KPI band and removes position repeats from panels', () => {
    const current = figureState.result;
    if (current) {
      current.today = defaultToday.map((figure) => figure.id === 'contract-on-hand'
        ? { ...figure, value: 'IDR 269M · $33.1M' }
        : figure);
    }
    renderPage();

    expect(screen.getByRole('region', { name: 'Company figures' })).toHaveTextContent('IDR 269M · $33.1M');
    expect(screen.getAllByText('IDR 269M · $33.1M')).toHaveLength(1);
    for (const heading of ['Delivery position', 'Pipeline position', 'Sales performance', 'Client debt', 'Billing position', 'Purchasing position']) {
      expect(screen.queryByRole('heading', { name: heading })).not.toBeInTheDocument();
    }
  });

  it('F2/#1418: Needs attention renders the server attention order, never re-sorted or re-sliced by the client', () => {
    // Ranking rule: most distinct signals first, then overdue items; the server cuts to five. Project 2 is at 100% of
    // its contract and Project 6 far below; spending must not reorder the list.
    const ranked = [6, 5, 4, 3, 2].map((number) => ({
      id: `project-${number}`, name: `Project ${number}`, contract_value: 1_000 + number * 100, currency: 'USD',
      spent: number === 2 ? 1_200 : number * 100, actual_complete: true, actual_currency: 'USD',
      budget: 2_000, budget_currency: 'USD', status: 'Ongoing Project',
      attention_signals: number === 6 ? 3 : 0,
      overdue_items: number === 6 ? 4 : 0, overdue_tasks: number === 6 ? 3 : 0,
      overdue_milestones: number === 6 ? 1 : 0, overdue_invoices: 0,
      waiting_approvals: number === 6 ? 2 : 0,
      over_budget: number === 6, budget_used_ratio: number === 6 ? 1.5 : null,
    }));
    (figureState.result?.dashboard as Record<string, unknown>).attention_projects = ranked;
    projectsState.data = ranked.map((project) => ({ id: project.id, pm: { full_name: `Manager ${project.id.slice(-1)}` } }));
    renderPage();

    const list = screen.getByRole('list', { name: /need attention/i });
    expect(within(list).getAllByRole('link').map((link) => link.textContent)).toEqual(['Project 6', 'Project 5', 'Project 4', 'Project 3', 'Project 2']);
    expect(within(list).getByRole('link', { name: 'Project 6' })).toHaveAttribute('href', '/projects/project-6');
    expect(within(list).getByText('4 overdue · 50% over budget · 2 awaiting approval')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'View all 5 projects' })).toHaveAttribute('href', '/projects');
  });

  it('F2: keeps review accounting mappings on its own line below the margin subline', () => {
    const dashboard = figureState.result?.dashboard as Record<string, unknown>;
    dashboard.on_hand_actual_coverage_count = 0;
    dashboard.on_hand_actual_coverage_total = 1;
    renderPage();

    const review = screen.getByRole('link', { name: 'Review accounting mappings' });
    expect(review).not.toHaveClass('absolute');
  });

  it('AC-DASH-1403-02: a missing position value stays an explained dash with a working page link', () => {
    state.unknownContract = true;
    const current = figureState.result;
    if (current) current.today = defaultToday.map((figure) => figure.id === 'contract-on-hand' ? { ...figure, value: null } : figure);
    renderPage();
    const link = screen.getByRole('link', { name: 'Open related records for Contract on hand.' });
    expect(link).toHaveAttribute('href', '/projects');
    const unknownContract = screen.getByText('Contract amount is not available.', { exact: true });
    expect(unknownContract).toHaveAttribute('role', 'status');
    expect(unknownContract).not.toHaveTextContent(/\$|\d|—/);
  });

  it('AC-DASH-1403-03: the period picker writes the selected period into the URL', () => {
    renderPage();
    fireEvent.change(screen.getByRole('combobox', { name: 'Period' }), { target: { value: 'month' } });
    expect(screen.getByTestId('location')).toHaveTextContent('/?period=month');
  });

  it('AC-A11Y-DASH-1403-01: keyboard focus opens metric help without navigating', async () => {
    const user = userEvent.setup();
    renderPage();
    const help = screen.getByRole('button', { name: 'Help: Contract on hand' });
    expect(help.closest('a')).toBeNull();
    for (let index = 0; index < 12 && document.activeElement !== help; index += 1) await user.tab();
    expect(help).toHaveFocus();
    expect(screen.getByRole('tooltip')).toHaveTextContent(/Sum of contract values for delivery work/);
    expect(screen.getByTestId('location')).toHaveTextContent('/');
  });

  it('AC-DASH-1403-10: a delivery project row opens its owning project page', () => {
    const current = figureState.result;
    if (current) (current.dashboard as Record<string, unknown>).attention_projects = [{
      id: 'project-1', name: 'Project North', contract_value: 500, currency: 'USD', spent: 200,
      actual_complete: true, actual_currency: 'USD', status: 'Ongoing Project',
      attention_signals: 0, overdue_items: 0, overdue_tasks: 0, overdue_milestones: 0, overdue_invoices: 0,
      waiting_approvals: 0, over_budget: false, budget_used_ratio: null,
    }];
    projectsState.data = [{ id: 'project-1', pm: { full_name: 'Project Manager' } }];
    renderPage();
    fireEvent.click(screen.getByRole('link', { name: 'Project North' }));
    expect(screen.getByTestId('location')).toHaveTextContent('/projects/project-1');
  });

  it('AC-DASH-1403-04: Finance sees billing first and the two review tables', () => {
    state.role = 'Finance';
    renderPage();
    expect(screen.getAllByRole('heading', { name: 'Billing and collections' })[0]).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Ready to pay' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Budget review' })).toBeInTheDocument();
  });

  it('C4/O12: finance review tables carry no always-empty column and name the status they show', () => {
    state.role = 'Finance';
    procurementsState.data = [{
      id: 'procurement-1', title: 'Supplier invoice 42', status: 'Vendor Invoiced', total_value: 250,
      currency: 'USD', updated_at: '2026-10-20T00:00:00.000Z', vendor_invoiced_at: '2026-10-20T00:00:00.000Z',
      project: { name: 'Project North' }, vendor: { name: 'Supplier One' },
    }];
    budgetReviewState.data = [{ id: 'budget-1', name: 'Budget 1', client_name: null, status: 'Ongoing Project', currency: 'USD', budget: 1_000, budget_currency: 'USD', spent: 500, variance: -500, actual_currency: 'USD', actual_complete: true, actual_coverage_count: 1, actual_coverage_total: 1, actual_as_of: null }];
    renderPage();
    expect(screen.queryByRole('columnheader', { name: 'Due state' })).not.toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Project status' })).toBeInTheDocument();
  });

  it('L12: with no accounting ageing synced, Finance sees the same PMO client and supplier ageing as the finance hub', () => {
    state.role = 'Finance';
    financePositionState.position = {
      receivablesAgeing: { USD: { notDue: 100_00, d1_30: 50_00, d31_60: 0, d61_90: 0, over90: 0 } },
      payablesAgeing: { USD: { d0_30: 70_00, d31_60: 0, d61_90: 0, over90: 0 } },
    };
    renderPage();
    expect(screen.queryByText('No aging data to show yet.')).not.toBeInTheDocument();
    const billing = screen.getAllByRole('heading', { name: 'Billing and collections' })[0]?.closest('.panel-card');
    const clientAgeing = screen.getByRole('region', { name: 'Client balances by age · tax included' });
    expect(clientAgeing.closest('.panel-card')).toBe(billing);
    expect(within(clientAgeing).getByText('$100')).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Supplier invoices by age · since invoiced status or last update' })).toBeInTheDocument();
  });

  it('F2: Finance budget review shows the top five active budgets by RPC variance order', () => {
    state.role = 'Finance';
    budgetReviewState.data = [
      { id: 'pipeline', name: 'Pipeline Deal', client_name: null, status: 'Leads', currency: 'USD', budget: 900, budget_currency: 'USD', spent: 1_800, variance: 900, actual_currency: 'USD', actual_complete: true, actual_coverage_count: 1, actual_coverage_total: 1, actual_as_of: null },
      ...[1, 2, 3, 4, 5, 6].map((number) => ({
        id: `budget-${number}`, name: `Budget ${number}`, client_name: null, status: 'Ongoing Project', currency: 'USD',
        budget: 1_000, budget_currency: 'USD', spent: 1_000 + (7 - number) * 100, variance: (7 - number) * 100,
        actual_currency: 'USD', actual_complete: true, actual_coverage_count: 1, actual_coverage_total: 1, actual_as_of: null,
      })),
    ];
    renderPage();

    for (const number of [1, 2, 3, 4, 5]) expect(screen.getByText(`Budget ${number}`)).toBeInTheDocument();
    expect(screen.queryByText('Budget 6')).not.toBeInTheDocument();
    expect(screen.queryByText('Pipeline Deal')).not.toBeInTheDocument();
    expect(screen.getByText('Top 5 active budgets by variance')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'View all' })).toHaveAttribute('href', '/projects');
  });

  it('F2: embeds client receivables aging in the Billing area panel', () => {
    state.role = 'Finance';
    renderPage();

    const billing = screen.getAllByRole('heading', { name: 'Billing and collections' })[0]?.closest('.panel-card');
    expect(billing).not.toBeNull();
    expect(screen.getByRole('heading', { name: 'Client receivables (AR)' }).closest('.panel-card')).toBe(billing);
  });

  it('AC-DASH-1403-11: a ready-to-pay row opens its procurement record page', () => {
    state.role = 'Finance';
    procurementsState.data = [{
      id: 'procurement-1', title: 'Supplier invoice 42', status: 'Vendor Invoiced', total_value: 250,
      currency: 'USD', updated_at: '2026-10-20T00:00:00.000Z', vendor_invoiced_at: '2026-10-20T00:00:00.000Z',
      project: { name: 'Project North' }, vendor: { name: 'Supplier One' },
    }];
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Open Supplier invoice 42' }));
    expect(screen.getByTestId('location')).toHaveTextContent('/procurement/procurement-1');
  });

  it('AC-DASH-1403-06: Admin sees the same company hub as Executive', () => {
    state.role = 'Admin';
    renderPage();
    expect(screen.getByRole('heading', { name: 'Plan vs actual' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Sales funnel' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Billing and collections' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Ready to pay' })).not.toBeInTheDocument();
  });

  it('AC-DASH-1403-07: a failed attention query leaves the other company areas usable and offers retry', () => {
    needsState.isError = true;
    renderPage();
    expect(screen.getByText("Couldn't load approvals and attention items")).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Plan vs actual' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Sales funnel' })).toBeInTheDocument();
  });

  it('AC-DASH-1403-08: dashboard headings use the Bahasa catalogue', () => {
    renderBahasaPage();
    expect(screen.getByRole('heading', { name: 'Dasbor' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Rencana vs realisasi' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Perlu perhatian' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Corong penjualan' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Penagihan dan penerimaan' })).toBeInTheDocument();
  });

  it('AC-DASH-1403-05: Engineer is routed to the personal dashboard with no company money figures', () => {
    state.role = 'Engineer';
    renderPage();
    expect(screen.getByTestId('engineer-dashboard')).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Company figures' })).not.toBeInTheDocument();
    expect(screen.queryByText('$1,000')).not.toBeInTheDocument();
  });

  it('AC-DASH-1403-09: Project Manager remains routed to the personal projects dashboard', () => {
    state.role = 'Project Manager';
    renderPage();
    expect(screen.getByTestId('pm-dashboard')).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Company figures' })).not.toBeInTheDocument();
  });
});

// Ported from the deleted ExecutiveDashboard.{atRiskLink,bahasa,honesty}.test.tsx: the behaviours
// those files pinned, re-asserted against the company hub.
describe('company hub — behaviour carried over from the previous dashboard', () => {
  it('AC-IFW-DASH-02: the at-risk doorway is its own link, not nested inside another link or button', () => {
    renderPage();
    const atRisk = screen.getByRole('link', { name: '2 projects at risk' });
    expect(atRisk.parentElement?.closest('a, button')).toBeNull();
    expect(atRisk.querySelector('a, button')).toBeNull();
  });

  it('AC-FAA-006: a pipeline-only portfolio keeps the company figures and says there is no delivery project to compare', () => {
    const current = figureState.result!;
    current.isEmpty = false;
    current.dashboard = { ...(current.dashboard as Record<string, unknown>), top_projects: [], attention_projects: [], projects_by_status: [{ status: 'Tender Submitted', count: 2 }], procurements_by_status: [] };
    renderPage();
    expect(screen.queryByText('No company activity yet')).not.toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Company figures' })).toBeInTheDocument();
    expect(screen.getByText('No projects to compare yet')).toBeInTheDocument();
  });

  it('AC-FAA-006: the company empty state appears only when there is no project or procurement evidence at all', () => {
    const current = figureState.result!;
    current.isEmpty = true;
    current.dashboard = { ...(current.dashboard as Record<string, unknown>), top_projects: [], attention_projects: [], projects_by_status: [{ status: 'Lost', count: 2 }], procurements_by_status: [] };
    const withEvidence = renderPage();
    expect(screen.queryByText('No company activity yet')).not.toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Company figures' })).toBeInTheDocument();
    withEvidence.unmount();

    current.dashboard = { ...(current.dashboard as Record<string, unknown>), projects_by_status: [], procurements_by_status: [] };
    needsState.areaItems = [];
    renderPage();
    expect(screen.getByText('No company activity yet')).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Company figures' })).not.toBeInTheDocument();
  });

  it('keeps loading and error ahead of any empty or value state for the company figures', () => {
    const current = figureState.result!;
    current.todayPending = true;
    current.isEmpty = true;
    current.dashboard = undefined;
    const pending = renderPage();
    expect(screen.queryByText('No company activity yet')).not.toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Company figures' })).not.toHaveTextContent('$1,000');
    pending.unmount();

    current.todayPending = false;
    current.todayError = true;
    current.dashboardError = true;
    renderPage();
    expect(screen.getByText("Couldn't load company position figures")).toBeInTheDocument();
    expect(screen.queryByText('No company activity yet')).not.toBeInTheDocument();
    expect(screen.queryByText('No projects to compare yet')).not.toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Company figures' })).not.toHaveTextContent('$1,000');
  });

  it('AC-UXA-003: Bahasa error and empty states read in Bahasa, never the English fallback', () => {
    needsState.isError = true;
    const current = figureState.result!;
    current.todayError = true;
    const failed = renderBahasaPage();
    expect(screen.getByText('Tidak dapat memuat persetujuan dan item perhatian')).toBeInTheDocument();
    expect(screen.getByText('Tidak dapat memuat angka posisi perusahaan')).toBeInTheDocument();
    expect(screen.queryByText("Couldn't load approvals and attention items")).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument();
    failed.unmount();

    needsState.isError = false;
    needsState.areaItems = [];
    current.todayError = false;
    current.isEmpty = true;
    current.dashboard = { ...(current.dashboard as Record<string, unknown>), projects_by_status: [], procurements_by_status: [] };
    renderBahasaPage();
    expect(screen.getByText('Belum ada aktivitas perusahaan')).toBeInTheDocument();
    expect(screen.queryByText('No company activity yet')).not.toBeInTheDocument();
  });
});

// Ported from the pre-restructure ExecutiveDashboard.test.tsx (baseline fa511c382): approvals first,
// purchasing scope and stage links, help copy, states and a11y — re-asserted on the company hub.
describe('company hub — ported baseline cases', () => {
  it('AC-UX-016 / batch-3: the actionable approvals doorway precedes the passive company figures and opens /approvals', () => {
    renderPage();
    const approvals = screen.getByRole('link', { name: '2 approvals waiting for you' });
    expect(approvals).toHaveAttribute('href', '/approvals');
    const figures = screen.getByRole('region', { name: 'Company figures' });
    expect(approvals.compareDocumentPosition(figures) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('AC-SL-A-001: nothing waiting → no approvals doorway and no Review action', () => {
    needsState.items = [];
    renderPage();
    expect(screen.queryByRole('link', { name: /approvals? waiting for you/i })).not.toBeInTheDocument();
    expect(screen.queryByText('Review')).not.toBeInTheDocument();
  });

  it('AC-JR-W4-05: the Pipeline (weighted) help says "project value", never "opportunity value"', () => {
    renderPage();
    fireEvent.focus(screen.getByRole('button', { name: 'Help: Pipeline (weighted)' }));
    expect(screen.getByRole('tooltip')).toHaveTextContent('project value');
    expect(screen.getByRole('tooltip')).not.toHaveTextContent('opportunity value');
    expect(document.body.textContent).not.toContain('opportunity value');
  });

  it('DA-1: the at-risk doorway text uses the readable foreground token; the warning hue is only its marker', () => {
    renderPage();
    const atRisk = screen.getByRole('link', { name: '2 projects at risk' });
    expect(atRisk).toHaveClass('text-foreground');
    expect(atRisk).not.toHaveClass('text-warning');
  });

  it('AC-706: company figures show loading skeletons while pending, never values', () => {
    figureState.result!.todayPending = true;
    renderPage();
    const figures = screen.getByRole('region', { name: 'Company figures' });
    expect(within(figures).getAllByTestId('kpi-skeleton').length).toBeGreaterThan(0);
    expect(figures).not.toHaveTextContent('$1,000');
  });

  it('AC-707: a failed figures load shows the error with a working retry', () => {
    figureState.result!.todayError = true;
    renderPage();
    const figures = screen.getByRole('region', { name: 'Company figures' });
    expect(within(figures).getByText("Couldn't load company position figures")).toBeInTheDocument();
    fireEvent.click(within(figures).getByRole('button', { name: 'Retry' }));
    expect(figureState.result!.todayRetry).toHaveBeenCalledOnce();
  });

  it('incomplete actuals: the review-mappings action opens the accounting budget-account map', () => {
    const dashboard = figureState.result!.dashboard as Record<string, unknown>;
    dashboard.on_hand_actual_coverage_count = 144;
    dashboard.on_hand_actual_coverage_total = 150;
    renderPage();
    expect(screen.getByRole('link', { name: 'Review accounting mappings' })).toHaveAttribute('href', '/administration/accounting#budget-account-map');
  });

  it('C1: the company figure band reflows with arbitrary breakpoints only, no named sm: tier mixed in', () => {
    renderPage();
    const band = screen.getByRole('region', { name: 'Company figures' });
    expect(band.className).toMatch(/min-\[\d+px\]:grid-cols-\d/);
    expect(band.className).not.toContain('sm:grid-cols');
  });
});
