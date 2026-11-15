/** #1652: the hub's Still-to-invoice row (the live tile) names the oldest wait since acceptance. */
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import i18next from 'i18next';
import { ToastProvider } from '@/src/components/ui/Toast';
import idDashboard from '../../../../../public/locales/id/dashboard.json';

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
  pipeline_total_value_by_currency: [{ currency: 'USD', total_value: 2_000_000, weighted_value: 800_000, forecast_margin: 0.2, no_active_budget: 0 }],
  projects_at_risk: 0,
  projects_by_status: [{ status: 'Ongoing Project', count: 2 }],
  procurements_by_status: [],
  top_projects: [],
};
const h = vi.hoisted(() => ({ pipeline: null as unknown, budgetReviewHangs: false, dash: null as unknown, win: null as unknown, pack: null as unknown, loss: null as unknown, delivery: {} as Record<string, number>, projectsPending: false, invoices: [] as unknown[], workOrders: null as unknown }));

// Ready to pay / payables ageing read linked accounting documents (L12); none linked here.
vi.mock('@/src/hooks/useErpPurchases', () => ({ useErpPurchases: () => ({ data: [], isPending: false, isError: false }) }));
vi.mock('@/src/hooks/useWorkOrderBilling', () => ({
  useUnbilledWorkOrders: () => ({ data: h.workOrders, isPending: false, isError: false, refetch: vi.fn() }),
}));
vi.mock('@/src/hooks/useOrgCurrency', () => ({
  useOrgCurrency: () => 'USD',
  useOrgCurrencyState: () => ({ currency: 'USD', isResolved: true, isError: false }),
}));
vi.mock('@/src/hooks/useFxOrgDay', () => ({ useFxOrgDay: () => ({ day: '2026-10-27', isPending: false, isError: false, retry: vi.fn() }) }));
vi.mock('@/src/hooks/useRevenue', () => ({
  useSalesInvoices: () => ({ data: [], isPending: false, isError: false, refetch: vi.fn() }),
  useOverdueInvoiceFacts: () => ({ data: h.invoices, isPending: false, isError: false, refetch: vi.fn() }),
  useIncomingPayments: () => ({ data: [], isPending: false, isError: false, refetch: vi.fn() }),
  usePaidPaymentFacts: () => ({ data: [], isPending: false, isError: false, refetch: vi.fn() }),
  useHasAnySalesInvoice: () => ({ data: false, isPending: false, isError: false, refetch: vi.fn() }),
  useHasAnyIncomingPayment: () => ({ data: false, isPending: false, isError: false, refetch: vi.fn() }),
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
  // Never resolves when set: a slow read the finding line does not depend on.
  getFinanceBudgetReview: () => (h.budgetReviewHangs ? new Promise(() => {}) : Promise.resolve([])),
}));
vi.mock('@/src/hooks/useDashboard', () => ({
  useDashboard: () => ({ data: h.dash, isPending: false, isError: false, refetch: vi.fn() }),
  usePMDashboardProjects: () => ({ data: [], isPending: false, isError: false, refetch: vi.fn() }),
  useFinanceBudgetReview: () => ({ data: [], isPending: false, isError: false, refetch: vi.fn() }),
  useSalesPipeline: () => ({ data: h.pipeline, isPending: false, isError: false, refetch: vi.fn() }),
  useWinRate: () => ({ data: h.win, isPending: false, isError: false, refetch: vi.fn() }),
  useLossBreakdown: () => ({ data: h.loss, isPending: h.loss === null, isError: false, refetch: vi.fn() }),
}));
vi.mock('@/src/hooks/useProjectsDelivery', () => ({
  useProjectsDelivery: () => ({ data: h.delivery, isPending: false, isError: false, refetch: vi.fn() }),
}));
vi.mock('@/src/hooks/useProcurements', () => ({ useProcurements: () => ({ data: [], isPending: false, isError: false, refetch: vi.fn() }) }));
vi.mock('@/src/hooks/useErpSnapshots', () => ({
  useActualsSnapshot: () => ({ data: [], isPending: false, isError: false, refetch: vi.fn() }),
  useApAgingSnapshot: () => ({ data: [], isPending: false, isError: false, refetch: vi.fn() }),
  useArAgingSnapshot: () => ({ data: [], isPending: false, isError: false, refetch: vi.fn() }),
}));
vi.mock('@/src/hooks/useProjects', () => ({ useProjectIdentity: () => ({ data: [] }), useProjects: () => ({ data: h.projectsPending ? undefined : [], isPending: h.projectsPending, isError: false, refetch: vi.fn() }) }));
vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: { id: 'u1', org_id: 'org-1' }, role: 'Finance' }) }));
vi.mock('@/src/auth/impersonation', () => ({ useEffectiveRole: () => ({ effectiveRole: 'Finance', realRole: 'Finance' }) }));

// The rest of the "waits on you" sources are empty, so only the work-order row is under test.
vi.mock('@/src/lib/db/timesheetTransition', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/src/lib/db/timesheetTransition')>()),
  listTimesheetsAwaitingApproval: async () => [],
}));
vi.mock('@/src/lib/repositories', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/src/lib/repositories')>();
  return { ...actual, repositories: { ...actual.repositories, expenseClaim: { ...actual.repositories.expenseClaim, list: async () => ({ rows: [] }), routes: async () => [] } } };
});

import { CompanyDashboard } from './CompanyDashboard';

const row = (id: string, days: number | null) => ({ workOrderId: id, projectId: 'p1', daysSinceAcceptance: days, daysSinceClosed: null });
const renderFinance = () => render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <MemoryRouter><ToastProvider><CompanyDashboard role="Finance" /></ToastProvider></MemoryRouter>
  </QueryClientProvider>,
);
const stillToInvoiceRow = async () => (await screen.findByText(/work orders? still to invoice/)).closest('a, li, tr') as HTMLElement;

beforeEach(() => {
  h.dash = { ...base };
  h.pipeline = { stages: [], projects: [] };
  h.pack = { months: [], rows: [], totals: [] };
  h.projectsPending = false;
  h.invoices = [];
  localStorage.removeItem('home-layout');
});
afterEach(async () => { await act(async () => { await i18next.changeLanguage('en'); }); });

describe('hub Still-to-invoice row age (#1652)', () => {
  it('names the longest wait since acceptance among the work orders still to invoice', async () => {
    h.workOrders = { totals: [{ currency: 'USD', count: 3, remaining: 100 }], incompleteCount: 0, rows: [row('a', 12), row('b', 42), row('c', null)] };
    renderFinance();
    const el = await stillToInvoiceRow();
    expect(el).toHaveTextContent(/3\s*work orders still to invoice/);
    expect(el).toHaveTextContent('Oldest 42d since acceptance');
  });

  it('says it in Indonesian too', async () => {
    h.workOrders = { totals: [{ currency: 'USD', count: 1, remaining: 100 }], incompleteCount: 0, rows: [row('b', 42)] };
    i18next.addResourceBundle('id', 'dashboard', idDashboard, true, true);
    await act(async () => { await i18next.changeLanguage('id'); });
    renderFinance();
    const el = (await screen.findByText(/perintah kerja belum ditagihkan/)).closest('a, li, tr') as HTMLElement;
    expect(el).toHaveTextContent('Terlama 42 hari sejak BAST');
  });

  it('stays bare when no work order has an acceptance date', async () => {
    h.workOrders = { totals: [{ currency: 'USD', count: 1, remaining: 100 }], incompleteCount: 0, rows: [row('a', null)] };
    renderFinance();
    const el = await stillToInvoiceRow();
    expect(el).not.toHaveTextContent(/Oldest/);
  });
});
