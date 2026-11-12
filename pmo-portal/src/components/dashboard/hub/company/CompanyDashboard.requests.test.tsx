/**
 * PERF-FIN-1: the Company Dashboard reads the org's procurements once, whichever hook asks (finance position,
 * company figures, needs-you), and still renders its figures.
 */
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor, within } from '@testing-library/react';
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
  procurements_by_status: [],
  top_projects: [],
};
// One contract-less month of the pack: the period figures read it, so "Billed work in period $0" is a known zero from
// real pack data rather than the home-currency zero the shared formatter no longer invents (80f05c77f).
const pack = {
  from: '2026-01-01', to: '2026-10-31', timezone: 'UTC', undatedInvoiceCount: 0,
  months: ['2026-10'],
  rows: [],
  totals: [{ currency: 'USD', months: [{ month: '2026-10', planned: 0, recognised: 0, invoiced: 0, invoiceCount: 0, recognisedToDate: 0, invoicedToDate: 0, invoiceCountToDate: 0, unbilled: 0, backlog: 0 }] }],
};
const h = vi.hoisted(() => ({ dash: null as unknown, win: null as unknown, pack: { months: [] as string[], rows: [] as unknown[], totals: [] as unknown[] }, procurementList: vi.fn() }));

// Ready to pay / payables ageing read linked accounting documents (L12); none linked here.
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
  useIncomingPayments: () => ({ data: [], isPending: false, isError: false, refetch: vi.fn() }),
  useOverdueInvoiceFacts: () => ({ data: [], isPending: false, isError: false, refetch: vi.fn() }),
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
}));
vi.mock('@/src/hooks/useDashboard', () => ({
  useDashboard: () => ({ data: h.dash, isPending: false, isError: false, refetch: vi.fn() }),
  usePMDashboardProjects: () => ({ data: [], isPending: false, isError: false, refetch: vi.fn() }),
  useFinanceBudgetReview: () => ({ data: [], isPending: false, isError: false, refetch: vi.fn() }),
  useSalesPipeline: () => ({ data: null, isPending: false, isError: false, refetch: vi.fn() }),
  useWinRate: () => ({ data: h.win, isPending: false, isError: false, refetch: vi.fn() }),
  useLossBreakdown: () => ({ data: undefined, isPending: true, isError: false, refetch: vi.fn() }),
}));
// Only the repository seam is stubbed: the real useProcurements / useFinancePosition run, so the cache-key sharing is what is under test.
vi.mock('@/src/lib/repositories', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/src/lib/repositories')>();
  return { ...actual, repositories: { ...actual.repositories, procurement: { ...actual.repositories.procurement, list: h.procurementList } } };
});
vi.mock('@/src/hooks/useErpSnapshots', () => ({
  useActualsSnapshot: () => ({ data: [], isPending: false, isError: false, refetch: vi.fn() }),
  useApAgingSnapshot: () => ({ data: [], isPending: false, isError: false, refetch: vi.fn() }),
  useArAgingSnapshot: () => ({ data: [], isPending: false, isError: false, refetch: vi.fn() }),
}));
vi.mock('@/src/hooks/useProjects', () => ({ useProjectIdentity: () => ({ data: [] }), useProjects: () => ({ data: [], isPending: false, isError: false, refetch: vi.fn() }) }));
vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: { id: 'u1', org_id: 'org-1' }, role: 'Executive' }) }));
vi.mock('@/src/auth/impersonation', () => ({ useEffectiveRole: () => ({ effectiveRole: 'Executive', realRole: 'Executive' }) }));

import { CompanyDashboard } from './CompanyDashboard';

const renderExec = () => render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <MemoryRouter><ToastProvider><CompanyDashboard role="Finance" /></ToastProvider></MemoryRouter>
  </QueryClientProvider>,
);

beforeEach(() => { h.dash = { ...base }; h.win = null; h.pack = pack; h.procurementList.mockReset().mockResolvedValue([]); });
afterEach(async () => { await act(async () => { await i18next.changeLanguage('en'); }); });

describe('company dashboard procurement reads (PERF-FIN-1)', () => {
  it('fetches the org procurement list once, routed, and renders the company figures', async () => {
    renderExec();
    const figures = await screen.findByRole('region', { name: /Company figures|Angka perusahaan/ });
    const label = await within(figures).findByText('Billed work in period', { exact: true });
    expect(label.parentElement?.parentElement?.parentElement).toHaveTextContent('$0');
    await waitFor(() => expect(h.procurementList).toHaveBeenCalled());
    await act(async () => { await new Promise((r) => setTimeout(r, 50)); });
        expect(h.procurementList).toHaveBeenCalledTimes(1);
    expect(h.procurementList).toHaveBeenCalledWith({ lean: true });
  });
});

describe('company dashboard layout stability (CLS) and loading gates', () => {
  it('while the procurement list loads, the figures band shows its figures, the supplier side holds a loading state and the approvals line keeps its loaded height', () => {
    h.procurementList.mockReset().mockReturnValue(new Promise(() => {}));
    renderExec();
    const band = screen.getByRole('region', { name: 'Company figures' });
    expect(within(band).queryAllByTestId('kpi-skeleton')).toHaveLength(0);
    expect(within(screen.getByTestId('owed-to-suppliers')).getAllByTestId('liststate-loading').length).toBeGreaterThan(0);
    const approvals = within(screen.getByTestId('waits-on-you')).getAllByTestId('liststate-loading')[0];
    expect(approvals.className).toMatch(/\bh-11\b/);
  });
});
