import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router';
import React from 'react';
import ExecutiveDashboard from './ExecutiveDashboard';
import { ToastProvider } from '@/src/components/ui/Toast';
import { openHiddenReasons, pinHomeLayout } from '@/test/homeLayout';

pinHomeLayout('focused');

const state = vi.hoisted(() => ({ role: 'Executive', unknownContract: false }));
const needsState = vi.hoisted(() => ({
  items: [{ id: 'approvals', count: 2, label: 'approvals waiting for you', href: '/approvals', tone: 'warn' } as { id: string; count: number; label: string; href: string; tone: string; detail?: string }],
  approvals: [] as unknown[],
  approvalsPending: false,
  approvalsError: false,
  overdueInvoices: undefined as { count: number; knownTotals: unknown[]; unknownBalances: number; oldestDays: number | null } | undefined,
  areaItems: [
    { id: 'at-risk', count: 2, label: 'projects at risk', href: '/projects?filter=at-risk', tone: 'warn' },
    { id: 'ready-to-bill', count: 1, label: 'work order still to invoice', href: '/projects', tone: 'neutral' },
  ],
  isPending: false,
  isError: false,
  refetch: vi.fn(),
}));
const lossState = vi.hoisted(() => ({ data: undefined as unknown, isPending: true, isError: false, refetch: vi.fn() }));
const projectsState = vi.hoisted(() => ({ data: [] as unknown[], isPending: false, isError: false, refetch: vi.fn() }));
const procurementsState = vi.hoisted(() => ({ data: [] as unknown[], isPending: false, isError: false, refetch: vi.fn() }));
const myTasksState = vi.hoisted(() => ({ data: [] as unknown[], isPending: false, isError: false, refetch: vi.fn() }));
const budgetReviewState = vi.hoisted(() => ({ data: [] as unknown[], isPending: false, isError: false, refetch: vi.fn() }));
const erpPurchasesState = vi.hoisted(() => ({ data: [] as unknown[], isPending: false, isError: false, refetch: vi.fn() }));
const deliveryState = vi.hoisted(() => ({ data: { 'project-6': 40 } as Record<string, number>, isPending: false, isError: false, refetch: vi.fn() }));
const pipelineState = vi.hoisted(() => ({ data: { stages: [] as unknown[], projects: [] as unknown[] }, isPending: false, isError: false, refetch: vi.fn() }));
const arAgingState = vi.hoisted(() => ({ data: [] as unknown[], isPending: false, isError: false, refetch: vi.fn() }));
const financePositionState = vi.hoisted(() => ({
  position: { receivablesAgeing: {} as Record<string, unknown>, receivablesNoDueDateCounts: {} as Record<string, number>, payablesAgeing: {} as Record<string, unknown>, overdue: [] as unknown[] },
  isPending: false, isError: false, retry: vi.fn(),
}));
const defaultToday = [
  { id: 'contract-on-hand', label: 'Contract on hand', value: '$1,000', amounts: [{ currency: 'USD', amount: 1_000_000 }], subline: 'Left after spending: $500', href: '/projects', unavailableReason: 'Contract amount is not available.' },
  { id: 'billed-margin', label: 'Known margin on billed work', value: '$200', amounts: [{ currency: 'USD', amount: 200_000 }], subline: 'Known margin amount shown', href: '/finance/receivables' },
  { id: 'pipeline', label: 'Pipeline (weighted)', value: '$300', amounts: [{ currency: 'USD', amount: 300_000 }], subline: 'Gross: $600 · Forecast margin: 20%', href: '/sales' },
  { id: 'owed-clients', label: 'Owed by clients', value: '', amounts: [{ currency: 'USD', amount: 2_500_000 }], subline: '$400K overdue', href: '/finance/receivables', unavailableReason: 'some client invoice balances are not synced' },
  { id: 'supplier-payables', label: 'Owed to suppliers', value: '$100', amounts: [{ currency: 'USD', amount: 100_000 }], subline: '3 supplier invoices awaiting payment', href: '/procurement?status=Vendor+Invoiced' },
  { id: 'left-to-bill', label: 'Left to bill', value: '$250', amounts: [{ currency: 'USD', amount: 250_000 }], href: '/finance/reports' },
];
const figureState = vi.hoisted(() => ({
  result: null as null | Record<string, unknown>,
}));

vi.mock('@/src/hooks/useErpPurchases', () => ({ useErpPurchases: () => erpPurchasesState }));
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
  useLossBreakdown: () => lossState,
}));
vi.mock('@/src/hooks/useProcurements', () => ({ useProcurements: () => procurementsState }));
vi.mock('@/src/hooks/useMyTasks', () => ({ useMyTasks: () => myTasksState }));
vi.mock('@/src/hooks/useProjectsDelivery', () => ({ useProjectsDelivery: () => deliveryState, useProjectsDeliverySummary: () => ({ data: {}, isPending: false, isError: false }) }));
vi.mock('@/src/hooks/useOrgToday', () => ({ useOrgToday: () => '2026-10-27' }));
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
  { id: 'invoiced', label: 'Invoiced · excl. tax', value: '$2,000', amounts: [{ currency: 'USD', amount: 7_700_000 }, { currency: 'IDR', amount: 5_300_000 }], href: '/finance/receivables' },
  { id: 'collected', label: 'Collected', value: '$1,000', amounts: [{ currency: 'USD', amount: 1_000_000 }], href: '/finance/receivables?view=payments' },
  { id: 'won', label: 'Won', value: '2 · $500', count: 2, amounts: [{ currency: 'USD', amount: 14_400_000 }], href: '/projects?status=Won' },
  { id: 'win-rate', label: 'Win rate', value: '66.7%', href: '/sales' },
];

function LocationProbe() {
  const location = useLocation();
  return <output data-testid="location">{location.pathname}{location.search}</output>;
}

function renderPage(initial = '/') {
  return render(<MemoryRouter initialEntries={[initial]}><ToastProvider><LocationProbe /><ExecutiveDashboard /></ToastProvider></MemoryRouter>);
}

const attention = (n: number, over: Partial<Record<string, unknown>> = {}) => ({
  id: `project-${n}`, name: `Project ${n}`, contract_value: 1_000, currency: 'USD', spent: 100, actual_complete: true,
  actual_currency: 'USD', budget: 2_000, budget_currency: 'USD', status: 'Ongoing Project',
  attention_signals: 0, overdue_items: 0, overdue_tasks: 0, overdue_milestones: 0, overdue_invoices: 0,
  waiting_approvals: 0, over_budget: false, budget_used_ratio: null, ...over,
});
const setAttention = (rows: unknown[]) => { (figureState.result?.dashboard as Record<string, unknown>).attention_projects = rows; };
const setToday = (id: string, patch: Record<string, unknown>) => {
  figureState.result = { ...figureState.result, today: (figureState.result?.today as Array<{ id: string }>).map((figure) => figure.id === id ? { ...figure, ...patch } : figure) };
};
const figures = () => screen.getByRole('region', { name: 'Company figures' });
const overviewLayout = () => localStorage.setItem('home-layout', 'overview');

beforeEach(() => {
  lossState.data = undefined;
  lossState.isPending = true;
  state.role = 'Executive';
  labelState.real = false;
  needsState.items = [{ id: 'approvals', count: 2, label: 'approvals waiting for you', href: '/approvals', tone: 'warn' }];
  needsState.approvals = [];
  needsState.approvalsPending = false;
  needsState.approvalsError = false;
  needsState.overdueInvoices = undefined;
  state.unknownContract = false;
  needsState.isPending = false;
  needsState.isError = false;
  needsState.refetch.mockClear();
  projectsState.data = [];
  projectsState.refetch.mockClear();
  procurementsState.data = [];
  procurementsState.refetch.mockClear();
  myTasksState.data = [];
  myTasksState.isPending = false;
  myTasksState.isError = false;
  myTasksState.refetch.mockClear();
  budgetReviewState.data = [];
  budgetReviewState.refetch.mockClear();
  erpPurchasesState.refetch.mockClear();
  deliveryState.refetch.mockClear();
  pipelineState.data = { stages: [], projects: [] };
  pipelineState.refetch.mockClear();
  arAgingState.data = [];
  financePositionState.position = { receivablesAgeing: {}, receivablesNoDueDateCounts: {}, payablesAgeing: {}, overdue: [] };
  financePositionState.isError = false;
  financePositionState.retry.mockClear();
  lossState.refetch.mockClear();
  needsState.areaItems = [
    { id: 'at-risk', count: 2, label: 'projects at risk', href: '/projects?filter=at-risk', tone: 'warn' },
    { id: 'ready-to-bill', count: 1, label: 'work order still to invoice', href: '/projects', tone: 'neutral' },
  ];
  figureState.result = {
    today: defaultToday.map((figure) => figure.id === 'contract-on-hand' && state.unknownContract ? { ...figure, value: null } : figure),
    period: periodFigures,
    todayPending: false, todayError: false, periodPending: false, periodError: false,
    todayRetry: vi.fn(), periodRetry: vi.fn(), trendRetry: vi.fn(),
    dashboard: { top_projects: [], attention_projects: [], projects_by_status: [{ status: 'Ongoing Project', count: 1 }], procurements_by_status: [], pipeline_projected_margin: 0.2, on_hand_actual_coverage_count: 1, on_hand_actual_coverage_total: 1, active_delivery_projects: 2 },
    dashboardPending: false, dashboardError: false, dashboardRetry: vi.fn(),
    pipeline: { projects: [], stages: [] }, pipelinePending: false, pipelineError: false, pipelineRetry: vi.fn(),
    winRateRange: { key: 'test-period', from: new Date(2026, 0, 1), to: new Date(2026, 9, 27) },
    orgCurrency: 'USD', currencyPending: false, organizationToday: '2026-10-27', organizationDayPending: false,
    isEmpty: false,
    figureStatus: () => ({ pending: false, error: false }),
    receivables: { count: 0, notDue: [], overdue: [], overdueCount: 0, unknownBalances: 0, oldestDays: null },
    payables: { count: 0, notDue: [], overdue: [], overdueCount: 0, unknownBalances: 0, oldestDays: null },
    receivablesPending: false, receivablesError: false, payablesPending: false, payablesError: false,
    leftToBillByProject: [], collectedPending: false,
    invoicedTrend: null, trendPending: false, trendError: false, trendInvoicedByMonth: [], collectedByMonth: [],
  };
});

describe('company home — floor (floor-tests/home-company.md)', () => {
  it('floor: the custom From month and To month drive the period figures and the URL', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.selectOptions(screen.getByRole('combobox', { name: 'Period' }), 'custom');
    fireEvent.change(screen.getByLabelText('From month'), { target: { value: '2026-01' } });
    fireEvent.change(screen.getByLabelText('To month'), { target: { value: '2026-03' } });
    expect(screen.getByTestId('location')).toHaveTextContent('from=2026-01');
    expect(screen.getByTestId('location')).toHaveTextContent('to=2026-03');
    expect(screen.getAllByText('2026-01 – 2026-03').length).toBeGreaterThan(0);
  });

  it('floor: Refresh dashboard refetches every dashboard source read', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByRole('button', { name: 'Refresh dashboard' }));
    const f = figureState.result as Record<string, ReturnType<typeof vi.fn>>;
    expect(f.todayRetry).toHaveBeenCalledOnce();
    expect(f.periodRetry).toHaveBeenCalledOnce();
    expect(f.dashboardRetry).toHaveBeenCalledOnce();
    expect(f.pipelineRetry).toHaveBeenCalledOnce();
    expect(f.trendRetry).toHaveBeenCalledOnce();
    expect(needsState.refetch).toHaveBeenCalledOnce();
    expect(procurementsState.refetch).toHaveBeenCalledOnce();
    expect(projectsState.refetch).toHaveBeenCalledOnce();
  });

  it('floor: the hidden Owed-by-clients figure offers Set up, which opens accounting administration', async () => {
    setToday('owed-clients', { value: null, amounts: null });
    const user = userEvent.setup();
    renderPage();
    await openHiddenReasons();
    await user.click((await screen.findAllByRole('link', { name: 'Set up' }))[0]);
    expect(screen.getByTestId('location')).toHaveTextContent(/^\/administration\/accounting$/);
  });

  it('floor: the finding line off-track clause opens the projects list', async () => {
    overviewLayout();
    setAttention([attention(1, { overdue_items: 3, overdue_tasks: 3 })]);
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByRole('link', { name: /off track/ }));
    expect(screen.getByTestId('location')).toHaveTextContent(/^\/projects$/);
  });

  it('floor: the finding line overdue-invoices clause opens Receivables filtered to overdue', async () => {
    overviewLayout();
    needsState.overdueInvoices = { count: 3, knownTotals: [], unknownBalances: 0, oldestDays: 45 };
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByRole('link', { name: /client invoice/ }));
    expect(screen.getByTestId('location')).toHaveTextContent('/finance/receivables?overdue=true');
  });

  it('floor: the finding line approvals clause opens /approvals', async () => {
    overviewLayout();
    needsState.approvals = [
      { key: 'expense-c1', kind: 'expense', createdAt: '2026-10-20T00:00:00Z', row: { claim: { id: 'c1', title: 'Fuel claim', claimant: { full_name: 'Cass' }, amount: 100000, currency: 'IDR' } } },
      { key: 'expense-c2', kind: 'expense', createdAt: '2026-10-21T00:00:00Z', row: { claim: { id: 'c2', title: 'Tools claim', claimant: { full_name: 'Cass' }, amount: 150000, currency: 'IDR' } } },
    ];
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByRole('link', { name: /approvals wait on you/ }));
    expect(screen.getByTestId('location')).toHaveTextContent(/^\/approvals$/);
  });

  it.each([
    ['Contract on hand', '/projects'],
    ['Invoiced', '/finance/receivables'],
    ['Collected', '/finance/receivables?view=payments'],
    ['Left to bill', '/finance/reports'],
  ])('floor: the %s tile opens %s', async (label, href) => {
    const user = userEvent.setup();
    renderPage();
    await user.click(within(figures()).getByRole('link', { name: new RegExp(label) }));
    expect(screen.getByTestId('location')).toHaveTextContent(href);
  });

  it('floor: each Waits row opens its destination', async () => {
    state.role = 'Finance';
    needsState.items = [
      { id: 'approvals', count: 2, label: 'Approvals', href: '/approvals', tone: 'warn' },
      { id: 'supplier-invoices', count: 3, label: 'supplier invoices to approve', href: '/finance/payables?status=Vendor+Invoiced', tone: 'warn' },
      { id: 'overdue-invoices', count: 1, label: 'client invoice overdue', href: '/finance/receivables?overdue=true', tone: 'lost' },
      { id: 'ready-to-bill', count: 1, label: 'work order still to invoice', href: '/projects?filter=ready-to-bill', tone: 'neutral' },
    ];
    myTasksState.data = [{ id: 'late', status: 'In Progress', end_date: '2026-10-26' }];
    const user = userEvent.setup();
    renderPage();
    const waits = within(screen.getByTestId('waits-on-you'));
    await user.click(waits.getByRole('link', { name: /Approvals/ }));
    expect(screen.getByTestId('location')).toHaveTextContent('/approvals');
    await user.click(waits.getByRole('link', { name: /supplier invoices to approve/ }));
    expect(screen.getByTestId('location')).toHaveTextContent('/finance/payables');
    await user.click(waits.getByRole('link', { name: /client invoice overdue/ }));
    expect(screen.getByTestId('location')).toHaveTextContent('/finance/receivables?overdue=true');
    await user.click(waits.getByRole('link', { name: /work order still to invoice/ }));
    expect(screen.getByTestId('location')).toHaveTextContent('/projects?filter=ready-to-bill');
    await user.click(waits.getByRole('link', { name: /task overdue/ }));
    expect(screen.getByTestId('location')).toHaveTextContent('/my-tasks');
  });

  it('floor: All approvals on the waits card opens /approvals', async () => {
    overviewLayout();
    needsState.approvals = [
      { key: 'expense-c1', kind: 'expense', createdAt: '2026-10-20T00:00:00Z', row: { claim: { id: 'c1', title: 'Fuel claim', claimant: { full_name: 'Cass' }, amount: 100000, currency: 'IDR' } } },
      { key: 'expense-c2', kind: 'expense', createdAt: '2026-10-21T00:00:00Z', row: { claim: { id: 'c2', title: 'Tools claim', claimant: { full_name: 'Cass' }, amount: 150000, currency: 'IDR' } } },
    ];
    const user = userEvent.setup();
    renderPage();
    await user.click(within(screen.getByTestId('waits-on-you')).getByRole('link', { name: /All 2 approvals/ }));
    expect(screen.getByTestId('location')).toHaveTextContent(/^\/approvals$/);
  });

  it('floor: the waits card Retry refetches what waits on you', async () => {
    needsState.isError = true;
    renderPage();
    const waits = within(screen.getByTestId('waits-on-you'));
    const alert = waits.getByText("Couldn't load what waits on you").closest('[role="alert"]') as HTMLElement;
    await userEvent.click(within(alert).getByRole('button', { name: 'Retry' }));
    expect(needsState.refetch).toHaveBeenCalledOnce();
  });

  it('floor: All projects opens the projects list', async () => {
    setAttention([attention(1, { overdue_items: 3, overdue_tasks: 3 })]);
    projectsState.data = new Array(4).fill({});
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByRole('link', { name: 'All 4 projects' }));
    expect(screen.getByTestId('location')).toHaveTextContent(/^\/projects$/);
  });

  it('floor: Open receivables opens the receivables list', async () => {
    overviewLayout();
    state.role = 'Finance';
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByRole('link', { name: 'Open receivables' }));
    expect(screen.getByTestId('location')).toHaveTextContent(/^\/finance\/receivables$/);
  });

  it('floor: Open payables opens the payables list', async () => {
    overviewLayout();
    state.role = 'Finance';
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByRole('link', { name: 'Open payables' }));
    expect(screen.getByTestId('location')).toHaveTextContent(/^\/finance\/payables$/);
  });

  it('floor: the Won row opens the period-filtered Won projects', async () => {
    const user = userEvent.setup();
    renderPage();
    const sales = screen.getByRole('heading', { name: 'Sales' }).closest('.panel-card') as HTMLElement;
    await user.click(within(sales).getByRole('button', { name: /Won · 2/ }));
    expect(screen.getByTestId('location')).toHaveTextContent('/projects?status=Won');
  });

  it('floor: the receivables ageing Retry refetches the finance position', async () => {
    overviewLayout();
    state.role = 'Finance';
    financePositionState.isError = true;
    renderPage();
    const card = screen.getByTestId('chart-receivables-age');
    const alert = within(card).getByText("Couldn't load overdue invoices").closest('[role="alert"]') as HTMLElement;
    await userEvent.click(within(alert).getByRole('button', { name: 'Retry' }));
    expect(financePositionState.retry).toHaveBeenCalledOnce();
  });

  it('floor: the Client overdue table Retry refetches the finance position', async () => {
    state.role = 'Finance';
    financePositionState.isError = true;
    renderPage();
    const card = screen.getByRole('heading', { name: 'Client overdue' }).closest('.panel-card') as HTMLElement;
    const alert = within(card).getByText("Couldn't load overdue invoices").closest('[role="alert"]') as HTMLElement;
    await userEvent.click(within(alert).getByRole('button', { name: 'Retry' }));
    expect(financePositionState.retry).toHaveBeenCalledOnce();
    expect(figureState.result?.todayRetry).not.toHaveBeenCalled();
  });

  it('floor: the billing trend Retry refetches the trend read', async () => {
    (figureState.result as Record<string, unknown>).trendError = true;
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByText('Analysis'));
    const alert = screen.getByText("Couldn't load the invoiced trend").closest('[role="alert"]') as HTMLElement;
    await userEvent.click(within(alert).getByRole('button', { name: 'Retry' }));
    expect(figureState.result?.trendRetry).toHaveBeenCalledOnce();
  });

  it('floor: the plan-vs-actual Retry refetches the dashboard read and the projects directory', async () => {
    (figureState.result as Record<string, unknown>).dashboardError = true;
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByText('Analysis'));
    const alert = screen.getByText("Couldn't load delivery projects").closest('[role="alert"]') as HTMLElement;
    await userEvent.click(within(alert).getByRole('button', { name: 'Retry' }));
    expect(figureState.result?.dashboardRetry).toHaveBeenCalledOnce();
    expect(projectsState.refetch).toHaveBeenCalledOnce();
  });

  it('floor: the sales overview Retry refetches the pipeline read', async () => {
    overviewLayout();
    pipelineState.isError = true;
    renderPage();
    const alert = screen.getByText("Couldn't load pipeline stages").closest('[role="alert"]') as HTMLElement;
    await userEvent.click(within(alert).getByRole('button', { name: 'Retry' }));
    expect(pipelineState.refetch).toHaveBeenCalledOnce();
  });
});
