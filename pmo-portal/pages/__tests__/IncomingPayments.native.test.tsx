import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import React from 'react';
import { ToastProvider } from '@/src/components/ui';
import { ImpersonationProvider } from '@/src/auth/impersonation';
import type { IncomingPaymentRow, SalesInvoiceRow } from '@/src/lib/db/revenue';

const h = vi.hoisted(() => ({
  createPaymentMutate: vi.fn(async (_input: unknown): Promise<{ id: string }> => ({ id: 'ip-new' })),
  payments: { data: [] as unknown[], isPending: false, isError: false, refetch: vi.fn() },
  invoices: { data: [] as unknown[], isPending: false, isError: false, refetch: vi.fn() },
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
  await financeTestI18n.changeLanguage('en');
});

describe('Incoming Payments while PMO owns revenue (#784)', () => {
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
    expect(screen.getAllByText('RCV-2610070001')[0]).toBeInTheDocument();
    expect(screen.getAllByText('Cancelled')[0]).toBeInTheDocument();
    await user.click(screen.getAllByRole('button', { name: 'Row actions' })[0]);
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
    // The receipt takes the invoice's currency (0270), so the amount reads in it — not the org default.
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
    h.createPaymentMutate.mockRejectedValue(new AppError('the payment date cannot be in the future', '23514'));
    const user = userEvent.setup();
    renderPage();
    await pickInvoice(user);
    await user.click(screen.getByRole('button', { name: 'Record payment' }));
    expect((await screen.findAllByText('The payment date cannot be in the future.')).length).toBeGreaterThan(0);
  });

  it('AC-NAR-003 (DD-NAR-17) a server refusal of a missing date asks for the payment date', async () => {
    h.invoices.data = [openInvoice];
    h.createPaymentMutate.mockRejectedValue(new AppError('a receipt needs its payment date', '23502'));
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
});
