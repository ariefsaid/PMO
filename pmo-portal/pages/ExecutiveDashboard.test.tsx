import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router';
import React from 'react';
import ExecutiveDashboard from './ExecutiveDashboard';
import { ToastProvider } from '@/src/components/ui/Toast';
import { BahasaProvider } from '@/test/bahasa';
import { pinHomeLayout } from '@/test/homeLayout';

pinHomeLayout('focused');

const state = vi.hoisted(() => ({ role: 'Executive', unknownContract: false }));
const needsState = vi.hoisted(() => ({
  items: [{ id: 'approvals', count: 2, label: 'approvals waiting for you', href: '/approvals', tone: 'warn' } as { id: string; count: number; label: string; href: string; tone: string; detail?: string }],
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
  position: { receivablesAgeing: {} as Record<string, unknown>, payablesAgeing: {} as Record<string, unknown>, overdue: [] as unknown[] },
  isPending: false, isError: false, retry: vi.fn(),
}));
const defaultToday = [
  { id: 'contract-on-hand', label: 'Contract on hand', value: '$1,000', amounts: [{ currency: 'USD', amount: 1_000_000 }], subline: 'Left after spending: $500', href: '/projects', unavailableReason: 'Contract amount is not available.' },
  { id: 'billed-margin', label: 'Known margin on billed work', value: '$200', amounts: [{ currency: 'USD', amount: 200_000 }], subline: 'Known margin amount shown', href: '/finance/receivables' },
  { id: 'pipeline', label: 'Pipeline (weighted)', value: '$300', amounts: [{ currency: 'USD', amount: 300_000 }], subline: 'Gross: $600 · Forecast margin: 20%', href: '/sales' },
  { id: 'owed-clients', label: 'Owed by clients', value: '', amounts: [{ currency: 'USD', amount: 2_500_000 }], subline: '$400K overdue', href: '/finance/receivables', unavailableReason: 'some client invoice balances are not synced' },
  { id: 'supplier-payables', label: 'Owed to suppliers', value: '$100', amounts: [{ currency: 'USD', amount: 100_000 }], subline: '3 supplier invoices awaiting payment', href: '/procurement?status=Vendor+Invoiced' },
  { id: 'still-to-invoice', label: 'Still to invoice on work orders', value: '$250', amounts: [{ currency: 'USD', amount: 250_000 }], href: '/projects' },
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
  financePositionState.position = { receivablesAgeing: {}, payablesAgeing: {}, overdue: [] };
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

vi.mock('@/src/hooks/useProjectsDelivery', () => ({ useProjectsDelivery: () => ({ data: { 'project-6': 40 }, isPending: false, isError: false, refetch: vi.fn() }), useProjectsDeliverySummary: () => ({ data: {}, isPending: false, isError: false }) }));


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
const tile = (label: string) => within(figures()).getByText(label, { exact: true }).closest('div[class*="flex-col"]') as HTMLElement;
const openAnalysis = async () => { await userEvent.click(screen.getByText('Analysis')); };
const flat = (text: string | null) => (text ?? '').replace(/\u00a0/g, ' ');

describe('company home — executive (one question: is the company OK, what waits on me?)', () => {
  it('AC-DASH-1403-01: reads Waits on you, then Projects off track, then the position figures, then Sales', () => {
    renderPage();
    const order = ['Waits on you', 'Projects off track', 'Sales'].map((name) => screen.getByRole('heading', { name }));
    for (let i = 1; i < order.length; i += 1) expect(order[i - 1].compareDocumentPosition(order[i]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(figures().compareDocumentPosition(screen.getByRole('heading', { name: 'Sales' })) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Projects off track' }).compareDocumentPosition(figures()) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('shows no explanatory sentence under the title and exactly one help control on the page', () => {
    renderPage();
    expect(screen.getAllByRole('button', { name: /^About / })).toHaveLength(1);
    expect(screen.queryByText(/Position today in each record currency/)).not.toBeInTheDocument();
  });

  it('the one help control carries the figure definitions (no per-tile "?")', async () => {
    renderPage();
    await userEvent.click(screen.getByRole('button', { name: 'About Dashboard' }));
    expect(await screen.findByText(/Sum of contract values for delivery work/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Help: Contract on hand/ })).not.toBeInTheDocument();
  });

  it('AC-UX-016: the approvals row opens /approvals and states the count; nothing waiting is one plain line', () => {
    const { unmount } = renderPage();
    const row = screen.getByRole('link', { name: /2\s*approvals waiting for you/ });
    expect(row).toHaveAttribute('href', '/approvals');
    unmount();
    needsState.items = [];
    renderPage();
    expect(screen.getByText('Nothing waits on you.')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /waiting for you/ })).not.toBeInTheDocument();
  });

  it('F2/#1418: lists only off-track projects, in the server order, at most five, each opening its project', () => {
    setAttention([
      attention(6, { overdue_items: 4, waiting_approvals: 2, over_budget: true, budget_used_ratio: 1.5 }),
      attention(5, { overdue_items: 2 }),
      attention(9),
      attention(4, { over_budget: true, budget_used_ratio: 1.1 }),
      attention(3, { overdue_items: 1 }),
      attention(2, { overdue_items: 1 }),
      attention(1, { overdue_items: 1 }),
    ]);
    projectsState.data = new Array(7).fill({});
    renderPage();
    const list = screen.getByTestId('project-rows');
    const links = within(list).getAllByRole('link').filter((link) => link.getAttribute('href')?.startsWith('/projects/'));
    expect(links.map((link) => link.getAttribute('href'))).toEqual(['/projects/project-6', '/projects/project-5', '/projects/project-4', '/projects/project-3', '/projects/project-2']);
    expect(within(list).queryByText('Project 9')).not.toBeInTheDocument();
    const row = links[0];
    expect(row).toHaveTextContent('4 overdue · 2 awaiting approval · over budget');
    expect(row).toHaveTextContent('40%');
    expect(row).toHaveTextContent('150%');
    // A status pill takes its tone from the status map, not from being off track (red already means overdue).
    expect(within(row).getByText('Ongoing').closest('span')?.className ?? '').not.toMatch(/destructive|lost/);
    expect(within(list).getByText('Status')).toBeInTheDocument();
    expect(within(list).getByRole('link', { name: 'All 7 projects' })).toHaveAttribute('href', '/projects');
  });

  it('a project row opens its owning project page (AC-DASH-1403-10)', () => {
    setAttention([attention(1, { overdue_items: 3 })]);
    renderPage();
    fireEvent.click(within(screen.getByTestId('project-rows')).getByRole('link', { name: /Project 1/ }));
    expect(screen.getByTestId('location')).toHaveTextContent('/projects/project-1');
  });

  it('a status pill is neutral unless the state itself is an exception, even on a red-flagged row', () => {
    setAttention([attention(1, { overdue_items: 3, status: 'Won, Pending KoM' })]);
    renderPage();
    const row = within(screen.getByTestId('project-rows')).getByRole('link', { name: /Project 1/ });
    const pill = within(row).getByText('Won, pending kickoff').closest('span') as HTMLElement;
    expect(pill.className).not.toMatch(/success|green|done|destructive|lost/);
  });

  it('the Sales card shares a row with the position tiles on desktop; its stage bars are neutral and Won is a plain line, not a bar', () => {
    pipelineState.data = { stages: [{ status: 'Leads', count: 8, total_value: 2_000, weighted_value: 1_000, win_probability: 0.5 }], projects: [] };
    renderPage();
    const tiles = screen.getByRole('region', { name: 'Company figures' });
    const sales = screen.getByRole('heading', { name: 'Sales' }).closest('.panel-card') as HTMLElement;
    expect(tiles.parentElement).toBe(sales.parentElement);
    expect(sales.parentElement?.className).toMatch(/min-\[900px\]:grid-cols-2/);
    expect(sales.querySelectorAll('.bg-primary, .bg-success').length).toBe(0);
    const won = within(sales).getByRole('button', { name: /Won · Year to date · 2/ });
    expect(won.querySelector('[aria-hidden="true"]')).toBeNull();
  });

  it('says so when no project is off track, and names projects that cannot be checked against their budget', () => {
    (figureState.result?.dashboard as Record<string, unknown>).risk_unchecked_projects = 6;
    renderPage();
    expect(screen.getByText('No checked project is off track.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /6 projects can’t be checked against their budget/ })).toHaveAttribute('href', '/projects');
  });

  it('shows the position as money tiles that each carry their currency, with no bare count among them', () => {
    renderPage();
    const labels = within(figures()).getAllByText(/^(Contract on hand|Invoiced|Owed by clients|Owed to suppliers)$/).map((node) => node.textContent);
    expect(labels).toEqual(['Contract on hand', 'Invoiced', 'Owed by clients', 'Owed to suppliers']);
    expect(tile('Contract on hand')).toHaveTextContent('$1M');
    expect(tile('Owed by clients')).toHaveTextContent('$2.5M');
    expect(tile('Owed by clients')).toHaveTextContent('$400K overdue');
    expect(within(figures()).queryByText(/Owed by clients · overdue/)).not.toBeInTheDocument();
    expect(within(figures()).queryByText(/^\d+$/)).not.toBeInTheDocument();
  });

  it('puts a second currency on its own line, never joined into one figure', () => {
    renderPage();
    const invoiced = tile('Invoiced');
    expect(flat(invoiced.textContent)).not.toMatch(/·/);
    const second = within(invoiced).getByText('+ IDR 5.3M');
    expect(second).toHaveClass('block');
    expect(invoiced).toHaveTextContent('$7.7M');
  });

  it('F2: known margin is a fifth tile only when the accounting source provides it', () => {
    const { unmount } = renderPage();
    expect(within(figures()).getByText('Known margin on billed work')).toBeInTheDocument();
    unmount();
    setToday('billed-margin', { value: null, amounts: null });
    renderPage();
    expect(within(figures()).queryByText('Known margin on billed work')).not.toBeInTheDocument();
  });

  it('AC-DASH-1403-02: an unknown figure draws nothing; one page line says what is missing and links to the fix', () => {
    state.role = 'Admin';
    setToday('owed-clients', { value: null, amounts: null });
    renderPage();
    expect(within(figures()).queryByText('Owed by clients')).not.toBeInTheDocument();
    const line = screen.getByTestId('figures-hidden');
    expect(line).toHaveTextContent('1 figure hidden: some client invoice balances are not synced');
    expect(within(line).getByRole('link', { name: 'Set up' })).toHaveAttribute('href', '/administration/accounting');
    expect(screen.queryByText('0')).not.toBeInTheDocument();
  });

  it('#2055: the pipeline is one set of bars with a count per stage and Won last; a bar opens the stage', async () => {
    pipelineState.data = { stages: [
      { status: 'Leads', count: 8, total_value: 2_000, weighted_value: 1_000, win_probability: 0.5 },
      { status: 'Negotiation', count: 2, total_value: 8_000, weighted_value: 4_000, win_probability: 0.5 },
      { status: 'Ongoing Project', count: 5, total_value: 9, weighted_value: 9, win_probability: 1 },
    ], projects: [] };
    renderPage();
    const sales = screen.getByRole('heading', { name: 'Sales' }).closest('.panel-card') as HTMLElement;
    expect(within(sales).getByRole('button', { name: /Leads · 8/ })).toBeInTheDocument();
    expect(within(sales).getByRole('button', { name: /Negotiation · 2/ })).toBeInTheDocument();
    expect(within(sales).queryByText(/Ongoing/)).not.toBeInTheDocument();
    expect(within(sales).queryByRole('table')).toBeNull();
    expect(within(sales).getByRole('button', { name: /Won · Year to date · 2/ })).toHaveTextContent('$14.4M');
    expect(within(sales).getByText('Weighted pipeline')).toBeInTheDocument();
    await userEvent.click(within(sales).getByRole('button', { name: /Negotiation/ }));
    expect(screen.getByTestId('location')).toHaveTextContent('/sales?status=Negotiation');
  });

  it('keeps the analysis blocks that have no page of their own behind one closed "Analysis" heading', async () => {
    renderPage();
    expect(screen.queryByRole('heading', { name: 'Plan vs actual' })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Purchasing by stage' })).not.toBeInTheDocument();
    await openAnalysis();
    expect(await screen.findByRole('heading', { name: 'Plan vs actual' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Purchasing by stage' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Billing' })).toBeInTheDocument();
  });

  it('AC-DASH-1403-03: the period picker writes the selected period into the URL', () => {
    renderPage();
    fireEvent.change(screen.getByRole('combobox', { name: 'Period' }), { target: { value: 'month' } });
    expect(screen.getByTestId('location')).toHaveTextContent('/?period=month');
  });

  it('AC-DASH-1403-06: Admin sees the same company home as Executive', () => {
    state.role = 'Admin';
    renderPage();
    expect(screen.getByRole('heading', { name: 'Projects off track' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Sales' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Ready to pay' })).not.toBeInTheDocument();
  });

  it('AC-DASH-1403-07: a failed waits query leaves the rest usable and offers retry', () => {
    needsState.isError = true;
    renderPage();
    expect(screen.getByText("Couldn't load what waits on you")).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Projects off track' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Sales' })).toBeInTheDocument();
  });

  it('AC-DASH-1403-08: headings use the Bahasa catalogue', () => {
    renderBahasaPage();
    expect(screen.getByRole('heading', { name: 'Dasbor' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Menunggu Anda' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Proyek menyimpang' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Penjualan' })).toBeInTheDocument();
  });
});

describe('company home — finance (one question: what must I collect, pay and invoice today?)', () => {
  beforeEach(() => { state.role = 'Finance'; });

  it('AC-DASH-1403-04: waits rows in the finance order, then overdue from clients, then ready to pay, then the position', () => {
    needsState.items = [
      { id: 'ready-to-bill', count: 1, label: 'work order still to invoice', href: '/projects', tone: 'neutral' },
      { id: 'overdue-invoices', count: 2, label: 'client invoices overdue', detail: 'oldest 118 days overdue', href: '/finance/receivables?overdue=true', tone: 'lost' },
      { id: 'supplier-invoices', count: 3, label: 'supplier invoices to pay', href: '/procurement?status=Vendor+Invoiced', tone: 'warn' },
      { id: 'approvals', count: 1, label: 'approval waiting for you', href: '/approvals', tone: 'warn' },
    ];
    renderPage();
    const rows = within(screen.getByTestId('waits-on-you')).getAllByRole('link').map((link) => link.getAttribute('href'));
    expect(rows).toEqual(['/approvals', '/procurement?status=Vendor+Invoiced', '/finance/receivables?overdue=true', '/projects']);
    expect(screen.getByText('oldest 118 days overdue')).toBeInTheDocument();
    const order = ['Waits on you', 'Overdue from clients', 'Ready to pay'].map((name) => screen.getByRole('heading', { name }));
    for (let i = 1; i < order.length; i += 1) expect(order[i - 1].compareDocumentPosition(order[i]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(within(figures()).getAllByText(/^(Owed by clients|Owed to suppliers|Invoiced|Collected)$/)).toHaveLength(4);
  });

  it('carries no sales pipeline, win rate or loss analysis', async () => {
    renderPage();
    expect(screen.queryByRole('heading', { name: 'Sales' })).not.toBeInTheDocument();
    await openAnalysis();
    expect(screen.queryByText(/Win rate/)).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: /Why deals were lost/ })).not.toBeInTheDocument();
  });

  it('lists overdue client invoices worst first with the days overdue; a row opens the overdue list', () => {
    financePositionState.position = {
      ...financePositionState.position,
      overdue: [
        { invoice: { id: 'i1', customer_name: 'Client A', pmo_number: 'INV-1', currency: 'USD' }, daysOverdue: 118, outstanding: 100_000 },
        { invoice: { id: 'i2', customer_name: 'Client B', pmo_number: 'INV-2', currency: 'USD' }, daysOverdue: 12, outstanding: 5_000 },
      ],
    };
    renderPage();
    const card = screen.getByRole('heading', { name: 'Overdue from clients' }).closest('.panel-card') as HTMLElement;
    const names = within(card).getAllByRole('row').slice(1).map((row) => row.textContent);
    expect(names[0]).toContain('Client A');
    expect(names[0]).toContain('$1,000');
    expect(names[0]).toContain('118 days overdue');
    expect(names[1]).toContain('Client B');
    fireEvent.click(within(card).getByRole('button', { name: 'Open overdue invoice for Client A' }));
    expect(screen.getByTestId('location')).toHaveTextContent('/finance/receivables?overdue=true');
  });

  it('shows the invoice reference and the invoice total (known even when the outstanding balance is not)', () => {
    financePositionState.position = {
      ...financePositionState.position,
      overdue: [{ invoice: { id: 'i1', customer_name: 'Client A', pmo_number: 'INV-1', currency: 'USD', amount: 2_500, tax_amount: 0, tax_treatment: 'inclusive' }, daysOverdue: 118, outstanding: null }],
    };
    renderPage();
    const card = screen.getByRole('heading', { name: 'Overdue from clients' }).closest('.panel-card') as HTMLElement;
    expect(within(card).getByRole('columnheader', { name: 'Invoice' })).toBeInTheDocument();
    expect(within(card).getByRole('columnheader', { name: 'Invoice total' })).toBeInTheDocument();
    expect(within(card).queryByRole('columnheader', { name: 'Outstanding' })).not.toBeInTheDocument();
    const row = within(card).getAllByRole('row')[1];
    expect(row).toHaveTextContent('INV-1');
    expect(row).toHaveTextContent('$2,500');
  });

  it('unknown never reads as zero: Collected with no receipts recorded while client balances are not synced is hidden under the one page line', () => {
    setToday('owed-clients', { value: null, amounts: null });
    figureState.result = { ...figureState.result, period: periodFigures.map((figure) => figure.id === 'collected' ? { ...figure, amounts: [] } : figure) };
    renderPage();
    const figures = screen.getByRole('region', { name: 'Company figures' });
    expect(within(figures).queryByText('Collected', { exact: true })).not.toBeInTheDocument();
    expect(screen.getByTestId('figures-hidden')).toHaveTextContent('incoming payments are not synced');
  });

  it('a recorded zero is still drawn once client balances are known', () => {
    figureState.result = { ...figureState.result, period: periodFigures.map((figure) => figure.id === 'collected' ? { ...figure, amounts: [] } : figure) };
    renderPage();
    const figures = screen.getByRole('region', { name: 'Company figures' });
    const tile = within(figures).getByText('Collected', { exact: true }).parentElement?.parentElement?.parentElement as HTMLElement;
    expect(tile).toHaveTextContent('$0');
  });

  it('C4/O12: a column that is blank on every row (unknown outstanding, no invoice number) is not drawn', () => {
    financePositionState.position = {
      ...financePositionState.position,
      overdue: [{ invoice: { id: 'i1', customer_name: 'Client A', pmo_number: null, currency: 'USD' }, daysOverdue: 118, outstanding: null }],
    };
    renderPage();
    expect(screen.queryByRole('columnheader', { name: 'Outstanding' })).not.toBeInTheDocument();
    expect(screen.queryByRole('columnheader', { name: 'Invoice' })).not.toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Client' })).toBeInTheDocument();
  });

  it('AC-DASH-1403-11: a ready-to-pay row opens its procurement record page; the supplier column drops when blank', () => {
    procurementsState.data = [{
      id: 'procurement-1', title: 'Supplier invoice 42', status: 'Vendor Invoiced', total_value: 250,
      currency: 'USD', updated_at: '2026-10-20T00:00:00.000Z', vendor_invoiced_at: '2026-10-20T00:00:00.000Z',
      project: { name: 'Project North' }, vendor: null,
    }];
    renderPage();
    expect(screen.queryByRole('columnheader', { name: 'Supplier' })).not.toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Invoice age' })).toBeInTheDocument();
    expect(screen.queryByRole('columnheader', { name: 'Due state' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Open Supplier invoice 42' }));
    expect(screen.getByTestId('location')).toHaveTextContent('/procurement/procurement-1');
  });

  it('F2: the budget review is drawn only when some spending is known, and shows the top five active budgets in RPC order', () => {
    const budget = (id: string, over: Record<string, unknown> = {}) => ({ id, name: `Budget ${id}`, client_name: null, status: 'Ongoing Project', currency: 'USD', budget: 1_000, budget_currency: 'USD', spent: 1_500, variance: 500, actual_currency: 'USD', actual_complete: true, actual_coverage_count: 1, actual_coverage_total: 1, actual_as_of: null, ...over });
    budgetReviewState.data = [budget('1', { spent: null, variance: null, actual_complete: false })];
    const { unmount } = renderPage();
    // Unknown spending on every row: no card, and the page's one hidden line names it.
    expect(screen.queryByRole('heading', { name: 'Budget review' })).not.toBeInTheDocument();
    expect(screen.getByTestId('figures-hidden')).toHaveTextContent('project spending is not recorded');
    unmount();
    budgetReviewState.data = [budget('x', { status: 'Leads' }), ...['1', '2', '3', '4', '5', '6'].map((id) => budget(id))];
    renderPage();
    expect(screen.getByRole('heading', { name: 'Budget review' })).toBeInTheDocument();
    for (const id of ['1', '2', '3', '4', '5']) expect(screen.getByText(`Budget ${id}`)).toBeInTheDocument();
    expect(screen.queryByText('Budget 6')).not.toBeInTheDocument();
    expect(screen.queryByText('Budget x')).not.toBeInTheDocument();
    expect(screen.getAllByText('Over budget').length).toBeGreaterThan(0);
  });

  it('a period-bound figure names its period: Invoiced and Collected carry the picker\'s period as their caption', () => {
    renderPage();
    const figures = screen.getByRole('region', { name: 'Company figures' });
    for (const label of ['Invoiced', 'Collected']) {
      const tile = within(figures).getByText(label, { exact: true }).parentElement?.parentElement?.parentElement as HTMLElement;
      expect(tile).toHaveTextContent('Year to date');
    }
  });

  it('L12: with no accounting ageing synced, the analysis shows the same PMO client and supplier ageing as the finance hub', async () => {
    financePositionState.position = {
      ...financePositionState.position,
      receivablesAgeing: { USD: { notDue: 100_00, d1_30: 50_00, d31_60: 0, d61_90: 0, over90: 0 } },
      payablesAgeing: { USD: { d0_30: 70_00, d31_60: 0, d61_90: 0, over90: 0 } },
    };
    renderPage();
    expect(screen.queryByRole('region', { name: 'Client balances by age' })).not.toBeInTheDocument();
    await openAnalysis();
    const clientAgeing = await screen.findByRole('region', { name: 'Client balances by age' });
    expect(within(clientAgeing).getByText('$100')).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Waiting to pay, by days' })).toBeInTheDocument();
  });
});

describe('company home — routing, states and loading', () => {
  it('AC-DASH-1403-05: Engineer is routed to the personal dashboard with no company money figures', () => {
    state.role = 'Engineer';
    renderPage();
    expect(screen.getByTestId('engineer-dashboard')).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Company figures' })).not.toBeInTheDocument();
    expect(screen.queryByText('$1M')).not.toBeInTheDocument();
  });

  it('AC-DASH-1403-09: Project Manager remains routed to the personal projects dashboard', () => {
    state.role = 'Project Manager';
    renderPage();
    expect(screen.getByTestId('pm-dashboard')).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Company figures' })).not.toBeInTheDocument();
  });

  it('AC-FAA-006: the company empty state appears only when there is no project or procurement evidence at all', () => {
    const current = figureState.result as Record<string, unknown>;
    figureState.result = { ...current, isEmpty: true, dashboard: { ...(current.dashboard as object), projects_by_status: [], procurements_by_status: [] } };
    renderPage();
    expect(screen.getByText('No company activity yet')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Waits on you' })).not.toBeInTheDocument();
  });

  it('AC-706: the position figures show loading skeletons while pending, never values', () => {
    figureState.result = { ...figureState.result, todayPending: true };
    renderPage();
    expect(within(figures()).getAllByTestId('kpi-skeleton').length).toBeGreaterThan(0);
    expect(within(figures()).queryByText('$1M')).not.toBeInTheDocument();
  });

  it('AC-707: a failed figures load shows the error with a working retry', () => {
    const retry = vi.fn();
    figureState.result = { ...figureState.result, todayError: true, todayRetry: retry };
    renderPage();
    expect(screen.getByText("Couldn't load company position figures")).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(retry).toHaveBeenCalled();
  });

  it('AC-UXA-003: Bahasa error states read in Bahasa, never the English fallback', () => {
    needsState.isError = true;
    renderBahasaPage();
    expect(screen.queryByText("Couldn't load what waits on you")).not.toBeInTheDocument();
    expect(screen.getByText('Daftar yang menunggu Anda tidak dapat dimuat')).toBeInTheDocument();
  });
});

describe('company home — Overview layout (the default: one page, charts carry the analysis)', () => {
  beforeEach(() => { localStorage.setItem('home-layout', 'overview'); });
  // A chart's accessible name carries its values, one "; "-separated entry per bar or column, in drawing order.
  const tableCells = (name: string) => (screen.getByRole('img', { name: new RegExp(`^${name}\\.`) }).getAttribute('aria-label') ?? '').slice(name.length + 2).split('; ');

  it('an unknown or missing stored layout is Overview; Focused is only an explicit choice', () => {
    localStorage.removeItem('home-layout');
    const { unmount } = renderPage();
    expect(document.querySelector('[data-home-layout="overview"]')).not.toBeNull();
    unmount();
    localStorage.setItem('home-layout', 'sideways');
    renderPage();
    expect(document.querySelector('[data-home-layout="overview"]')).not.toBeNull();
  });

  it('executive: waits, off-track, figures, budget and sales charts, with the Analysis section holding only billing', async () => {
    renderPage();
    for (const name of ['Waits on you', 'Projects off track', 'Sales']) expect(screen.getByRole('heading', { name })).toBeInTheDocument();
    expect(within(figures()).getByText('Contract on hand')).toBeInTheDocument();
    await openAnalysis();
    expect(screen.queryByRole('heading', { name: 'Plan vs actual' })).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Billing' })).toBeInTheDocument();
  });

  it('draws budget and spending per project, worst first, and leaves out a project whose spending is unknown', () => {
    const top = (id: string, spent: number | null) => ({ id, name: `Delivery ${id}`, client_name: null, contract_value: 10_000, currency: 'USD', budget: 4_000, budget_currency: 'USD', spent, actual_complete: spent !== null, actual_currency: 'USD', status: 'Ongoing Project' });
    (figureState.result?.dashboard as Record<string, unknown>).top_projects = [top('a', 1_000), top('b', 5_000), top('c', null)];
    renderPage();
    const rows = tableCells('Budget and spending by project');
    expect(rows[0]).toContain('Delivery b');
    expect(rows[0]).toContain('Spent $5K');
    expect(rows[1]).toContain('Delivery a');
    expect(rows[2]).toContain('Delivery c');
    expect(rows[2]).not.toContain('Spent');
  });

  it('with no recorded spending the budget chart is not drawn and the page line counts it', () => {
    const top = { id: 'a', name: 'Delivery a', client_name: null, contract_value: 10_000, currency: 'USD', budget: 4_000, budget_currency: 'USD', spent: null, actual_complete: false, actual_currency: null, status: 'Ongoing Project' };
    (figureState.result?.dashboard as Record<string, unknown>).top_projects = [top];
    renderPage();
    expect(screen.queryByRole('heading', { name: 'Budget and spending by project' })).not.toBeInTheDocument();
    expect(screen.getByTestId('figures-hidden')).toHaveTextContent('project spending is not recorded');
  });

  it('the sales card draws the open stages as bars on one scale with their counts, Won as a figure, and no stage table', () => {
    pipelineState.data = { stages: [
      { status: 'Leads', count: 8, total_value: 2_000, weighted_value: 1_000, win_probability: 0.5 },
      { status: 'Negotiation', count: 2, total_value: 8_000, weighted_value: 4_000, win_probability: 0.5 },
      { status: 'Ongoing Project', count: 5, total_value: 9, weighted_value: 9, win_probability: 1 },
    ], projects: [] };
    renderPage();
    const rows = tableCells('Weighted pipeline by stage');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toContain('Leads · 8');
    expect(rows[1]).toContain('Negotiation · 2');
    expect(rows.join(' ')).not.toContain('Ongoing');
    const sales = screen.getByRole('heading', { name: 'Sales' }).closest('.panel-card') as HTMLElement;
    expect(within(sales).getByRole('button', { name: /Won · Year to date · 2/ })).toHaveTextContent('$14.4M');
  });

  it('draws purchasing as one stacked bar with a count per stage, and invoiced by month only from three months of history', () => {
    (figureState.result?.dashboard as Record<string, unknown>).procurements_by_status = [{ status: 'Requested', count: 3 }, { status: 'Vendor Invoiced', count: 1 }];
    renderPage();
    const purchasing = screen.getByRole('heading', { name: 'Purchasing by stage' }).closest('.panel-card') as HTMLElement;
    expect(purchasing).toHaveTextContent('Request 3');
    expect(purchasing).toHaveTextContent('Pay 1');
    expect(screen.queryByRole('heading', { name: /Invoiced/ })).not.toBeInTheDocument();
    expect(screen.getByTestId('figures-hidden')).toHaveTextContent('invoicing has fewer than three months of history');
  });

  it('draws invoiced next to collected by month once receipts are recorded', () => {
    const points = ['2026-05-01', '2026-06-01', '2026-07-01'].map((month, index) => ({ month, amount: 1_000 * (index + 1) }));
    figureState.result = { ...figureState.result, invoicedTrend: { currency: 'USD', points, total: 6_000, first: 1_000, last: 3_000, direction: 'up', hasLine: true }, collectedByMonth: new Map([['2026-06', 500]]), trendPending: false, trendError: false, trendRetry: vi.fn() };
    renderPage();
    const rows = tableCells('Invoiced and collected by month');
    expect(rows).toHaveLength(3);
    expect(rows[1]).toContain('Invoiced, excl. tax $2K');
    expect(rows[1]).toContain('Collected $500');
    expect(rows[0]).toContain('Collected $0');
  });

  it('finance: overdue from clients beside waits, receivables by age, and an unknown balance counted, not drawn', () => {
    state.role = 'Finance';
    financePositionState.position = { receivablesAgeing: { USD: { notDue: 100_000, d1_30: 50_000, d31_60: 0, d61_90: 0, over90: 25_000 } }, payablesAgeing: {}, overdue: [], receivablesUnknownCount: 2 } as never;
    renderPage();
    for (const name of ['Waits on you', 'Overdue from clients', 'Ready to pay']) expect(screen.getByRole('heading', { name })).toBeInTheDocument();
    const rows = tableCells('Owed by clients, by age');
    expect(rows).toHaveLength(5);
    expect(rows[0]).toContain('$1K');
    expect(rows[4]).toContain('Over 90 days');
    expect(screen.getByText('2 invoices with unknown balances are not drawn')).toBeInTheDocument();
  });
});
