import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import type { IncomingPaymentRow, SalesInvoiceRow } from '@/src/lib/db/revenue';
import ReceivablesPage from '../finance/ReceivablesPage';

/**
 * The two list bodies are memoised so a KPI-query settle no longer re-renders them. These tests drive
 * the REAL react-query cache underneath them (only the repository seam is stubbed) and change the
 * list data the way a real refetch would: the memo boundary must not freeze what the user sees.
 */
const state = vi.hoisted(() => ({
  invoices: [] as SalesInvoiceRow[],
  payments: [] as IncomingPaymentRow[],
}));

vi.mock('@/src/lib/repositories', () => ({
  repositories: {
    revenue: {
      listInvoices: async () => state.invoices,
      listPayments: async () => state.payments,
    },
  },
}));
vi.mock('@/src/auth/useAuth', () => ({
  useAuth: () => ({ currentUser: { id: 'finance-1', org_id: 'org-1' }, role: 'Finance' }),
}));
vi.mock('@/src/auth/usePermission', () => ({
  usePermission: () => (action: string) => action === 'view',
}));
vi.mock('@/src/auth/useIsOperator', () => ({ useIsOperator: () => false }));
vi.mock('@/src/auth/impersonation', () => ({
  useEffectiveRole: () => ({ effectiveRole: 'Finance', realRole: 'Finance' }),
  useOptionalRealRole: () => 'Finance',
}));
vi.mock('@/src/hooks/useFinancePosition', () => ({
  useFinancePosition: () => ({
    position: {
      receivablesCount: 0, receivablesUnknownCount: 0,
      overdue: [], overdueTotals: {}, overdueUnknownCount: 0,
      drafts: { canApprove: [], awaitingOther: [], all: [] }, toSend: [],
      unappliedPayments: [], unappliedTotals: {},
      payables: [], payablesTotals: {}, payablesUnknownCount: 0,
      receivablesAgeing: {}, payablesAgeing: {},
    },
    today: '2026-10-28',
    isPending: false,
    isError: false,
    retry: () => {},
  }),
}));
vi.mock('@/src/hooks/useOrgCurrency', () => ({
  useOrgCurrency: () => 'IDR',
  useOrgCurrencyState: () => ({ currency: 'IDR', isResolved: true, isError: false }),
}));
vi.mock('@/src/hooks/useOrgFeatures', () => ({ useOrgFeatures: () => ({ data: { revenue: true } }) }));
vi.mock('@/src/hooks/useRevenueMode', () => ({ useRevenueMode: () => 'native' }));
vi.mock('@/src/hooks/useUserViews', () => ({ useUserViews: () => ({ data: [] }) }));
vi.mock('@/src/hooks/useErpItemOptions', () => ({ useErpItemOptions: () => ({ connected: false, loadOptions: async () => [] }) }));
vi.mock('@/src/hooks/useFkOptions', () => ({
  useClientCompanyOptions: () => ({ data: [] }),
  useInvoiceProjectOptions: () => ({ data: [], isPending: false, refetch: vi.fn(async () => ({ data: [], error: null })) }),
}));
vi.mock('@/src/hooks/useProjects', () => ({ useProjects: () => ({ data: [], isPending: false }) }));
vi.mock('@/src/hooks/useTasks', () => ({ useAssignableProfiles: () => ({ data: [], isPending: false }) }));
vi.mock('@/src/hooks/useInvoicePdfDownload', () => ({ useInvoicePdfDownload: () => ({ download: vi.fn(), inFlightIds: new Set<string>() }) }));
vi.mock('@/src/hooks/useExternalDomainOwnership', () => ({ useExternalDomainOwnership: () => ({ data: [], isError: false }) }));
vi.mock('@/src/hooks/useOdooPurchase', () => ({ useOdooUnreachable: () => ({ unreachable: false }) }));
vi.mock('@/src/lib/adapterSeam/ownershipCache', () => ({ routeDomainWrite: vi.fn(() => 'pmo') }));
vi.mock('@/src/components/ui', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/src/components/ui')>();
  return { ...actual, useToast: () => ({ toast: vi.fn() }) };
});

const invoice = (over: Partial<SalesInvoiceRow> = {}): SalesInvoiceRow => ({
  id: 'invoice-1', org_id: 'org-1', project_id: null, erp_project: null, billing_kind: 'contract',
  customer_id: 'client-1', customer_name: 'Northwind', si_number: 'SI-AAA', reference_number: null,
  invoice_date: '2026-10-22', amount: 100, currency: 'IDR', tax_treatment: 'inclusive', tax_amount: 0,
  erp_outstanding_amount: 100, status: 'Unpaid', erp_docstatus: 1, erp_modified: null,
  erp_amended_from: null, erp_cancelled_at: null, created_at: '2026-10-22T00:00:00Z',
  author_user_id: 'author-1', author_user_ids: ['author-1'], erp_payment_terms_days: 14,
  erp_due_date: null, received_date: null, efaktur_number: null, efaktur_date: null, ...over,
});

const payment = (over: Partial<IncomingPaymentRow> = {}): IncomingPaymentRow => ({
  id: 'payment-1', org_id: 'org-1', customer_id: 'client-1', customer_name: 'Northwind',
  sales_invoice_id: null, ip_number: 'IP-AAA', reference_number: null, date: '2026-10-05',
  amount: 150, currency: 'IDR', received_amount: 100, withheld_amount: 50,
  withholding_slip_number: null, allocation_details: [], status: 'Paid', erp_docstatus: 1,
  erp_modified: null, erp_amended_from: null, erp_cancelled_at: null, created_at: '2026-10-05T00:00:00Z',
  ...over,
});

function renderPage(client: QueryClient, entry = '/finance/receivables') {
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[entry]}>
        <Routes><Route path="/finance/receivables" element={<ReceivablesPage />} /></Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function newClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

describe('Receivables embedded lists', () => {
  it('the memoised invoice list still shows freshly fetched invoice data', async () => {
    state.invoices = [invoice()];
    state.payments = [];
    const client = newClient();
    renderPage(client);

    expect(await screen.findByText('SI-AAA')).toBeInTheDocument();

    // A refetch lands different rows: the child's own query subscription must re-render it.
    const next = [invoice({ id: 'invoice-2', si_number: 'SI-BBB', amount: 200, erp_outstanding_amount: 200 })];
    state.invoices = next;
    await client.refetchQueries({ queryKey: ['salesInvoices', 'org-1', 'all'] });

    expect(await screen.findByText('SI-BBB')).toBeInTheDocument();
    expect(screen.queryByText('SI-AAA')).not.toBeInTheDocument();
  });

  it('the memoised payments list still shows freshly fetched receipt data', async () => {
    state.invoices = [];
    state.payments = [payment()];
    const client = newClient();
    renderPage(client, '/finance/receivables?view=payments');

    expect(await screen.findByText('IP-AAA')).toBeInTheDocument();

    state.payments = [payment({ id: 'payment-2', ip_number: 'IP-BBB' })];
    await client.refetchQueries({ queryKey: ['incomingPayments', 'org-1', 'all', 'all-invoices'] });

    expect(await screen.findByText('IP-BBB')).toBeInTheDocument();
    expect(screen.queryByText('IP-AAA')).not.toBeInTheDocument();
  });
});
