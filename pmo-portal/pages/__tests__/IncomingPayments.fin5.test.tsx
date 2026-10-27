import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import React from 'react';
import { ToastProvider } from '@/src/components/ui';
import { ImpersonationProvider } from '@/src/auth/impersonation';
import type { IncomingPaymentRow, SalesInvoiceRow } from '@/src/lib/db/revenue';

const h = vi.hoisted(() => ({
  createPaymentMutate: vi.fn(async (_input: unknown): Promise<{ id: string }> => ({ id: 'ip-new' })),
  payments: { data: [] as unknown[], isPending: false, isError: false, refetch: vi.fn() },
  invoices: { data: [] as unknown[], isPending: false, isError: false, refetch: vi.fn() },
  route: 'pmo' as 'pmo' | 'external',
  role: 'Finance' as 'Finance' | 'Project Manager',
  toast: vi.fn(),
}));
vi.mock('@/src/hooks/useOrgCurrency', () => ({ useOrgCurrency: () => 'USD' }));
vi.mock('@/src/hooks/useRevenue', () => ({
  useIncomingPayments: () => h.payments,
  useSalesInvoices: () => h.invoices,
  useRevenueMutations: () => ({
    createPayment: { mutateAsync: h.createPaymentMutate, isPending: false },
    cancelPayment: { mutateAsync: vi.fn(), isPending: false },
    pendingPush: { status: 'idle', lastError: null, lastPushAt: null },
  }),
}));
vi.mock('@/src/hooks/useFkOptions', () => ({ useClientCompanyOptions: () => ({ data: [{ value: 'cust-1', label: 'Acme Energy', sub: 'Client' }] }) }));
vi.mock('@/src/auth/usePermission', () => ({ usePermission: () => (action: string, entity: string) => {
  if (action === 'create' && entity === 'incomingPayment') return h.role === 'Finance';
  return true;
} }));
vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: { id: 'u-fin', org_id: 'org-1' }, role: h.role }) }));
vi.mock('@/src/lib/adapterSeam/ownershipCache', () => ({ routeDomainWrite: vi.fn(() => 'pmo') }));
vi.mock('@/src/hooks/useExternalDomainOwnership', () => ({ useExternalDomainOwnership: () => ({
  data: h.route === 'external' ? [{ id: 'o-1', orgId: 'org-1', externalTier: 'erpnext', domain: 'revenue' }] : [],
  isError: false,
}) }));
vi.mock('@/src/components/ui', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/src/components/ui')>();
  return { ...real, useToast: () => ({ toast: h.toast }) };
});

import IncomingPayments from '../IncomingPayments';
import { FinanceI18nTestProvider } from './financeI18nTestProvider';
import { financeTestI18n } from './financeI18nTestInstance';
import { resetActiveLocale, setActiveLocale } from '@/src/lib/locale/activeLocale';

const openInvoice = {
  id: 'si-1', customer_id: 'cust-1', si_number: null, pmo_number: 'INV-2610070001', pmo_native: true,
  status: 'Unpaid', erp_outstanding_amount: 610_000, currency: 'IDR',
} as unknown as SalesInvoiceRow;

async function pickInvoice(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getAllByRole('button', { name: /Receive Payment/i })[0]);
  await user.click(screen.getByRole('combobox', { name: 'Customer' }));
  await user.click(await screen.findByRole('option', { name: /Acme Energy/ }));
  await user.click(screen.getByRole('combobox', { name: /Sales Invoice/ }));
  await user.click(await screen.findByRole('option', { name: /INV-2610070001/ }));
}

const receipt = (over: Partial<IncomingPaymentRow> = {}): IncomingPaymentRow => ({
  id: 'ip-1', org_id: 'org-1', customer_id: 'cust-1', customer_name: 'Acme Energy', sales_invoice_id: 'si-1',
  ip_number: null, pmo_number: 'RCV-2610070001', pmo_native: true, cancelled_at: null, reference_number: null,
  date: '2026-10-07', amount: 500_000, received_amount: 500_000, withheld_amount: 0, withholding_slip_number: null,
  currency: 'IDR', status: 'Paid', erp_docstatus: null, erp_modified: null, erp_amended_from: null,
  erp_cancelled_at: null, created_at: '2026-10-07T00:00:00Z', ...over,
}) as IncomingPaymentRow;

const renderPage = (url = '/incoming-payments') => render(
  <FinanceI18nTestProvider>
    <ImpersonationProvider realRole="Finance">
      <MemoryRouter initialEntries={[url]}>
        <ToastProvider>
          <Routes>
            <Route path="/incoming-payments" element={<IncomingPayments />} />
            <Route path="/incoming-payments/:receiptId" element={<IncomingPayments />} />
          </Routes>
        </ToastProvider>
      </MemoryRouter>
    </ImpersonationProvider>
  </FinanceI18nTestProvider>,
);

afterEach(() => resetActiveLocale());

beforeEach(async () => {
  h.role = 'Finance';
  setActiveLocale({ locale: 'en', numberLocale: 'en-US', timezone: 'UTC' });
  h.createPaymentMutate.mockReset();
  h.createPaymentMutate.mockResolvedValue({ id: 'ip-new' });
  h.payments.data = [];
  h.payments.isError = false;
  h.invoices.data = [];
  h.route = 'pmo';
  h.toast.mockClear();
  await financeTestI18n.changeLanguage('en');
});


const columnHeaders = () => screen.getAllByRole('columnheader').map((th) => th.textContent?.trim()).filter((name) => name && name !== 'Actions');

describe('FIN-S5: receipts list', () => {
  it('shows seven columns and keeps cash received, tax withheld, not-yet-applied and slip out of the default list', () => {
    h.payments.data = [receipt({ withheld_amount: 5_000, withholding_slip_number: 'SLIP-9' })];
    renderPage();
    const cols = columnHeaders();
    expect(cols.length).toBeLessThanOrEqual(7);
    for (const gone of ['Cash received', 'Tax withheld', 'Not yet applied', 'Withholding slip']) expect(cols).not.toContain(gone);
    expect(cols).toEqual(expect.arrayContaining(['Payment #', 'Status', 'Amount', 'Date']));
    expect(screen.queryByText('SLIP-9')).not.toBeInTheDocument();
  });
});

describe('FIN-S5: receipt record', () => {
  const open = () => renderPage('/incoming-payments/ip-1');

  it('shows only the receipt total when cash equals it and nothing is withheld or unapplied', () => {
    h.payments.data = [receipt({ allocation_details: [{ invoice_id: 'si-1', invoice_number: 'INV-1', amount: '500000.00', currency: 'IDR' }] } as Partial<IncomingPaymentRow>)];
    open();
    expect(screen.getByText('Receipt total')).toBeInTheDocument();
    for (const gone of ['Cash received', 'Tax withheld', 'Not yet applied']) expect(screen.queryByText(gone)).not.toBeInTheDocument();
    expect(screen.queryByText(/Some figures weren/)).not.toBeInTheDocument();
  });

  it('adds cash received, tax withheld and the slip beside it when they differ or are non-zero', () => {
    h.payments.data = [receipt({
      received_amount: 450_000, withheld_amount: 50_000, withholding_slip_number: 'SLIP-9',
      allocation_details: [{ invoice_id: 'si-1', invoice_number: 'INV-1', amount: '500000.00', currency: 'IDR' }],
    } as Partial<IncomingPaymentRow>)];
    open();
    expect(screen.getByText('Cash received')).toBeInTheDocument();
    expect(within(screen.getByTestId('receipt-withheld')).getByText(/50,000/)).toBeInTheDocument();
    expect(within(screen.getByTestId('receipt-withheld')).getByText('SLIP-9')).toBeInTheDocument();
    expect(screen.queryByText('Not yet applied')).not.toBeInTheDocument();
  });

  it('states unreported figures once instead of three "Not reported" cells, and drops the unapplied paragraph', () => {
    h.payments.data = [receipt({ received_amount: null, withheld_amount: null, allocation_details: [] } as Partial<IncomingPaymentRow>)];
    open();
    expect(screen.getAllByText(/Some figures weren.t reported/)).toHaveLength(1);
    expect(screen.queryByText('Not reported')).not.toBeInTheDocument();
    expect(screen.queryByText(/is not yet applied to an invoice/)).not.toBeInTheDocument();
  });

  it('shows not-yet-applied cash as a fact, with no extra sentence below', () => {
    h.payments.data = [receipt({ allocation_details: [{ invoice_id: 'si-1', invoice_number: 'INV-1', amount: '400000.00', currency: 'IDR' }] } as Partial<IncomingPaymentRow>)];
    open();
    expect(within(screen.getByTestId('receipt-unapplied')).getByText(/100,000/)).toBeInTheDocument();
    expect(screen.queryByText(/is not yet applied to an invoice/)).not.toBeInTheDocument();
  });
});

describe('FIN-S5: native receive form', () => {
  it('gives Amount settled one outstanding sentence', async () => {
    h.invoices.data = [openInvoice];
    const user = userEvent.setup();
    renderPage();
    await pickInvoice(user);
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).queryByText(/includes cash received and any tax withheld/)).not.toBeInTheDocument();
    expect(within(dialog).getByText(/Starts at the .*610,000.* outstanding/)).toBeInTheDocument();
  });
});
