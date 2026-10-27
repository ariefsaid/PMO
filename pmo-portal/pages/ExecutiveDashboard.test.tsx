import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router';
import React from 'react';
import ExecutiveDashboard from './ExecutiveDashboard';
import { ToastProvider } from '@/src/components/ui/Toast';
import { BahasaProvider } from '@/test/bahasa';

const state = vi.hoisted(() => ({ role: 'Executive', unknownContract: false }));
const needsState = vi.hoisted(() => ({
  items: [{ id: 'approvals', count: 2, label: '2 approvals waiting for you', href: '/approvals', tone: 'warn' }],
  areaItems: [
    { id: 'at-risk', count: 2, label: '2 projects at risk', href: '/projects?filter=at-risk', tone: 'warn' },
    { id: 'ready-to-bill', count: 1, label: '1 work order still to invoice', href: '/projects', tone: 'neutral' },
  ],
  isPending: false,
  isError: false,
  refetch: vi.fn(),
}));
const projectsState = vi.hoisted(() => ({ data: [] as unknown[], isPending: false, isError: false, refetch: vi.fn() }));
const procurementsState = vi.hoisted(() => ({ data: [] as unknown[], isPending: false, isError: false, refetch: vi.fn() }));
const defaultToday = [
  { id: 'contract-on-hand', label: 'Contract on hand', value: '$1,000', subline: 'Left after spending: $500', href: '/projects', unavailableReason: 'Contract amount is not available.' },
  { id: 'billed-margin', label: 'Known margin on billed work', value: '$200', subline: 'Known margin: amount shown · Percent of billed work: —', href: '/sales-invoices' },
  { id: 'pipeline', label: 'Pipeline (weighted)', value: '$300', subline: 'Gross: $600 · Forecast margin: 20%', href: '/sales' },
  { id: 'client-overdue', label: 'Owed by clients · overdue', value: '2', subline: '$400 · Oldest 14 days overdue', href: '/sales-invoices?overdue=true' },
  { id: 'supplier-payables', label: 'Owed to suppliers', value: '$100', href: '/procurement?status=Vendor+Invoiced' },
  { id: 'still-to-invoice', label: 'Still to invoice on work orders', value: '$250', href: '/projects' },
];
const figureState = vi.hoisted(() => ({
  result: null as null | Record<string, unknown>,
}));

vi.mock('@/src/auth/impersonation', () => ({ useEffectiveRole: () => ({ effectiveRole: state.role, realRole: state.role }) }));
vi.mock('@/src/components/dashboard/restructure/useCompanyFigures', () => ({
  useCompanyFigures: () => figureState.result,
}));
vi.mock('@/src/components/dashboard/restructure/useNeedsYou', () => ({
  useNeedsYou: () => needsState,
}));
vi.mock('@/src/hooks/useFxOrgDay', () => ({ useFxOrgDay: () => ({ day: '2026-10-27', isPending: false, isError: false, retry: vi.fn() }) }));
vi.mock('@/src/hooks/useDashboard', () => ({
  useSalesPipeline: () => ({ data: { stages: [], projects: [] }, isPending: false, isError: false, refetch: vi.fn() }),
  useFinanceBudgetReview: () => ({ data: [], isPending: false, isError: false, refetch: vi.fn() }),
  useWinRate: () => ({ data: { wins_count: 2, losses_count: 1, wins_value: 500, losses_value: 250, win_rate_count: 2 / 3, win_rate_value: 2 / 3 }, isPending: false, isError: false, refetch: vi.fn() }),
}));
vi.mock('@/src/hooks/useProcurements', () => ({ useProcurements: () => procurementsState }));
vi.mock('@/src/hooks/useProjects', () => ({ useProjects: () => projectsState }));
vi.mock('@/src/hooks/useErpSnapshots', () => ({
  useActualsSnapshot: () => ({ data: [], isPending: false, isError: false, refetch: vi.fn() }),
  useApAgingSnapshot: () => ({ data: [], isPending: false, isError: false, refetch: vi.fn() }),
  useArAgingSnapshot: () => ({ data: [], isPending: false, isError: false, refetch: vi.fn() }),
}));
vi.mock('@/src/hooks/useOrgCurrency', () => ({ useOrgCurrency: () => 'USD' }));
vi.mock('@/src/hooks/useProjectStatusLabel', () => ({ useProjectStatusLabel: () => (status: string) => status, useProcurementStatusLabel: () => (status: string) => status }));
vi.mock('@/src/components/dashboard/EngineerDashboard', () => ({ EngineerDashboard: () => <div data-testid="engineer-dashboard">Engineer work</div> }));
vi.mock('@/src/components/dashboard/PMDashboard', () => ({ PMDashboard: () => <div data-testid="pm-dashboard">My projects</div> }));

const periodFigures = [
  { id: 'invoiced', label: 'Invoiced · excl. tax', value: '$2,000', href: '/sales-invoices' },
  { id: 'collected', label: 'Collected', value: '$1,000', href: '/incoming-payments' },
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
  state.unknownContract = false;
  needsState.isPending = false;
  needsState.isError = false;
  needsState.refetch.mockClear();
  projectsState.data = [];
  procurementsState.data = [];
  figureState.result = {
    today: defaultToday.map((figure) => figure.id === 'contract-on-hand' && state.unknownContract ? { ...figure, value: null } : figure),
    period: periodFigures,
    todayPending: false, todayError: false, periodPending: false, periodError: false,
    todayRetry: vi.fn(), periodRetry: vi.fn(),
    dashboard: { top_projects: [], projects_by_status: [{ status: 'Ongoing Project', count: 1 }], procurements_by_status: [], pipeline_projected_margin: 0.2, on_hand_actual_coverage_count: 1, on_hand_actual_coverage_total: 1 },
    dashboardPending: false, dashboardError: false, dashboardRetry: vi.fn(),
    pipeline: { projects: [], stages: [] }, pipelinePending: false, pipelineError: false, pipelineRetry: vi.fn(),
    winRateRange: { key: 'test-period', from: new Date(2026, 0, 1), to: new Date(2026, 9, 27) },
    orgCurrency: 'USD', currencyPending: false, organizationToday: '2026-10-27', organizationDayPending: false,
    isEmpty: false,
  };
});

describe('company area hub (#1403)', () => {
  it('AC-DASH-1403-01: Executive sees all four company work areas and six index figures', () => {
    renderPage();
    for (const area of ['Delivery', 'Sales', 'Billing and collections', 'Purchasing']) {
      expect(screen.getByRole('heading', { name: area })).toBeInTheDocument();
    }
    expect(screen.getByRole('region', { name: 'Company figures' })).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /Help:/ })).toHaveLength(6);
    const atRisk = screen.getByRole('link', { name: /projects at risk/i });
    expect(atRisk).toHaveAttribute('href', '/projects?filter=at-risk');
    expect(atRisk).toHaveTextContent('2');
    expect(screen.getByRole('link', { name: /work order still to invoice/i })).toHaveAttribute('href', '/projects');
    expect(screen.getAllByText(/Percent of billed work: —/)).toHaveLength(2);
  });

  it('AC-DASH-1403-02: a missing position value stays an explained dash with a working page link', () => {
    state.unknownContract = true;
    const current = figureState.result;
    if (current) current.today = defaultToday.map((figure) => figure.id === 'contract-on-hand' ? { ...figure, value: null } : figure);
    renderPage();
    const link = screen.getByRole('link', { name: 'Contract on hand' });
    expect(link).toHaveAttribute('href', '/projects');
    expect(screen.getByRole('button', { name: 'Contract amount is not available.' })).toHaveTextContent('—');
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
    if (current) (current.dashboard as Record<string, unknown>).top_projects = [{
      id: 'project-1', name: 'Project North', contract_value: 500, currency: 'USD', spent: 200,
      actual_complete: true, actual_currency: 'USD', status: 'Ongoing Project',
    }];
    projectsState.data = [{ id: 'project-1', pm: { full_name: 'Project Manager' } }];
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Open Project North' }));
    expect(screen.getByTestId('location')).toHaveTextContent('/projects/project-1');
  });

  it('AC-DASH-1403-04: Finance sees billing first and the two review tables', () => {
    state.role = 'Finance';
    renderPage();
    expect(screen.getAllByRole('heading', { name: 'Billing and collections' })[0]).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Ready to pay' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Budget review' })).toBeInTheDocument();
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
    expect(screen.getByRole('heading', { name: 'Delivery' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Sales' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Billing and collections' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Purchasing' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Ready to pay' })).not.toBeInTheDocument();
  });

  it('AC-DASH-1403-07: a failed attention query leaves the other company areas usable and offers retry', () => {
    needsState.isError = true;
    renderPage();
    expect(screen.getByText("Couldn't load approvals and attention items")).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Delivery' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Purchasing' })).toBeInTheDocument();
  });

  it('AC-DASH-1403-08: dashboard headings use the Bahasa catalogue', () => {
    renderBahasaPage();
    expect(screen.getByRole('heading', { name: 'Dasbor' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Pekerjaan' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Penjualan' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Penagihan dan penerimaan' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Pembelian' })).toBeInTheDocument();
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
