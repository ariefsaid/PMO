import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { QueryClient, QueryClientProvider, focusManager } from '@tanstack/react-query';
import { ToastProvider } from '@/src/components/ui';
import { ImpersonationProvider } from '@/src/auth/impersonation';
import type { SalesInvoiceRow } from '@/src/lib/db/revenue';

const h = vi.hoisted(() => ({
  revenueMode: 'native' as 'native' | 'erp',
  getInvoice: vi.fn(),
  refetch: vi.fn(),
  submitInvoice: vi.fn(),
  evidence: {
    data: { lines: [{ item_code: 'SVC', description: 'Inspection work', qty: 2, rate: 125, amount: 250 }], contact: { name: 'Billing Desk', email: 'billing@example.test', phone: '+62-TEST-000' } },
    isPending: false, isError: false, refetch: vi.fn(),
  },
  pdfDownload: { download: vi.fn(), inFlightIds: new Set<string>() },
}));

const invoice = {
  id: 'inv-1', org_id: 'org-1', project_id: 'project-1', erp_project: null,
  customer_id: 'cust-1', customer_name: 'Acme Energy', si_number: 'ACC-SINV-2026-00001', reference_number: 'PO-12345',
  invoice_date: '2026-07-01', amount: 10000, currency: 'USD', tax_treatment: 'inclusive', tax_amount: 0,
  erp_outstanding_amount: 5000, status: 'Unpaid' as const, erp_docstatus: 1, erp_modified: null, erp_amended_from: null,
  erp_cancelled_at: null, created_at: '2026-07-01T00:00:00Z', author_user_id: 'u-author', author_user_ids: ['u-author'],
  billing_kind: 'contract' as const, erp_payment_terms_days: 30, erp_due_date: null, received_date: null,
  pmo_native: false, efaktur_number: null, efaktur_date: null,
} as SalesInvoiceRow;
const invoiceState = { data: [invoice] as SalesInvoiceRow[], isPending: false, isError: false, refetch: h.refetch };
const incomingPaymentsState = { data: [], isPending: false, isError: false };

vi.mock('@/src/hooks/useRevenue', () => ({
  useSalesInvoiceEvidence: () => h.evidence,
  useInvoiceEvidence: () => h.evidence,
  useIncomingPayments: () => incomingPaymentsState,
  useAssignInvoiceProject: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useSalesInvoices: () => invoiceState,
  useRevenueMutations: () => ({
    setReceivedDate: { mutateAsync: vi.fn(), isPending: false },
    setEfaktur: { mutateAsync: vi.fn(), isPending: false },
    create: { mutateAsync: vi.fn(), isPending: false },
    submitInvoice: { mutateAsync: h.submitInvoice, isPending: false },
    cancelInvoice: { mutateAsync: vi.fn(), isPending: false },
    pendingPush: { status: 'idle', lastError: null, lastPushAt: null },
  }),
}));
vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: { id: 'u-pm', org_id: 'org-1' }, role: 'Project Manager' }) }));
vi.mock('@/src/lib/repositories', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/src/lib/repositories')>();
  return { ...actual, repositories: { ...actual.repositories, revenue: { ...actual.repositories.revenue, getInvoice: h.getInvoice } } };
});
vi.mock('@/src/hooks/useExternalDomainOwnership', () => ({ useExternalDomainOwnership: () => ({ data: [], isError: false }) }));
vi.mock('@/src/hooks/useOdooPurchase', async (orig) => ({ ...(await orig<Record<string, unknown>>()), useOdooUnreachable: () => ({ unreachable: false, lastOkAt: null }) }));
vi.mock('@/src/hooks/useOdooRevenue', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  useOdooRevenueCommandsForInvoices: () => ({ data: [] }),
  useOdooRevenueCommands: () => ({ data: [] }),
  useOdooRevenueCreditNotes: () => ({ data: [] }),
}));
vi.mock('@/src/hooks/useRevenueMode', () => ({ useRevenueMode: () => h.revenueMode }));
vi.mock('@/src/hooks/useFxOrgDay', () => ({ useFxOrgDay: () => ({ day: '2026-10-16', isPending: false, isError: false, retry: vi.fn() }) }));
vi.mock('@/src/hooks/useOrgCurrency', () => ({ useOrgCurrency: () => 'USD', useOrgCurrencyState: () => ({ currency: 'USD', isResolved: true, isError: false }) }));
vi.mock('@/src/hooks/useFkOptions', () => ({
  useInvoiceProjectOptions: () => ({ data: [{ value: 'project-1', label: 'Northwind Build', contractualName: 'Northwind Build', sub: 'NW-1', clientId: 'cust-1', subjectToVat: false, taxRate: null, archived: false, customerContractRef: null }], isPending: false, isError: false, refetch: vi.fn() }),
  useClientCompanyOptions: () => ({ data: [], isPending: false, isError: false, refetch: vi.fn() }),
}));
vi.mock('@/src/hooks/useTasks', () => ({ useAssignableProfiles: () => ({ data: [] }) }));
vi.mock('@/src/hooks/useProjects', () => ({ useProjects: () => ({ data: [], isPending: false }) }));
vi.mock('@/pages/approvals/SalesInvoiceApprovalRow', () => ({ SalesInvoiceApprovalPreview: () => <div>Invoice preview</div> }));
vi.mock('@/src/hooks/useInvoicePdfDownload', () => ({ useInvoicePdfDownload: () => h.pdfDownload }));
vi.mock('@/src/lib/analytics', () => ({ trackFilterApplied: vi.fn(), trackSearchUsed: vi.fn() }));

import SalesInvoices from '../SalesInvoices';

const Location = () => {
  const location = useLocation();
  return <output data-testid="location">{location.pathname}{location.search}</output>;
};
const renderTree = (url: string) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })}>
    <ImpersonationProvider realRole="Finance">
      <MemoryRouter initialEntries={[url]}>
        <ToastProvider>
          <Location />
          <Routes>
            <Route path="/sales-invoices" element={<SalesInvoices />} />
            <Route path="/sales-invoices/:invoiceId" element={<SalesInvoices />} />
            <Route path="/finance/receivables" element={<p>receivables payment view</p>} />
          </Routes>
        </ToastProvider>
      </MemoryRouter>
    </ImpersonationProvider>
  </QueryClientProvider>
);
const renderAt = (url = '/sales-invoices/inv-1') => render(renderTree(url));

beforeEach(() => {
  invoiceState.data = [{ ...invoice }];
  invoiceState.isPending = false;
  invoiceState.isError = false;
  h.refetch.mockReset();
  h.getInvoice.mockReset();
  h.submitInvoice.mockReset().mockResolvedValue(undefined);
  h.revenueMode = 'native';
  h.evidence.data = { lines: [{ item_code: 'SVC', description: 'Inspection work', qty: 2, rate: 125, amount: 250 }], contact: { name: 'Billing Desk', email: 'billing@example.test', phone: '+62-TEST-000' } };
  h.evidence.isPending = false;
  h.evidence.isError = false;
  h.evidence.refetch.mockReset();
  h.pdfDownload.download.mockReset().mockResolvedValue(undefined);
  h.pdfDownload.inFlightIds.clear();
  incomingPaymentsState.data = [];
  incomingPaymentsState.isPending = false;
  incomingPaymentsState.isError = false;
});
afterEach(() => { focusManager.setFocused(undefined); });

describe('Sales invoice record floor', () => {
  it('floor: Approve confirms and submits the current invoice id', async () => {
    invoiceState.data[0] = {
      ...invoice, status: 'Draft', pmo_native: true, si_number: null, author_user_id: 'u-author', author_user_ids: ['u-author'],
    };
    renderAt();
    await userEvent.click(screen.getByRole('button', { name: 'Approve' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Approve invoice' }));

    await waitFor(() => expect(h.submitInvoice).toHaveBeenCalledWith(expect.objectContaining({
      siId: 'inv-1', intent: expect.objectContaining({ id: expect.any(String), idempotencyKey: expect.any(String) }),
    })));
  });

  it('floor: Record payment opens the payment view for this invoice', async () => {
    invoiceState.data[0] = { ...invoice, status: 'Unpaid', erp_outstanding_amount: 5000, received_date: '2026-10-10' };
    renderAt('/sales-invoices/inv-1?q=ACC-SINV-2026-00001&status=Unpaid&attribution=unassigned');
    await userEvent.click(screen.getByRole('button', { name: 'Record payment' }));

    expect(await screen.findByText('receivables payment view')).toBeInTheDocument();
    expect(screen.getByTestId('location')).toHaveTextContent('/finance/receivables?view=payments&invoice=inv-1&create=1');
  });

  it('floor: Download approved PDF hands off the invoice and reflects its busy state', async () => {
    h.revenueMode = 'erp';
    invoiceState.data[0] = { ...invoice, status: 'Submitted', erp_docstatus: 1, received_date: null };
    let finishDownload!: () => void;
    h.pdfDownload.download.mockImplementation(() => new Promise<void>((resolve) => { finishDownload = resolve; }));
    const view = renderAt();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Download approved PDF' }));
    await waitFor(() => expect(h.pdfDownload.download).toHaveBeenCalledWith(expect.objectContaining({ id: 'inv-1' })));

    h.pdfDownload.inFlightIds.add('inv-1');
    view.rerender(renderTree('/sales-invoices/inv-1'));
    expect(screen.getByRole('button', { name: 'Preparing PDF…' })).toBeDisabled();
    h.pdfDownload.inFlightIds.delete('inv-1');
    finishDownload();
    view.rerender(renderTree('/sales-invoices/inv-1'));
    expect(screen.getByRole('button', { name: 'Download approved PDF' })).toBeEnabled();
  });

  it('floor: billing email opens its mail destination', async () => {
    h.revenueMode = 'erp';
    invoiceState.data[0] = { ...invoice, status: 'Unpaid', pmo_native: false, erp_docstatus: 1 };
    renderAt();
    const link = await screen.findByRole('link', { name: 'billing@example.test' });
    const activated = vi.fn();
    link.addEventListener('click', (event) => { event.preventDefault(); activated((link as HTMLAnchorElement).href); }, { once: true });

    await userEvent.click(link);

    expect(activated).toHaveBeenCalledWith('mailto:billing@example.test');
  });

  it('floor: billing phone opens its call destination', async () => {
    h.revenueMode = 'erp';
    invoiceState.data[0] = { ...invoice, status: 'Unpaid', pmo_native: false, erp_docstatus: 1 };
    renderAt();
    const link = await screen.findByRole('link', { name: '+62-TEST-000' });
    const activated = vi.fn();
    link.addEventListener('click', (event) => { event.preventDefault(); activated((link as HTMLAnchorElement).href); }, { once: true });

    await userEvent.click(link);

    expect(activated).toHaveBeenCalledWith('tel:+62-TEST-000');
  });

  it('floor: Back to Receivables keeps search status and attribution context', async () => {
    const search = '?q=ACC-SINV-2026-00001&status=Unpaid&attribution=unassigned';
    renderAt(`/sales-invoices/inv-1${search}`);
    await userEvent.click(screen.getByRole('button', { name: 'Back to Receivables' }));

    expect(screen.getByTestId('location')).toHaveTextContent(`/sales-invoices${search}`);
  });

});
