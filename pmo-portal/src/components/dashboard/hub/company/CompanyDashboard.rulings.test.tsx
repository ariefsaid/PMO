/**
 * Integration rulings re-check (2026-10-28) on the company dashboard: L2 (phone pipeline), L6 (said once),
 * L12 (one unpaid source, four purchasing stages), C4 (unknown figures are left out, said once).
 * The data hooks are stubbed; everything a user reads is the real CompanyDashboard render.
 */
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { ToastProvider } from '@/src/components/ui/Toast';

const state = vi.hoisted(() => ({
  role: 'Finance',
  procurements: [] as unknown[],
  budgetReview: [] as unknown[],
  pipeline: { stages: [] as unknown[], projects: [] as unknown[] },
  ageing: { receivablesAgeing: {} as Record<string, unknown>, payablesAgeing: {} as Record<string, unknown> },
  figures: null as null | Record<string, unknown>,
}));
const ok = (data: unknown) => ({ data, isPending: false, isError: false, refetch: vi.fn() });

vi.mock('@/src/auth/impersonation', () => ({ useEffectiveRole: () => ({ effectiveRole: state.role, realRole: state.role }) }));
vi.mock('@/src/components/dashboard/restructure/useCompanyFigures', () => ({ useCompanyFigures: () => state.figures }));
vi.mock('@/src/components/dashboard/restructure/useNeedsYou', () => ({
  useNeedsYou: () => ({ items: [], areaItems: [], isPending: false, isError: false, refetch: vi.fn() }),
}));
vi.mock('@/src/hooks/useDashboard', () => ({
  useSalesPipeline: () => ok(state.pipeline),
  useFinanceBudgetReview: () => ok(state.budgetReview),
  useWinRate: () => ok(null),
}));
vi.mock('@/src/hooks/useProcurements', () => ({ useProcurements: () => ok(state.procurements) }));
vi.mock('@/src/hooks/useProjects', () => ({ useProjects: () => ok([]) }));
vi.mock('@/src/hooks/useErpSnapshots', () => ({
  useActualsSnapshot: () => ok([]),
  useApAgingSnapshot: () => ok([]),
  useArAgingSnapshot: () => ok([]),
}));
vi.mock('@/src/hooks/useFinancePosition', () => ({ useFinancePosition: () => ({ position: state.ageing, isPending: false, isError: false, retry: vi.fn() }) }));
vi.mock('@/src/hooks/useOrgCurrency', () => ({ useOrgCurrency: () => 'USD', useOrgCurrencyState: () => ({ currency: 'USD', isResolved: true }) }));
vi.mock('@/src/hooks/useFxOrgDay', () => ({ useFxOrgDay: () => ({ day: '2026-10-27', isPending: false, isError: false, retry: vi.fn() }) }));

import { CompanyDashboard } from './CompanyDashboard';

const figures = (dashboard: Record<string, unknown> = {}) => ({
  today: [], period: [],
  todayPending: false, todayError: false, periodPending: false, periodError: false,
  todayRetry: vi.fn(), periodRetry: vi.fn(),
  dashboard: { top_projects: [], projects_by_status: [{ status: 'Ongoing Project', count: 1 }], procurements_by_status: [], pipeline_projected_margin: null, on_hand_actual_coverage_count: 1, on_hand_actual_coverage_total: 1, ...dashboard },
  dashboardPending: false, dashboardError: false, dashboardRetry: vi.fn(),
  pipeline: { projects: [], stages: [] }, pipelinePending: false, pipelineError: false, pipelineRetry: vi.fn(),
  winRateRange: { key: 'test-period', from: new Date(2026, 0, 1), to: new Date(2026, 9, 27) },
  orgCurrency: 'USD', currencyPending: false, organizationToday: '2026-10-27', organizationDayPending: false,
  isEmpty: false,
});

const renderDashboard = (role: 'Executive' | 'Admin' | 'Finance' = 'Finance') => {
  state.role = role;
  return render(<MemoryRouter><ToastProvider><CompanyDashboard role={role} /></ToastProvider></MemoryRouter>);
};

const mobile = () => {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: !query.includes('min-width'), media: query, onchange: null,
    addEventListener: vi.fn(), removeEventListener: vi.fn(), addListener: vi.fn(), removeListener: vi.fn(), dispatchEvent: vi.fn(),
  })) as unknown as typeof window.matchMedia;
};
const desktopMatchMedia = window.matchMedia;

beforeEach(() => {
  window.matchMedia = desktopMatchMedia;
  state.procurements = [];
  state.budgetReview = [];
  state.pipeline = { stages: [], projects: [] };
  state.ageing = { receivablesAgeing: {}, payablesAgeing: {} };
  state.figures = figures();
});

const invoiced = (id: string, title: string, over: Record<string, unknown> = {}) => ({
  id, title, status: 'Vendor Invoiced', currency: 'USD', total_value: 110_500, vendor_invoiced_at: '2026-09-30', updated_at: '2026-09-30',
  project: { name: 'Meridian' }, vendor: { name: 'SunVolt' },
  purchase_requests: [], purchase_orders: [], payments: [], erpDocuments: [],
  procurement_invoices: [{ amount: 62_000, erp_outstanding_amount: null }],
  ...over,
});

describe('L2(a): the phone pipeline is one line per stage', () => {
  it('L2: a stage reads "Leads · 1 · $1,800,000" on one line, not stacked Count / Gross pairs', () => {
    mobile();
    state.pipeline = { stages: [{ status: 'Leads', count: 1 }, { status: 'Tender Submitted', count: 4 }], projects: [
      { status: 'Leads', currency: 'USD', contract_value: 1_800_000 },
      { status: 'Tender Submitted', currency: 'USD', contract_value: 6_050_000 },
    ] };
    renderDashboard('Admin');
    const list = screen.getByRole('list', { name: 'Pipeline by stage' });
    const items = within(list).getAllByRole('listitem');
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveTextContent(/^Leads\s*·\s*1\s*·\s*\$1,800,000$/);
    expect(items[1]).toHaveTextContent(/^Tender Submitted\s*·\s*4\s*·\s*\$6,050,000$/);
    expect(within(list).queryByText('Count')).not.toBeInTheDocument();
    expect(within(list).queryByText('Gross')).not.toBeInTheDocument();
  });
});

describe('L12(a): Ready to pay uses the procurement record\'s unpaid balance', () => {
  it('L12: shows the supplier invoice less payments, never the order value, and says an unrecorded amount once', () => {
    state.procurements = [
      invoiced('p1', 'Inverter replacement, block B'),
      invoiced('p2', 'Surge protection', { procurement_invoices: [], total_value: 30_000 }),
    ];
    renderDashboard('Finance');
    const card = screen.getByRole('heading', { name: 'Ready to pay' }).closest('.rounded-lg.border') as HTMLElement;
    const row = within(card).getByText('Inverter replacement, block B').closest('tr') as HTMLElement;
    expect(row).toHaveTextContent('$62,000');
    expect(card).not.toHaveTextContent('$110,500');
    expect(card).not.toHaveTextContent('$30,000');
    // The invoice with no recorded amount has no figure; the reason is said once above the table.
    expect(within(card).getAllByText(/has no recorded amount yet/)).toHaveLength(1);
    expect(within(card).queryByText('—')).not.toBeInTheDocument();
  });

  it('L12: payments already made reduce the unpaid balance', () => {
    state.procurements = [invoiced('p1', 'Partly paid', { payments: [{ amount: 20_000, status: 'Paid' }] })];
    renderDashboard('Finance');
    const card = screen.getByRole('heading', { name: 'Ready to pay' }).closest('.rounded-lg.border') as HTMLElement;
    expect(card).toHaveTextContent('$42,000');
  });
});

describe('L12(g): purchasing by stage uses Request · Order · Receive · Pay', () => {
  it('L12: eight raw statuses fold into the four stages with the stage drill-down links', () => {
    (state.figures!.dashboard as Record<string, unknown>).procurements_by_status = [
      { status: 'Draft', count: 4 }, { status: 'Requested', count: 3 }, { status: 'Approved', count: 2 },
      { status: 'Ordered', count: 3 }, { status: 'Received', count: 1 }, { status: 'Vendor Invoiced', count: 7 }, { status: 'Paid', count: 5 },
    ];
    renderDashboard('Executive');
    const panel = screen.getByRole('heading', { name: 'Purchasing' }).closest('.rounded-lg.border') as HTMLElement;
    const links = within(panel).getAllByRole('link', { name: /: \d+$/ });
    expect(links.map((link) => link.getAttribute('aria-label'))).toEqual(['Request: 9', 'Order: 3', 'Receive: 1', 'Pay: 12']);
    expect(links.map((link) => link.getAttribute('href'))).toEqual(['/procurement?stage=request', '/procurement?stage=order', '/procurement?stage=receive', '/procurement?stage=pay']);
    expect(within(panel).queryByText(/Purchase Request|Goods Receipt|Supplier invoiced/)).not.toBeInTheDocument();
  });
});

describe('C4: unknown spending is left out and said once', () => {
  const rows = [
    { id: 'a', name: 'Known', contract_value: 1_000, currency: 'USD', spent: 920, actual_complete: true, actual_currency: 'USD', status: 'Ongoing Project' },
    { id: 'b', name: 'Unknown B', contract_value: 800, currency: 'USD', spent: null, actual_complete: false, actual_currency: 'USD', status: 'Ongoing Project' },
    { id: 'c', name: 'Unknown C', contract_value: 700, currency: 'USD', spent: null, actual_complete: false, actual_currency: 'USD', status: 'Ongoing Project' },
  ];

  it('C4: no "Spent —" line per project; one note above the list names how many have incomplete spending', () => {
    (state.figures!.dashboard as Record<string, unknown>).top_projects = rows;
    renderDashboard('Admin');
    const list = screen.getByRole('list', { name: 'Spending vs contract' });
    expect(within(list).queryByText(/Spent/)).not.toBeInTheDocument();
    expect(within(list).queryByText('—')).not.toBeInTheDocument();
    expect(within(list).getAllByRole('progressbar')).toHaveLength(1);
    expect(screen.getAllByText('2 projects have incomplete spending')).toHaveLength(1);
  });

  it('C4: Budget review leaves the Spent, % used and Variance cells empty when spending is unknown, and says so once', () => {
    state.budgetReview = [
      { id: 'k', name: 'Known', client_name: null, status: 'Ongoing Project', currency: 'USD', budget: 1_000, budget_currency: 'USD', spent: 500, variance: -500, actual_currency: 'USD', actual_complete: true, actual_coverage_count: 1, actual_coverage_total: 1, actual_as_of: null },
      { id: 'u', name: 'Unknown', client_name: null, status: 'Ongoing Project', currency: 'USD', budget: 2_000, budget_currency: 'USD', spent: null, variance: null, actual_currency: 'USD', actual_complete: false, actual_coverage_count: 0, actual_coverage_total: 1, actual_as_of: null },
    ];
    renderDashboard('Finance');
    const card = screen.getByRole('heading', { name: 'Budget review' }).closest('.rounded-lg.border') as HTMLElement;
    expect(within(card).queryByText('—')).not.toBeInTheDocument();
    expect(card).toHaveTextContent('1 has incomplete spending');
    expect(within(card).getByText('$500')).toBeInTheDocument();
  });
});

describe('L6: the ageing source note is said once', () => {
  it('L6: with PMO standing in for both client and supplier ageing, "From invoices recorded in PMO" shows once', () => {
    state.ageing = {
      receivablesAgeing: { USD: { notDue: 100_00, d1_30: 0, d31_60: 0, d61_90: 0, over90: 0 } },
      payablesAgeing: { USD: { d0_30: 70_00, d31_60: 0, d61_90: 0, over90: 0 } },
    };
    renderDashboard('Finance');
    expect(screen.getByRole('region', { name: 'Client balances by age · tax included' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Supplier invoices by age · since invoice date' })).toBeInTheDocument();
    expect(screen.getAllByText(/From invoices recorded in PMO/)).toHaveLength(1);
  });

  it('L6: when only the supplier ageing is PMO-sourced, its note still shows', () => {
    state.ageing = { receivablesAgeing: {}, payablesAgeing: { USD: { d0_30: 70_00, d31_60: 0, d61_90: 0, over90: 0 } } };
    renderDashboard('Finance');
    expect(screen.getAllByText(/From invoices recorded in PMO/)).toHaveLength(1);
  });
});
