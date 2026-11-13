/**
 * Loading gates (A1–A15): every region of the company home is drawn from its own read. One slow read never holds
 * the other regions' figures, and one failed read is said where it failed (never blank, never 0) while the others
 * still show theirs.
 */
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import { ToastProvider } from '@/src/components/ui/Toast';

const dash = {
  active_projects: 2, active_delivery_projects: 2, risk_unchecked_projects: 0,
  on_hand_value: 8_000_000, on_hand_contract_remaining: 6_000_000, on_hand_realized_margin: null,
  on_hand_realized_margin_by_currency: [],
  on_hand_value_by_currency: [{ currency: 'USD', contract_value: 8_000_000, actual_known: 2_000_000, contract_remaining: 6_000_000, actual_coverage_count: 2, actual_coverage_total: 2, realized_margin_known: null, unknown_projects: 0 }],
  on_hand_actual_coverage_count: 2, on_hand_actual_coverage_total: 2,
  pipeline_projected_margin: null, projects_at_risk: 0,
  projects_by_status: [{ status: 'Ongoing Project', count: 2 }], procurements_by_status: [], top_projects: [],
  attention_projects: [{ id: 'p1', name: 'River project', short_name: null, client_name: null, contract_value: 100, currency: 'USD', budget: 1_000, spent: 500, actual_complete: true, actual_currency: 'USD', budget_currency: 'USD', status: 'Ongoing Project', attention_signals: 0, overdue_items: 0, overdue_tasks: 0, overdue_milestones: 0, overdue_invoices: 0, waiting_approvals: 0, over_budget: false, budget_used_ratio: 0.5 }],
};
const month = `${new Date().getFullYear()}-01`;
const pack = { from: `${month}-01`, to: `${month}-01`, timezone: 'UTC', undatedInvoiceCount: 0, months: [`${month}-01`], rows: [], totals: [{ currency: 'USD', months: [{ month: `${month}-01`, invoiced: 120_000_000 }] }] };
const invoice = { id: 'i1', status: 'Unpaid', currency: 'USD', invoice_date: '2026-01-01', erp_due_date: '2026-01-31', received_date: null, erp_outstanding_amount: 40_000, erp_payment_terms_days: 30 };

type Read = { data: unknown; isPending: boolean; isError: boolean };
const ok = (data: unknown): Read => ({ data, isPending: false, isError: false });
const pending: Read = { data: undefined, isPending: true, isError: false };
const failed: Read = { data: undefined, isPending: false, isError: true };
const h = vi.hoisted(() => ({ reads: {} as Record<string, { data: unknown; isPending: boolean; isError: boolean }> }));
const read = (name: string) => ({ ...h.reads[name], isLoading: h.reads[name].isPending, refetch: vi.fn() });

vi.mock('@/src/hooks/useErpPurchases', () => ({ useErpPurchases: () => ({ data: [], isPending: false, isError: false }) }));
vi.mock('@/src/hooks/useWorkOrderBilling', () => ({ useUnbilledWorkOrders: () => ({ data: { totals: [], incompleteCount: 0 }, isPending: false, isError: false, refetch: vi.fn() }) }));
vi.mock('@/src/hooks/useOrgCurrency', () => ({ useOrgCurrency: () => 'USD', useOrgCurrencyState: () => ({ currency: 'USD', isResolved: true, isError: false }) }));
vi.mock('@/src/hooks/useFxOrgDay', () => ({ useFxOrgDay: () => ({ day: '2026-10-27', isPending: false, isError: false, retry: vi.fn() }) }));
vi.mock('@/src/hooks/useRevenue', () => ({
  useSalesInvoices: () => ({ data: [], isPending: false, isError: false, refetch: vi.fn() }),
  useIncomingPayments: () => ({ data: [], isPending: false, isError: false, refetch: vi.fn() }),
  useOverdueInvoiceFacts: () => read('invoices'),
  usePaidPaymentFacts: () => read('payments'),
  useHasAnySalesInvoice: () => ({ data: true, isPending: false, isLoading: false, isError: false, refetch: vi.fn() }),
  useHasAnyIncomingPayment: () => ({ data: true, isPending: false, isLoading: false, isError: false, refetch: vi.fn() }),
}));
vi.mock('@/src/hooks/useInvoicesAwaitingViewer', () => ({ useInvoicesAwaitingViewer: () => ({ rows: [], isPending: false, isError: false, refetch: vi.fn() }) }));
vi.mock('@/src/hooks/useManagementPack', () => ({ useManagementPack: () => read('pack') }));
vi.mock('@/src/lib/db/dashboard', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/src/lib/db/dashboard')>()), getExecutiveDashboard: async () => dash }));
vi.mock('@/src/hooks/useDashboard', () => ({
  useDashboard: () => read('dashboard'),
  usePMDashboardProjects: () => ({ data: [], isPending: false, isError: false, refetch: vi.fn() }),
  useFinanceBudgetReview: () => ({ data: [], isPending: false, isError: false, refetch: vi.fn() }),
  useSalesPipeline: () => ({ data: { stages: [], projects: [] }, isPending: false, isError: false, refetch: vi.fn() }),
  useWinRate: () => ({ data: null, isPending: false, isError: false, refetch: vi.fn() }),
  useLossBreakdown: () => ({ data: undefined, isPending: true, isError: false, refetch: vi.fn() }),
}));
vi.mock('@/src/hooks/useProjectsDelivery', () => ({ useProjectsDelivery: () => ({ data: {}, isPending: false, isError: false, refetch: vi.fn() }) }));
vi.mock('@/src/hooks/useProcurements', () => ({ useProcurements: () => read('procurements') }));
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
    <MemoryRouter><ToastProvider><CompanyDashboard role="Executive" /></ToastProvider></MemoryRouter>
  </QueryClientProvider>,
);
const band = () => screen.getByRole('region', { name: 'Company figures' });
const tile = (label: string) => within(band()).getByText(label, { exact: true }).closest('div[class*="flex-col"]') as HTMLElement;

beforeEach(() => {
  localStorage.setItem('home-layout', 'overview');
  h.reads = { dashboard: ok(dash), pack: ok(pack), invoices: ok([invoice]), payments: ok([]), procurements: ok([]) };
});

describe('company home loading gates: one read pending', () => {
  it('the management pack still loading holds only Invoiced and Left to bill; Contract on hand, Project health and Owed to us show', () => {
    h.reads.pack = pending;
    renderExec();
    expect(tile('Contract on hand')).toHaveTextContent('$8M');
    expect(within(tile('Invoiced')).getByTestId('kpi-skeleton')).toBeInTheDocument();
    expect(within(screen.getByTestId('project-health')).getByRole('link', { name: /River project/ })).toBeInTheDocument();
    expect(screen.getByTestId('owed-to-us')).toHaveTextContent('$40K');
  });

  it('client invoices still loading hold only Owed to us; the figures band and the supplier side show', () => {
    h.reads.invoices = pending;
    renderExec();
    expect(tile('Contract on hand')).toHaveTextContent('$8M');
    expect(tile('Invoiced')).toHaveTextContent('$1.2M');
    expect(within(screen.getByTestId('owed-to-us')).getAllByTestId('liststate-loading').length).toBeGreaterThan(0);
    expect(screen.getByTestId('owed-to-suppliers')).toHaveTextContent('No supplier invoice to pay');
  });

  it('the dashboard read still loading holds Contract on hand and Project health; Invoiced shows', () => {
    h.reads.dashboard = pending;
    renderExec();
    expect(within(tile('Contract on hand')).getByTestId('kpi-skeleton')).toBeInTheDocument();
    expect(tile('Invoiced')).toHaveTextContent('$1.2M');
  });
});

describe('company home loading gates: one read failed', () => {
  it('a failed management pack says so on Invoiced (never blank, never $0); the other figures show', () => {
    h.reads.pack = failed;
    renderExec();
    expect(tile('Invoiced')).toHaveTextContent("Couldn't load");
    expect(tile('Invoiced')).not.toHaveTextContent('$0');
    expect(tile('Contract on hand')).toHaveTextContent('$8M');
    expect(screen.getByTestId('owed-to-us')).toHaveTextContent('$40K');
  });

  it('a failed dashboard read says so on Contract on hand and in Project health; Invoiced and Owed to us show', () => {
    h.reads.dashboard = failed;
    renderExec();
    expect(tile('Contract on hand')).toHaveTextContent("Couldn't load");
    expect(within(screen.getByTestId('project-health')).getByText("Couldn't load projects")).toBeInTheDocument();
    expect(tile('Invoiced')).toHaveTextContent('$1.2M');
    expect(screen.getByTestId('owed-to-us')).toHaveTextContent('$40K');
  });

  it('failed client invoices say so in Owed to us; the figures band and the supplier side show', () => {
    h.reads.invoices = failed;
    renderExec();
    expect(screen.getByTestId('owed-to-us')).toHaveTextContent("Couldn't load client invoices");
    expect(tile('Contract on hand')).toHaveTextContent('$8M');
    expect(screen.getByTestId('owed-to-suppliers')).toHaveTextContent('No supplier invoice to pay');
  });
});
