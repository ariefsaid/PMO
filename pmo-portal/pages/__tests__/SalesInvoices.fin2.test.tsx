import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import { ToastProvider } from '@/src/components/ui';
import { ImpersonationProvider } from '@/src/auth/impersonation';
import type { SalesInvoiceRow } from '@/src/lib/db/revenue';

/** FIN-S2: the invoice record page states each fact once and drops "nothing here" sentences. */
const h = vi.hoisted(() => ({
  invoice: null as unknown,
  evidence: { data: { lines: [] as unknown[] | null, contact: null as unknown }, isPending: false, isError: false, refetch: vi.fn() },
  payments: { data: [] as unknown[], isPending: false, isError: false },
}));

vi.mock('@/src/hooks/useRevenue', () => ({
  useSalesInvoices: () => ({ data: [h.invoice], isPending: false, isError: false, refetch: vi.fn() }),
  useSalesInvoiceEvidence: () => h.evidence,
  useIncomingPayments: () => h.payments,
  useAssignInvoiceProject: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useRevenueMutations: () => ({
    create: { mutateAsync: vi.fn(), isPending: false },
    setReceivedDate: { mutateAsync: vi.fn(), isPending: false },
    setEfaktur: { mutateAsync: vi.fn(), isPending: false },
    submitInvoice: { mutateAsync: vi.fn(), isPending: false },
    cancelInvoice: { mutateAsync: vi.fn(), isPending: false },
    pendingPush: { status: 'idle', lastError: null, lastPushAt: null },
  }),
}));
vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: { id: 'user-finance', org_id: 'org-1' }, role: 'Finance' }) }));
vi.mock('@/src/hooks/useFkOptions', () => ({
  useClientCompanyOptions: () => ({ data: [], isPending: false, isError: false, refetch: vi.fn() }),
  useInvoiceProjectOptions: () => ({ data: [{ value: 'project-1', label: 'Harbor Retrofit', clientId: 'cust-1', subjectToVat: false, taxRate: null, archived: false }], isPending: false, isError: false, refetch: vi.fn() }),
}));
vi.mock('@/src/hooks/useFxOrgDay', () => ({ useFxOrgDay: () => ({ day: '2026-10-18', isPending: false, isError: false, retry: vi.fn() }) }));
vi.mock('@/src/hooks/useRevenueMode', () => ({ useRevenueMode: () => 'erp' }));
vi.mock('@/src/hooks/useExternalDomainOwnership', () => ({ useExternalDomainOwnership: () => ({ data: [], isError: false }) }));
vi.mock('@/src/hooks/useInvoicePdfDownload', () => ({ useInvoicePdfDownload: () => ({ download: vi.fn(), inFlightIds: new Set<string>() }) }));
vi.mock('@/src/hooks/useTasks', () => ({ useAssignableProfiles: () => ({ data: [] }) }));
vi.mock('@/src/lib/adapterSeam/ownershipCache', () => ({ routeDomainWrite: vi.fn(() => 'pmo') }));
vi.mock('@/src/hooks/useOrgCurrency', () => ({
  useOrgCurrency: () => 'USD',
  useOrgCurrencyState: () => ({ currency: 'USD', isResolved: true, isError: false }),
}));
vi.mock('@/src/hooks/useFxRates', () => ({ useFxRate: () => ({ data: null, isPending: false, isError: false, refetch: vi.fn() }) }));
vi.mock('@/src/lib/analytics', () => ({ trackFilterApplied: vi.fn(), trackSearchUsed: vi.fn() }));

import SalesInvoices from '../SalesInvoices';

const invoice = (over: Partial<SalesInvoiceRow> = {}): SalesInvoiceRow => ({
  id: 'inv-1', org_id: 'org-1', project_id: 'project-1', customer_id: 'cust-1', customer_name: 'Northwind Services',
  si_number: 'INV-001', reference_number: 'PO-77', invoice_date: '2026-10-01', amount: 1000, currency: 'USD',
  tax_treatment: 'exclusive', tax_amount: 0, tax_rate: 0, tax_base_numerator: 1, tax_base_denominator: 1,
  erp_outstanding_amount: 400, status: 'Unpaid', erp_docstatus: 1, erp_modified: null, erp_amended_from: null,
  erp_cancelled_at: null, created_at: '2026-10-01T00:00:00Z', author_user_id: 'a', author_user_ids: ['a'],
  erp_payment_terms_days: 30, erp_due_date: null, received_date: null, ...over,
}) as SalesInvoiceRow;

const renderRecord = () => render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <ImpersonationProvider realRole="Finance">
      <MemoryRouter initialEntries={['/sales-invoices/inv-1']}>
        <ToastProvider>
          <Routes><Route path="/sales-invoices/:invoiceId" element={<SalesInvoices />} /></Routes>
        </ToastProvider>
      </MemoryRouter>
    </ImpersonationProvider>
  </QueryClientProvider>,
);

beforeEach(() => {
  h.invoice = invoice();
  h.evidence = { data: { lines: [], contact: null }, isPending: false, isError: false, refetch: vi.fn() };
  h.payments = { data: [], isPending: false, isError: false };
});

describe('FIN-S2: invoice record facts', () => {
  it('names the balance "Outstanding" once, not "Collection", and does not repeat the customer or the ERP line-items note', () => {
    renderRecord();
    expect(screen.getAllByText('Outstanding')).toHaveLength(1);
    expect(screen.queryByText('Collection')).not.toBeInTheDocument();
    expect(screen.getAllByText('Northwind Services')).toHaveLength(1);
    expect(screen.queryByText(/Line items are kept in ERPNext/)).not.toBeInTheDocument();
  });

  it('keeps project, customer PO, net, tax and total', () => {
    renderRecord();
    expect(screen.getByText('Harbor Retrofit')).toBeInTheDocument();
    expect(screen.getByText('PO-77')).toBeInTheDocument();
    for (const label of ['Net (before tax)', 'Tax', 'Total due']) expect(screen.getByText(label)).toBeInTheDocument();
  });

  it('gives the delivery help as one clause', () => {
    renderRecord();
    expect(screen.getByText('Download the PDF and send it to your client yourself.')).toBeInTheDocument();
    expect(screen.queryByText(/does not mean the invoice was sent/)).not.toBeInTheDocument();
  });
});

describe('FIN-S2: evidence shows only what exists', () => {
  it('renders none of the three "none returned" sentences or their empty headings', () => {
    renderRecord();
    expect(screen.queryByText(/No line details were returned/)).not.toBeInTheDocument();
    expect(screen.queryByText(/No billing contact details were returned/)).not.toBeInTheDocument();
    expect(screen.queryByText(/No applied receipts are recorded/)).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Billing contact' })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Applied receipts' })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Invoice lines' })).not.toBeInTheDocument();
  });

  it('shows the billing contact when one exists', () => {
    h.evidence.data = { lines: [], contact: { name: 'Dana Reyes', email: 'dana@example.test', phone: null } };
    renderRecord();
    expect(screen.getByRole('heading', { name: 'Billing contact' })).toBeInTheDocument();
    expect(screen.getByText('Dana Reyes')).toBeInTheDocument();
  });

  it('still says line details are unavailable when the source gave none (unknown is not empty)', () => {
    h.evidence.data = { lines: null, contact: null };
    renderRecord();
    expect(screen.getByText('Line details are not available.')).toBeInTheDocument();
  });

  it('shows applied receipts when allocations exist', () => {
    h.payments = {
      data: [{
        id: 'pay-1', ip_number: 'RCPT-1', reference_number: null, date: '2026-10-05', status: 'Received', currency: 'USD', amount: 600,
        erp_cancelled_at: null, cancelled_at: null, sales_invoice_id: null, pmo_native: false,
        allocation_details: [{ invoice_id: 'inv-1', invoice_number: 'INV-001', amount: '600.00', currency: 'USD' }],
      }],
      isPending: false, isError: false,
    };
    renderRecord();
    expect(screen.getByRole('heading', { name: 'Applied receipts' })).toBeInTheDocument();
    expect(screen.getByText('RCPT-1')).toBeInTheDocument();
  });

  it('says allocations are unreported when a receipt names this invoice without allocation details', () => {
    h.payments = {
      data: [{
        id: 'pay-1', ip_number: 'RCPT-1', reference_number: null, date: '2026-10-05', status: 'Received', currency: 'USD', amount: 600,
        erp_cancelled_at: null, cancelled_at: null, sales_invoice_id: 'inv-1', pmo_native: false, allocation_details: null,
      }],
      isPending: false, isError: false,
    };
    renderRecord();
    expect(screen.getByRole('heading', { name: 'Applied receipts' })).toBeInTheDocument();
    expect(screen.getByText('Receipt allocations have not all been reported.')).toBeInTheDocument();
  });
});
