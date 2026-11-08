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
  erp: [] as unknown[],
}));
const ok = (data: unknown) => ({ data, isPending: false, isError: false, refetch: vi.fn() });

// Ready to pay / payables ageing read linked accounting documents (L12); none linked here.
vi.mock('@/src/hooks/useErpPurchases', () => ({ useErpPurchases: () => ({ data: state.erp, isPending: false, isError: false }) }));
vi.mock('@/src/auth/impersonation', () => ({ useEffectiveRole: () => ({ effectiveRole: state.role, realRole: state.role }) }));
vi.mock('@/src/components/dashboard/restructure/useCompanyFigures', () => ({ useCompanyFigures: () => state.figures }));
vi.mock('@/src/components/dashboard/restructure/useNeedsYou', () => ({
  useNeedsYou: () => ({ items: [], areaItems: [], isPending: false, isError: false, refetch: vi.fn() }),
}));
vi.mock('@/src/hooks/useDashboard', () => ({
  useSalesPipeline: () => ok(state.pipeline),
  useFinanceBudgetReview: () => ok(state.budgetReview),
  useWinRate: () => ok(null),
  useLossBreakdown: () => ({ data: undefined, isPending: true, isError: false, refetch: vi.fn() }),
}));
vi.mock('@/src/hooks/useProcurements', () => ({ useProcurements: () => ok(state.procurements) }));
vi.mock('@/src/hooks/useProjects', () => ({ useProjects: () => ok([]) }));
vi.mock('@/src/hooks/useCompanies', () => ({ useCompanies: () => ok([]) }));
vi.mock('@/src/hooks/useCompanyCollections', () => ({
  useCompanyCollections: () => ({ customerLinks: new Map<string, string>() }),
}));
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

const desktopMatchMedia = window.matchMedia;

beforeEach(() => {
  state.erp = [];
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

describe('L12(a): Ready to pay uses the procurement record\'s unpaid balance', () => {
  it('L12: shows the supplier invoice less payments, never the order value, and says an unrecorded amount once', () => {
    state.procurements = [
      invoiced('p1', 'Inverter replacement, block B'),
      invoiced('p2', 'Surge protection', { procurement_invoices: [], total_value: 30_000 }),
    ];
    renderDashboard('Finance');
    const card = screen.getByRole('heading', { name: 'Ready to pay' }).closest('.panel-card') as HTMLElement;
    const row = within(card).getByText('Inverter replacement, block B').closest('tr') as HTMLElement;
    expect(row).toHaveTextContent('$62,000');
    expect(card).not.toHaveTextContent('$110,500');
    expect(card).not.toHaveTextContent('$30,000');
    // The invoice with no recorded amount has no figure; the reason is said once above the table.
    expect(within(card).getAllByText(/has no recorded amount yet/)).toHaveLength(1);
    expect(within(card).queryByText('—')).not.toBeInTheDocument();
  });

  it('L12(a): an invoice recorded only in the accounting system reads its linked document amount, as Payables does', () => {
    const procurement = invoiced('p3', 'Inverter replacement, block B', { procurement_invoices: [] });
    state.procurements = [procurement];
    state.ageing = { ...state.ageing, payables: [{ procurement, ageDays: 28, amount: null }] } as typeof state.ageing;
    state.erp = [{ id: 'e1', doctype: 'Purchase Invoice', name: 'ACC-PINV-1', procurementId: 'p3', grandTotal: 62_000, outstanding: 62_000, currency: 'USD', isReturn: false, projectIds: [] }];
    renderDashboard('Finance');
    const card = screen.getByRole('heading', { name: 'Ready to pay' }).closest('.panel-card') as HTMLElement;
    expect(within(card).getByText('Inverter replacement, block B').closest('tr')).toHaveTextContent('$62,000');
    expect(within(card).queryByText(/has no recorded amount yet/)).toBeNull();
  });

  it('L12: payments already made reduce the unpaid balance', () => {
    state.procurements = [invoiced('p1', 'Partly paid', { payments: [{ amount: 20_000, status: 'Paid' }] })];
    renderDashboard('Finance');
    const card = screen.getByRole('heading', { name: 'Ready to pay' }).closest('.panel-card') as HTMLElement;
    expect(card).toHaveTextContent('$42,000');
  });
});

describe('C4: unknown spending is left out and said once', () => {
  it('C4: Budget review leaves the Spent, % used and Variance cells empty when spending is unknown, and says so once', () => {
    state.budgetReview = [
      { id: 'k', name: 'Known', client_name: null, status: 'Ongoing Project', currency: 'USD', budget: 1_000, budget_currency: 'USD', spent: 500, variance: -500, actual_currency: 'USD', actual_complete: true, actual_coverage_count: 1, actual_coverage_total: 1, actual_as_of: null },
      { id: 'u', name: 'Unknown', client_name: null, status: 'Ongoing Project', currency: 'USD', budget: 2_000, budget_currency: 'USD', spent: null, variance: null, actual_currency: 'USD', actual_complete: false, actual_coverage_count: 0, actual_coverage_total: 1, actual_as_of: null },
    ];
    renderDashboard('Finance');
    const card = screen.getByRole('heading', { name: 'Budget review' }).closest('.panel-card') as HTMLElement;
    expect(within(card).queryByText('—')).not.toBeInTheDocument();
    expect(card).toHaveTextContent('1 has incomplete spending');
    expect(within(card).getByText('$500')).toBeInTheDocument();
  });
});

describe('#1739: the Budget review figure is labelled by what it adds up', () => {
  const row = (ledger_owned: boolean) => ({ id: 'k', name: 'Known', client_name: null, status: 'Ongoing Project', currency: 'USD', budget: 7_000, budget_currency: 'USD', spent: 6_300, variance: -700, actual_currency: 'USD', actual_complete: true, actual_coverage_count: 1, actual_coverage_total: 1, actual_as_of: null, ledger_owned });

  it('a PMO-basis org reads ordered..paid purchase totals, so the column says "Committed + spent", never "Spent"', () => {
    state.budgetReview = [row(false)];
    renderDashboard('Finance');
    const card = screen.getByRole('heading', { name: 'Budget review' }).closest('.panel-card') as HTMLElement;
    expect(within(card).getByRole('columnheader', { name: /Committed \+ spent/ })).toBeInTheDocument();
    expect(within(card).queryByRole('columnheader', { name: /^Spent$/ })).toBeNull();
  });

  it('an ERP-ledger org reads the ledger Actual, which stays "Spent"', () => {
    state.budgetReview = [row(true)];
    renderDashboard('Finance');
    const card = screen.getByRole('heading', { name: 'Budget review' }).closest('.panel-card') as HTMLElement;
    expect(within(card).getByRole('columnheader', { name: /^Spent$/ })).toBeInTheDocument();
    expect(within(card).queryByText(/Committed \+ spent/)).toBeNull();
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
    expect(screen.getByRole('region', { name: 'Supplier invoices by age · since invoiced status or last update' })).toBeInTheDocument();
    expect(screen.getAllByText(/From invoices recorded in PMO/)).toHaveLength(1);
  });

  it('L6: when only the supplier ageing is PMO-sourced, its note still shows', () => {
    state.ageing = { receivablesAgeing: {}, payablesAgeing: { USD: { d0_30: 70_00, d31_60: 0, d61_90: 0, over90: 0 } } };
    renderDashboard('Finance');
    expect(screen.getAllByText(/From invoices recorded in PMO/)).toHaveLength(1);
  });
});
