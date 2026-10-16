import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
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
vi.mock('@/src/auth/usePermission', () => ({ usePermission: () => () => true }));
vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: { id: 'u-fin', org_id: 'org-1' }, role: 'Finance' }) }));
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
import { currencySymbol, instantToZonedDatetimeLocal } from '@/src/lib/format';
import { AppError } from '@/src/lib/appError';

const TODAY = () => instantToZonedDatetimeLocal(new Date(), 'UTC').slice(0, 10);
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

const renderPage = () => render(
  <FinanceI18nTestProvider>
    <ImpersonationProvider realRole="Finance">
      <MemoryRouter>
        <ToastProvider>
          <IncomingPayments />
        </ToastProvider>
      </MemoryRouter>
    </ImpersonationProvider>
  </FinanceI18nTestProvider>,
);

afterEach(() => resetActiveLocale());

beforeEach(async () => {
  setActiveLocale({ locale: 'en', numberLocale: 'en-US', timezone: 'UTC' });
  h.createPaymentMutate.mockReset();
  h.createPaymentMutate.mockResolvedValue({ id: 'ip-new' });
  h.payments.data = [];
  h.invoices.data = [];
  h.route = 'pmo';
  h.toast.mockClear();
  await financeTestI18n.changeLanguage('en');
});

/** The one list row (table row or phone card) whose text matches. */
function rowFor(text: string): HTMLElement {
  const branch = screen.queryByTestId('dt-table-branch') ?? screen.getByTestId('dt-card-branch');
  const rows = within(branch).queryAllByRole('row').length > 0 ? within(branch).getAllByRole('row') : within(branch).getAllByRole('listitem');
  const hits = rows.filter((r) => r.textContent?.includes(text));
  expect(hits).toHaveLength(1);
  return hits[0];
}

async function setAmount(user: ReturnType<typeof userEvent.setup>, label: RegExp, value: string) {
  const field = screen.getByLabelText(label);
  await user.clear(field);
  await user.type(field, value);
}

describe('Incoming Payments while PMO owns revenue (#784)', () => {
  it('UXS-042 renders payment money with tabular UI numerals rather than the identifier typeface', () => {
    h.payments.data = [receipt()];
    renderPage();
    const row = rowFor('RCV-2610070001');
    const amount = row.querySelector('.tabular');
    expect(amount).not.toBeNull();
    expect(amount).toHaveTextContent('500');
    expect(amount).not.toHaveClass('font-mono');
  });

  it('AC-NAR-003 a receipt recorded in PMO must name the invoice it settles', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getAllByRole('button', { name: /Receive Payment/i })[0]);
    await user.click(screen.getByRole('combobox', { name: 'Customer' }));
    await user.click(await screen.findByRole('option', { name: /Acme Energy/ }));
    for (const label of [/Paid Amount/, /Received Amount/]) {
      const field = screen.getByLabelText(label);
      await user.clear(field);
      await user.type(field, '100');
    }
    await user.click(screen.getByRole('button', { name: 'Record payment' }));
    expect((await screen.findAllByText('Choose the invoice this receipt settles.')).length).toBeGreaterThan(0);
    expect(h.createPaymentMutate).not.toHaveBeenCalled();
  });

  it('IP-1: each invalid-receipt summary link focuses its invoice, amount, or date control', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getAllByRole('button', { name: /Receive Payment/i })[0]);
    await user.click(screen.getByRole('combobox', { name: 'Customer' }));
    await user.click(await screen.findByRole('option', { name: /Acme Energy/ }));

    // No invoice is selected and the zero-valued amounts are left untouched. Set a non-empty
    // future date so it fails validation while satisfying the form's non-empty submit readiness.
    const date = screen.getByLabelText(/payment date/i);
    fireEvent.change(date, { target: { value: '2999-01-01' } });
    const submit = screen.getByRole('button', { name: 'Record payment' });
    // A native max-date constraint suppresses browser click-submit before React can validate;
    // dispatch the form's submit event to exercise the page's own summary and focus behavior.
    fireEvent.submit(submit.closest('form')!);

    const summary = document.querySelector<HTMLElement>('[aria-label="Form errors"]');
    expect(summary).not.toBeNull();
    const cases = [
      [/Choose the invoice this receipt settles\./, screen.getByRole('combobox', { name: /Sales Invoice/ })],
      [/Paid amount must be positive/i, screen.getByLabelText(/Paid Amount/)],
      [/Received amount must be positive/i, screen.getByLabelText(/Received Amount/)],
      [/payment date cannot be in the future/i, date],
    ] as const;
    for (const [message, control] of cases) {
      const link = within(summary!).getByRole('link', { name: message });
      await user.click(link);
      expect(document.activeElement).toBe(control);
    }
  });

  it('AC-NAR-003 an open PMO invoice is offered by its PMO number', async () => {
    h.invoices.data = [{
      id: 'si-1', customer_id: 'cust-1', si_number: null, pmo_number: 'INV-2610070001', pmo_native: true,
      status: 'Unpaid', erp_outstanding_amount: 610_000, currency: 'IDR',
    } as unknown as SalesInvoiceRow];
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getAllByRole('button', { name: /Receive Payment/i })[0]);
    await user.click(screen.getByRole('combobox', { name: /Sales Invoice/ }));
    expect(within(await screen.findByRole('listbox')).getByRole('option', { name: /INV-2610070001/ })).toBeInTheDocument();
  });

  it('AC-NAR-006 a live PMO receipt offers Cancel; a cancelled one reads Cancelled', async () => {
    h.payments.data = [receipt(), receipt({ id: 'ip-2', pmo_number: 'RCV-2610070002', cancelled_at: '2026-10-07T01:00:00Z' })];
    const user = userEvent.setup();
    renderPage();
    expect(within(rowFor('RCV-2610070002')).getByText('Cancelled')).toBeInTheDocument();
    await user.click(within(rowFor('RCV-2610070001')).getByRole('button', { name: 'Row actions' }));
    expect(screen.getByRole('menuitem', { name: 'Cancel' })).toBeInTheDocument();
  });
  it('AC-NAR-003 (DD-NAR-17) picking an open PMO invoice starts the amount at its outstanding balance', async () => {
    h.invoices.data = [openInvoice];
    const user = userEvent.setup();
    renderPage();
    await pickInvoice(user);
    expect(screen.getByLabelText(/Paid Amount/)).toHaveValue('610,000');
    expect(screen.getByLabelText(/Received Amount/)).toHaveValue('610,000');
    expect(screen.getByText(/Starts at the .*610,000\.00 outstanding/)).toBeInTheDocument();
    // The receipt takes the invoice's currency (0275), so the amount reads in it — not the org default.
    expect(screen.getByLabelText(/Paid Amount/).closest('div')).toHaveTextContent(currencySymbol('IDR'));
    await user.click(screen.getByRole('button', { name: 'Record payment' }));
    expect(h.createPaymentMutate).toHaveBeenCalledWith(expect.objectContaining({
      salesInvoiceId: 'si-1', paidAmount: 610_000, receivedAmount: 610_000, date: TODAY(),
    }));
  });

  it('AC-NAR-003 (DD-NAR-17) an amount above the balance is accepted and sent as entered', async () => {
    h.invoices.data = [openInvoice];
    const user = userEvent.setup();
    renderPage();
    await pickInvoice(user);
    for (const label of [/Paid Amount/, /Received Amount/]) {
      const field = screen.getByLabelText(label);
      await user.clear(field);
      await user.type(field, '700000');
    }
    await user.click(screen.getByRole('button', { name: 'Record payment' }));
    expect(h.createPaymentMutate).toHaveBeenCalledWith(expect.objectContaining({ paidAmount: 700_000, receivedAmount: 700_000 }));
  });

  it('AC-NAR-003 (DD-NAR-17) the payment date is required, starts at today and cannot be in the future', async () => {
    h.invoices.data = [openInvoice];
    const user = userEvent.setup();
    renderPage();
    await pickInvoice(user);
    const date = screen.getByLabelText(/Payment date/);
    expect(date).toBeRequired();
    expect(date).toHaveValue(TODAY());
    expect(date).toHaveAttribute('max', TODAY());
    fireEvent.change(date, { target: { value: '2999-01-01' } });
    fireEvent.blur(date);
    expect((await screen.findAllByText('The payment date cannot be in the future.')).length).toBeGreaterThan(0);
    await user.click(screen.getByRole('button', { name: 'Record payment' }));
    expect(h.createPaymentMutate).not.toHaveBeenCalled();
  });

  it('AC-NAR-003 (DD-NAR-17) a server refusal of the payment date reads as a plain sentence', async () => {
    h.invoices.data = [openInvoice];
    h.createPaymentMutate.mockRejectedValue(new AppError('the payment date cannot be in the future', 'payment-date-future'));
    const user = userEvent.setup();
    renderPage();
    await pickInvoice(user);
    await user.click(screen.getByRole('button', { name: 'Record payment' }));
    expect((await screen.findAllByText('The payment date cannot be in the future.')).length).toBeGreaterThan(0);
  });

  it('AC-NAR-003 (DD-NAR-17) a server refusal of a missing date asks for the payment date', async () => {
    h.invoices.data = [openInvoice];
    h.createPaymentMutate.mockRejectedValue(new AppError('a receipt needs its payment date', 'payment-date-missing'));
    const user = userEvent.setup();
    renderPage();
    await pickInvoice(user);
    await user.click(screen.getByRole('button', { name: 'Record payment' }));
    expect((await screen.findAllByText('Enter the payment date.')).length).toBeGreaterThan(0);
  });

  it('AC-NAR-006 a cancelled PMO receipt offers no Cancel; the page says receipts are recorded in PMO', () => {
    h.payments.data = [receipt({ cancelled_at: '2026-10-07T01:00:00Z' })];
    renderPage();
    expect(screen.getByText('Customer receipts recorded in PMO against approved invoices.')).toBeInTheDocument();
    // A row with no available action renders no menu trigger at all (DataTable).
    expect(screen.queryByRole('button', { name: 'Row actions' })).toBeNull();
  });

  it('AC-NAR-003 (I-5) the headline is keyed on the refusal code, never on the message text', async () => {
    h.invoices.data = [openInvoice];
    h.createPaymentMutate.mockRejectedValue(new AppError('the payment date cannot be in the future', '23514'));
    const user = userEvent.setup();
    renderPage();
    await pickInvoice(user);
    await user.click(screen.getByRole('button', { name: 'Record payment' }));
    expect(await screen.findByTestId('entity-modal-save-error')).toBeInTheDocument();
    expect(screen.queryByText('The payment date cannot be in the future.')).toBeNull();
  });

  it('AC-NAR-003 (I-5) a receipt refusal is shown once, in the dialog — no toast as well', async () => {
    h.invoices.data = [openInvoice];
    h.createPaymentMutate.mockRejectedValue(new AppError('received plus withheld must equal the amount', 'receipt-amount-invalid'));
    const user = userEvent.setup();
    renderPage();
    await pickInvoice(user);
    await user.click(screen.getByRole('button', { name: 'Record payment' }));
    expect(await screen.findByTestId('entity-modal-save-error')).toHaveTextContent('Check the receipt amounts.');
    expect(h.toast).not.toHaveBeenCalled();
  });

  it('AC-NAR-003 (I-5) a PMO receipt shows the invoice it settles', () => {
    h.invoices.data = [openInvoice];
    h.payments.data = [receipt()];
    renderPage();
    expect(rowFor('RCV-2610070001')).toHaveTextContent('INV-2610070001');
  });

  it('AC-NAR-006 (I-5) PMO mode filters by Received and Cancelled — receipts are never Scheduled', async () => {
    h.payments.data = [receipt(), receipt({ id: 'ip-2', pmo_number: 'RCV-2610070002', cancelled_at: '2026-10-07T01:00:00Z' })];
    const user = userEvent.setup();
    renderPage();
    const filters = screen.getByRole('tablist', { name: 'Filter by status' });
    expect(within(filters).queryByRole('tab', { name: 'Scheduled' })).toBeNull();
    expect(within(rowFor('RCV-2610070001')).getByText('Received')).toBeInTheDocument();
    await user.click(within(filters).getByRole('tab', { name: 'Cancelled' }));
    expect(screen.queryByText('RCV-2610070001')).toBeNull();
    expect(screen.getByText('RCV-2610070002')).toBeInTheDocument();
    await user.click(within(filters).getByRole('tab', { name: 'Received' }));
    expect(screen.getByText('RCV-2610070001')).toBeInTheDocument();
    expect(screen.queryByText('RCV-2610070002')).toBeNull();
  });

  it('AC-NAR-003 (I-5) the PMO receipt picker offers only PMO invoices', async () => {
    h.invoices.data = [openInvoice, { ...openInvoice, id: 'si-erp', pmo_native: false, pmo_number: null, si_number: 'ACC-SINV-0001' }];
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getAllByRole('button', { name: /Receive Payment/i })[0]);
    await user.click(screen.getByRole('combobox', { name: 'Customer' }));
    await user.click(await screen.findByRole('option', { name: /Acme Energy/ }));
    await user.click(screen.getByRole('combobox', { name: /Sales Invoice/ }));
    const list = await screen.findByRole('listbox');
    expect(within(list).getByRole('option', { name: /INV-2610070001/ })).toBeInTheDocument();
    expect(within(list).queryByRole('option', { name: /ACC-SINV-0001/ })).toBeNull();
  });

  it('AC-NAR-003 (I-5) cash received follows the paid amount while nothing is withheld, so a part payment just works', async () => {
    h.invoices.data = [openInvoice];
    const user = userEvent.setup();
    renderPage();
    await pickInvoice(user);
    await setAmount(user, /Paid Amount/, '500000');
    expect(screen.getByLabelText(/Received Amount/)).toHaveValue('500,000');
    await user.click(screen.getByRole('button', { name: 'Record payment' }));
    expect(h.createPaymentMutate).toHaveBeenCalledWith(expect.objectContaining({ paidAmount: 500_000, receivedAmount: 500_000 }));
  });

  it('AC-NAR-003 (I-5) received + withheld must equal paid even with nothing withheld — refused before the round trip', async () => {
    h.invoices.data = [openInvoice];
    const user = userEvent.setup();
    renderPage();
    await pickInvoice(user);
    await setAmount(user, /Paid Amount/, '500000');
    await setAmount(user, /Received Amount/, '400000');
    await user.click(screen.getByRole('button', { name: 'Record payment' }));
    expect((await screen.findAllByText('Cash received plus withheld tax must equal the amount allocated to the invoice.')).length).toBeGreaterThan(0);
    expect(h.createPaymentMutate).not.toHaveBeenCalled();
  });

  it('(I-5) ERP mode: the invoice is optional — a payment on account is recorded with no invoice', async () => {
    h.route = 'external';
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getAllByRole('button', { name: /Receive Payment/i })[0]);
    expect(screen.getByRole('combobox', { name: /Sales Invoice \(optional\)/ })).not.toBeRequired();
    await user.click(screen.getByRole('combobox', { name: 'Customer' }));
    await user.click(await screen.findByRole('option', { name: /Acme Energy/ }));
    await setAmount(user, /Paid Amount/, '100');
    await setAmount(user, /Received Amount/, '100');
    await user.click(screen.getByRole('button', { name: 'Record payment' }));
    expect(h.createPaymentMutate).toHaveBeenCalledWith(expect.objectContaining({ customerId: 'cust-1', salesInvoiceId: null, paidAmount: 100, receivedAmount: 100 }));
  });

  it('NFR-NAR-006 (M-6) the receipt form and its invoice picker are translated', async () => {
    h.invoices.data = [openInvoice];
    await financeTestI18n.changeLanguage('id');
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getAllByRole('button', { name: financeTestI18n.t('financeCopy.receivePayment') })[0]);
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByRole('button', { name: financeTestI18n.t('financeCopy.recordPayment') })).toBeInTheDocument();
    expect(financeTestI18n.t('financeCopy.recordPayment')).not.toBe('Record payment');
    expect(dialog).toHaveTextContent(financeTestI18n.t('financeCopy.receivePaymentSubtitle'));
    expect(financeTestI18n.t('financeCopy.receivePaymentSubtitle')).not.toBe('Record a new incoming payment from a client');
  });

  it('AC-NAR-003 (I-5) the payment date cannot be before the invoice date — the picker says so and refuses it', async () => {
    h.invoices.data = [{ ...openInvoice, invoice_date: '2026-10-01' }];
    const user = userEvent.setup();
    renderPage();
    await pickInvoice(user);
    const date = screen.getByLabelText(/Payment date/);
    expect(date).toHaveAttribute('min', '2026-10-01');
    fireEvent.change(date, { target: { value: '2026-09-30' } });
    fireEvent.blur(date);
    await user.click(screen.getByRole('button', { name: 'Record payment' }));
    expect((await screen.findAllByText('The payment date cannot be before the invoice date.')).length).toBeGreaterThan(0);
    expect(h.createPaymentMutate).not.toHaveBeenCalled();
  });
});

// ── S-06: what cash settled (RF-030..RF-034) ─────────────────────────────────────────────────────────────
const alloc = (invoice_number: string, amount: string | null, invoice_id: string | null = null, currency: string | null = 'IDR') =>
  ({ invoice_id, invoice_number, amount, currency });
const erpReceipt = (over: Partial<IncomingPaymentRow> = {}) => receipt({
  id: 'ip-erp', pmo_native: false, pmo_number: null, ip_number: 'ACC-PAY-0001', sales_invoice_id: 'si-a',
  erp_docstatus: 1, amount: 75_000, received_amount: 75_000, withheld_amount: 0, ...over,
});
const renderAt = (path: string) => render(
  <FinanceI18nTestProvider>
    <ImpersonationProvider realRole="Finance">
      <MemoryRouter initialEntries={[path]}>
        <ToastProvider>
          <Routes>
            <Route path="/incoming-payments" element={<IncomingPayments />} />
            <Route path="/incoming-payments/:receiptId" element={<IncomingPayments />} />
            <Route path="/sales-invoices/:invoiceId" element={<p>invoice record</p>} />
          </Routes>
        </ToastProvider>
      </MemoryRouter>
    </ImpersonationProvider>
  </FinanceI18nTestProvider>,
);
const twoInvoices = [alloc('ACC-SINV-A', '25000.00', 'si-a'), alloc('ACC-SINV-B', '30000.00', 'si-b')];

describe('Incoming Payments list — what cash settled (S-06)', () => {
  beforeEach(() => { h.route = 'external'; });

  it('RF-033 an ERP receipt reads Received / Expected, never the invoice words Paid / Scheduled', () => {
    h.payments.data = [
      erpReceipt({ allocation_details: twoInvoices }),
      erpReceipt({ id: 'ip-2', ip_number: 'ACC-PAY-0002', status: 'Scheduled', erp_docstatus: 0, allocation_details: [] }),
    ];
    renderAt('/incoming-payments');
    expect(within(rowFor('ACC-PAY-0001')).getByText('Received')).toBeInTheDocument();
    expect(within(rowFor('ACC-PAY-0002')).getByText('Expected')).toBeInTheDocument();
    const filters = screen.getByRole('tablist', { name: 'Filter by status' });
    expect(within(filters).getByRole('tab', { name: 'Expected' })).toBeInTheDocument();
    expect(within(filters).queryByRole('tab', { name: 'Scheduled' })).toBeNull();
    expect(within(filters).queryByRole('tab', { name: 'Paid' })).toBeNull();
  });

  it('RF-030 a multi-invoice receipt names its first invoice and how many more, not just one', () => {
    h.payments.data = [erpReceipt({ allocation_details: twoInvoices })];
    renderAt('/incoming-payments');
    expect(rowFor('ACC-PAY-0001')).toHaveTextContent('ACC-SINV-A +1 more');
  });

  it('RF-032 tax withheld is None when known to be zero and Not reported when the source did not say', () => {
    h.payments.data = [
      erpReceipt({ allocation_details: twoInvoices, withheld_amount: 0 }),
      erpReceipt({ id: 'ip-2', ip_number: 'ACC-PAY-0002', withheld_amount: null, allocation_details: twoInvoices }),
    ];
    renderAt('/incoming-payments');
    expect(rowFor('ACC-PAY-0001')).toHaveTextContent('None');
    expect(rowFor('ACC-PAY-0002')).toHaveTextContent('Not reported');
  });

  it('RF-031 cash the accounting system has not matched to an invoice is shown, apart from matched cash', () => {
    h.payments.data = [erpReceipt({ amount: 95_000, received_amount: 95_000, allocation_details: twoInvoices })];
    renderAt('/incoming-payments');
    expect(rowFor('ACC-PAY-0001')).toHaveTextContent(/40,000/);
    expect(screen.getByRole('columnheader', { name: 'Not yet applied' })).toBeInTheDocument();
  });

  it('RF-031 unknown allocation coverage never shows a figure for unapplied cash', () => {
    h.payments.data = [erpReceipt({ allocation_details: null })];
    renderAt('/incoming-payments');
    expect(rowFor('ACC-PAY-0001')).not.toHaveTextContent(/75,000.*75,000.*75,000/);
    expect(rowFor('ACC-PAY-0001')).toHaveTextContent('Not reported');
  });

  it('RF-034 opening a row goes to its read-only receipt page', async () => {
    h.payments.data = [erpReceipt({ allocation_details: twoInvoices })];
    const user = userEvent.setup();
    renderAt('/incoming-payments');
    await user.click(within(rowFor('ACC-PAY-0001')).getByRole('link', { name: 'ACC-PAY-0001' }));
    expect(await screen.findByRole('heading', { name: /ACC-PAY-0001/ })).toBeInTheDocument();
  });
});

describe('Receipt page — every allocation (S-06)', () => {
  beforeEach(() => { h.route = 'external'; });

  it('RF-030/034 lists each invoice the receipt settled with its own amount, linked to the invoice', () => {
    h.payments.data = [erpReceipt({ amount: 95_000, received_amount: 95_000, allocation_details: twoInvoices })];
    renderAt('/incoming-payments/ip-erp');
    const table = screen.getByRole('table', { name: 'Invoices this receipt settled' });
    expect(within(table).getByRole('link', { name: 'ACC-SINV-A' })).toHaveAttribute('href', '/sales-invoices/si-a');
    expect(within(table).getByRole('link', { name: 'ACC-SINV-B' })).toHaveAttribute('href', '/sales-invoices/si-b');
    expect(within(table).getByText(/25,000/)).toBeInTheDocument();
    expect(within(table).getByText(/30,000/)).toBeInTheDocument();
  });

  it('does not assign the receipt currency to an allocation whose currency was not reported', () => {
    h.payments.data = [erpReceipt({ allocation_details: [alloc('ACC-SINV-A', '25000.00', 'si-a', null)] })];
    renderAt('/incoming-payments/ip-erp');
    const table = screen.getByRole('table', { name: 'Invoices this receipt settled' });
    expect(within(table).getByText('Not reported')).toBeInTheDocument();
    expect(within(table).queryByText(/25,000/)).toBeNull();
  });

  it('RF-031 states the cash not yet applied to any invoice, separate from the matched cash', () => {
    h.payments.data = [erpReceipt({ amount: 95_000, received_amount: 95_000, allocation_details: twoInvoices })];
    renderAt('/incoming-payments/ip-erp');
    expect(screen.getByTestId('receipt-unapplied')).toHaveTextContent(/40,000/);
  });

  it('RF-032 withheld tax reads Not reported when unknown, and None only when known to be zero', () => {
    h.payments.data = [erpReceipt({ withheld_amount: null, allocation_details: twoInvoices })];
    renderAt('/incoming-payments/ip-erp');
    expect(screen.getByTestId('receipt-withheld')).toHaveTextContent('Not reported');
  });

  it('RF-031 a receipt the source reports as unapplied to any invoice says so; unknown coverage says it is unknown', () => {
    h.payments.data = [erpReceipt({ sales_invoice_id: null, allocation_details: [] })];
    const { unmount } = renderAt('/incoming-payments/ip-erp');
    expect(screen.getByText(/not applied to any invoice/i)).toBeInTheDocument();
    unmount();
    h.payments.data = [erpReceipt({ allocation_details: null })];
    renderAt('/incoming-payments/ip-erp');
    expect(screen.getByText(/has not reported which invoices/i)).toBeInTheDocument();
  });

  it('a PMO-recorded receipt shows its one invoice with the whole receipt applied', () => {
    h.invoices.data = [openInvoice];
    h.route = 'pmo';
    h.payments.data = [receipt()];
    renderAt('/incoming-payments/ip-1');
    const table = screen.getByRole('table', { name: 'Invoices this receipt settled' });
    expect(within(table).getByRole('link', { name: 'INV-2610070001' })).toHaveAttribute('href', '/sales-invoices/si-1');
    expect(screen.getByTestId('receipt-unapplied')).toHaveTextContent('None');
  });

  it('an unknown receipt id says it was not found', () => {
    h.payments.data = [erpReceipt()];
    renderAt('/incoming-payments/nope');
    expect(screen.getByText(/couldn.t find this receipt/i)).toBeInTheDocument();
  });
});
