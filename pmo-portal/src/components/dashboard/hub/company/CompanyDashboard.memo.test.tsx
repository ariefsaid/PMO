/**
 * Render-work (perf) proof for the company dashboard's memo boundaries.
 *
 * The dashboard settles ~16 queries on load and React re-renders the page once per settle, so every
 * panel used to repaint five or six times showing data only one of them read. The panels are now
 * memoised on their own data. These tests drive the real page with stubbed data sources and change
 * ONE panel's data between renders: the panel must still show the new value (a memo that went stale
 * would keep the old one), while the unrelated panels are covered by the profiler, not by looks.
 */
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import i18next from 'i18next';
import { ToastProvider } from '@/src/components/ui/Toast';

const base = {
  active_projects: 2,
  active_delivery_projects: 2,
  risk_unchecked_projects: 0,
  total_contract_value: 8_000_000,
  on_hand_value: 8_000_000,
  on_hand_contract_remaining: 6_000_000,
  on_hand_realized_margin: 1_000_000,
  on_hand_realized_margin_by_currency: [{ currency: 'USD', known_amount: 1_000_000, known_billed_revenue: 8_000_000, unknown_projects: 0 }],
  on_hand_value_by_currency: [{ currency: 'USD', contract_value: 8_000_000, actual_known: 2_000_000, contract_remaining: 6_000_000, actual_coverage_count: 2, actual_coverage_total: 2, realized_margin_known: 1_000_000, unknown_projects: 0 }],
  on_hand_actual_coverage_count: 2,
  on_hand_actual_coverage_total: 2,
  pipeline_weighted_value: 800_000,
  pipeline_projected_margin: 0.2,
  pipeline_total_value: 2_000_000,
  projects_at_risk: 0,
  projects_by_status: [{ status: 'Ongoing Project', count: 2 }],
  procurements_by_status: [] as Array<{ status: string; count: number }>,
  top_projects: [] as Array<Record<string, unknown>>,
};

const h = vi.hoisted(() => ({
  dash: null as unknown,
  win: null as unknown,
  pack: { totals: [] as unknown[] },
  pipeline: null as unknown,
  procurements: [] as unknown[],
}));

const project = (overrides: Record<string, unknown>) => ({
  id: 'p1', name: 'Alpha Works', client_name: 'Acme', status: 'Ongoing Project',
  contract_value: 100_000, currency: 'USD', budget: 100_000, spent: 25_000,
  actual_currency: 'USD', actual_complete: true, budget_currency: 'USD',
  ...overrides,
});

vi.mock('@/src/hooks/useErpPurchases', () => ({ useErpPurchases: () => ({ data: [], isPending: false, isError: false }) }));
vi.mock('@/src/hooks/useWorkOrderBilling', () => ({
  useUnbilledWorkOrders: () => ({ data: { totals: [], incompleteCount: 0 }, isPending: false, isError: false, refetch: vi.fn() }),
}));
vi.mock('@/src/hooks/useOrgCurrency', () => ({
  useOrgCurrency: () => 'USD',
  useOrgCurrencyState: () => ({ currency: 'USD', isResolved: true, isError: false }),
}));
vi.mock('@/src/hooks/useFxOrgDay', () => ({ useFxOrgDay: () => ({ day: '2026-10-27', isPending: false, isError: false, retry: vi.fn() }) }));
vi.mock('@/src/hooks/useRevenue', () => ({
  useSalesInvoices: () => ({ data: [], isPending: false, isError: false, refetch: vi.fn() }),
  useOverdueInvoiceFacts: () => ({ data: [], isPending: false, isError: false, refetch: vi.fn() }),
  useIncomingPayments: () => ({ data: [], isPending: false, isError: false, refetch: vi.fn() }),
  usePaidPaymentFacts: () => ({ data: [], isPending: false, isError: false, refetch: vi.fn() }),
  // #1973's existence probes (empty-state evidence): answered, not loading, so the KPI band paints.
  useHasAnySalesInvoice: () => ({ data: false, isPending: false, isLoading: false, isError: false, refetch: vi.fn() }),
  useHasAnyIncomingPayment: () => ({ data: false, isPending: false, isLoading: false, isError: false, refetch: vi.fn() }),
}));
vi.mock('@/src/hooks/useInvoicesAwaitingViewer', () => ({
  useInvoicesAwaitingViewer: () => ({ rows: [], isPending: false, isError: false, refetch: vi.fn() }),
}));
vi.mock('@/src/hooks/useManagementPack', () => ({
  useManagementPack: () => ({ data: h.pack, isPending: false, isError: false, refetch: vi.fn() }),
}));
// The needs-you hook reads the same dashboard RPC directly; serve it the same fixture.
vi.mock('@/src/lib/db/dashboard', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/src/lib/db/dashboard')>()),
  getExecutiveDashboard: async () => h.dash,
}));
vi.mock('@/src/hooks/useDashboard', () => ({
  useDashboard: () => ({ data: h.dash, isPending: false, isError: false, refetch: vi.fn() }),
  usePMDashboardProjects: () => ({ data: [], isPending: false, isError: false, refetch: vi.fn() }),
  useFinanceBudgetReview: () => ({ data: [], isPending: false, isError: false, refetch: vi.fn() }),
  useSalesPipeline: () => ({ data: h.pipeline, isPending: false, isError: false, refetch: vi.fn() }),
  useWinRate: () => ({ data: h.win, isPending: false, isError: false, refetch: vi.fn() }),
  useLossBreakdown: () => ({ data: undefined, isPending: true, isError: false, refetch: vi.fn() }),
}));
vi.mock('@/src/hooks/useProcurements', () => ({ useProcurements: () => ({ data: h.procurements, isPending: false, isError: false, refetch: vi.fn() }) }));
vi.mock('@/src/hooks/useErpSnapshots', () => ({
  useActualsSnapshot: () => ({ data: [], isPending: false, isError: false, refetch: vi.fn() }),
  useApAgingSnapshot: () => ({ data: [], isPending: false, isError: false, refetch: vi.fn() }),
  useArAgingSnapshot: () => ({ data: [], isPending: false, isError: false, refetch: vi.fn() }),
}));
vi.mock('@/src/hooks/useProjects', () => ({ useProjectIdentity: () => ({ data: [] }), useProjects: () => ({ data: [], isPending: false, isError: false, refetch: vi.fn() }) }));
vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: { id: 'u1', org_id: 'org-1' }, role: 'Executive' }) }));
vi.mock('@/src/auth/impersonation', () => ({ useEffectiveRole: () => ({ effectiveRole: 'Executive', realRole: 'Executive' }) }));

import { CompanyDashboard } from './CompanyDashboard';

const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
const tree = () => (
  <QueryClientProvider client={client}>
    <MemoryRouter><ToastProvider><CompanyDashboard role="Executive" /></ToastProvider></MemoryRouter>
  </QueryClientProvider>
);

const panel = (name: RegExp) => {
  const heading = screen.getByRole('heading', { name });
  return heading.closest('.panel-card') as HTMLElement;
};
const figures = () => screen.getByRole('region', { name: /Company figures|Angka perusahaan/ });
/** The tile whose visible label is `label` (the value sits three levels up, as the honesty suite reads it). */
const tile = (label: string) => {
  const element = within(figures()).getByText(label, { exact: true }).parentElement?.parentElement?.parentElement;
  expect(element).toBeTruthy();
  return element as HTMLElement;
};

beforeEach(() => {
  h.dash = { ...base };
  h.win = null;
  h.pack = { totals: [] };
  h.pipeline = null;
  h.procurements = [];
});
afterEach(async () => { await act(async () => { await i18next.changeLanguage('en'); }); });

describe('company dashboard memoised panels still show changed data', () => {
  it('Delivery panel: spending-vs-contract rows follow the dashboard summary', () => {
    h.dash = { ...base, top_projects: [project({ spent: 25_000 })] };
    const view = render(tree());
    const delivery = () => panel(/^Delivery$/);
    expect(within(delivery()).getByText('25%')).toBeInTheDocument();

    h.dash = { ...base, top_projects: [project({ spent: 70_000 })] };
    view.rerender(tree());
    expect(within(delivery()).getByText('70%')).toBeInTheDocument();
  });

  it('Purchasing panel: stage counts follow the dashboard summary', () => {
    h.dash = { ...base, procurements_by_status: [{ status: 'Ordered', count: 2 }] };
    const view = render(tree());
    expect(within(panel(/^Purchasing$/)).getByRole('link', { name: 'Order: 2' })).toBeInTheDocument();

    h.dash = { ...base, procurements_by_status: [{ status: 'Ordered', count: 5 }, { status: 'Paid', count: 1 }] };
    view.rerender(tree());
    const purchasing = panel(/^Purchasing$/);
    expect(within(purchasing).getByRole('link', { name: 'Order: 5' })).toBeInTheDocument();
    expect(within(purchasing).getByRole('link', { name: 'Pay: 1' })).toBeInTheDocument();
  });

  it('Sales panel: pipeline stage rows and the won figure follow their own data', () => {
    h.pipeline = { stages: [{ status: 'Negotiation', count: 1, weighted_value: 0, total_value: 0 }], projects: [], weighted_total: 0, gross_total: 0 };
    h.win = { wins_count: 1, losses_count: 0, wins_value: 1_000, losses_value: 0, win_rate_count: 1, win_rate_value: 1, value_by_currency: [{ currency: 'USD', wins_value: 1_000, losses_value: 0 }] };
    const view = render(tree());
    const sales = () => panel(/^Sales$/);
    expect(within(sales()).getByRole('row', { name: /Negotiation\s+1/ })).toBeInTheDocument();
    expect(within(sales()).getByText(/^1 · /)).toBeInTheDocument();

    h.pipeline = { stages: [{ status: 'Negotiation', count: 3, weighted_value: 0, total_value: 0 }], projects: [], weighted_total: 0, gross_total: 0 };
    h.win = { wins_count: 2, losses_count: 0, wins_value: 2_000, losses_value: 0, win_rate_count: 1, win_rate_value: 1, value_by_currency: [{ currency: 'USD', wins_value: 2_000, losses_value: 0 }] };
    view.rerender(tree());
    expect(within(sales()).getByRole('row', { name: /Negotiation\s+3/ })).toBeInTheDocument();
    expect(within(sales()).getByText(/^2 · /)).toBeInTheDocument();
  });

  it('Billing panel: the invoiced figure follows the management pack', () => {
    h.pack = { totals: [{ currency: 'USD', months: [{ month: '2026-08-01', invoiced: 1_234_500 }] }] };
    const view = render(tree());
    const billing = () => panel(/^Billing and collections$/);
    expect(within(billing()).getByText('$12.3K')).toBeInTheDocument();

    h.pack = { totals: [{ currency: 'USD', months: [{ month: '2026-08-01', invoiced: 9_876_500 }] }] };
    view.rerender(tree());
    expect(within(billing()).getByText('$98.8K')).toBeInTheDocument();
  });

  it('Figures band: a contract-on-hand change from the dashboard summary repaints its tile', () => {
    const view = render(tree());
    expect(tile('Contract on hand')).toHaveTextContent('$8M');

    h.dash = { ...base, on_hand_value: 9_000_000, on_hand_value_by_currency: [{ currency: 'USD', contract_value: 9_000_000, actual_known: 3_000_000, contract_remaining: 6_000_000, actual_coverage_count: 2, actual_coverage_total: 2, realized_margin_known: 1_000_000, unknown_projects: 0 }] };
    view.rerender(tree());
    expect(tile('Contract on hand')).toHaveTextContent('$9M');
  });
});
