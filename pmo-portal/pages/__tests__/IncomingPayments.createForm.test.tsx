import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import React from 'react';
import { ToastProvider } from '@/src/components/ui';
import { ImpersonationProvider } from '@/src/auth/impersonation';
import type { SalesInvoiceRow } from '@/src/lib/db/revenue';

/**
 * IncomingPayments — the record-a-receipt journey (read-model audit BLOCK 1).
 *
 * Both pickers were `loadOptions={async () => []}` stubs, so `customerId` could never leave ''
 * and "Record payment" was permanently disabled: a Finance user could not record a receipt from
 * PMO at all. These tests drive the real journey and assert what the mutation receives.
 *
 * NOTE (out of scope, reported separately): `incomingPayment` has NO entry in the policy table at
 * all, so `can('view','incomingPayment')` is false for every role and the page currently renders
 * "You don't have access" for everyone. The affordance gate is stubbed here so the form itself can
 * be tested; the missing policy entry is escalated to the Director.
 */

const invoice = (over: Partial<SalesInvoiceRow>): SalesInvoiceRow =>
  ({
    id: 'si-x',
    org_id: 'org-1',
    project_id: null,
    customer_id: 'cust-1',
    si_number: 'ACC-SINV-0001',
    reference_number: null,
    invoice_date: '2026-07-01',
    amount: 1000,
    erp_outstanding_amount: 1000,
    status: 'Unpaid',
    erp_docstatus: 1,
    erp_modified: null,
    erp_amended_from: null,
    erp_cancelled_at: null,
    created_at: '2026-07-01T00:00:00Z',
    author_user_id: 'u-1',
    erp_payment_terms_days: 30,
    erp_due_date: null,
    ...over,
  }) as SalesInvoiceRow;

const hoisted = vi.hoisted(() => ({
  createPaymentMutate: vi.fn(async () => ({ id: 'ip-new' })),
  paymentsState: { data: [], isPending: false, isError: false, refetch: vi.fn() },
  invoicesState: { data: [] as unknown[], isPending: false, isError: false, refetch: vi.fn() },
  clientOptions: [
    { value: 'cust-1', label: 'Acme Energy', sub: 'Client' },
    { value: 'cust-2', label: 'Borealis Marine', sub: 'Client' },
  ],
}));

vi.mock('@/src/hooks/useRevenue', () => ({
  useIncomingPayments: () => hoisted.paymentsState,
  useSalesInvoices: () => hoisted.invoicesState,
  useRevenueMutations: () => ({
    createPayment: { mutateAsync: hoisted.createPaymentMutate, isPending: false },
    cancelPayment: { mutateAsync: vi.fn(), isPending: false },
    pendingPush: { status: 'idle', lastError: null, lastPushAt: null },
  }),
}));

vi.mock('@/src/hooks/useFkOptions', () => ({
  useClientCompanyOptions: () => ({ data: hoisted.clientOptions }),
}));

vi.mock('@/src/auth/usePermission', () => ({ usePermission: () => () => true }));

vi.mock('@/src/auth/useAuth', () => ({
  useAuth: () => ({ currentUser: { id: 'u-fin', org_id: 'org-1' }, role: 'Finance' }),
}));

vi.mock('@/src/lib/adapterSeam/ownershipCache', () => ({ routeDomainWrite: vi.fn(() => 'pmo') }));

import IncomingPayments from '../IncomingPayments';

const renderPage = () =>
  render(
    <ImpersonationProvider realRole="Finance">
      <MemoryRouter>
        <ToastProvider>
          <IncomingPayments />
        </ToastProvider>
      </MemoryRouter>
    </ImpersonationProvider>,
  );

async function openForm(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getAllByRole('button', { name: /Receive Payment/i })[0]);
}

async function pick(user: ReturnType<typeof userEvent.setup>, picker: string | RegExp, label: string) {
  await user.click(screen.getByRole('combobox', { name: picker }));
  await user.click(await screen.findByRole('option', { name: new RegExp(label) }));
}

beforeEach(() => {
  hoisted.createPaymentMutate.mockClear();
  hoisted.invoicesState.data = [];
});

describe('IncomingPayments — a Finance user can actually record a receipt (BLOCK 1)', () => {
  it('offers the org\'s real client companies in the customer picker', async () => {
    const user = userEvent.setup();
    renderPage();
    await openForm(user);

    await user.click(screen.getByRole('combobox', { name: 'Customer' }));

    const listbox = await screen.findByRole('listbox');
    expect(within(listbox).getByRole('option', { name: /Acme Energy/ })).toBeInTheDocument();
    expect(within(listbox).getByRole('option', { name: /Borealis Marine/ })).toBeInTheDocument();
  });

  it('offers only invoices that can still RECEIVE a payment — never a Draft, Paid or Cancelled one', async () => {
    hoisted.invoicesState.data = [
      invoice({ id: 'si-unpaid', si_number: 'SI-UNPAID', status: 'Unpaid', erp_outstanding_amount: 400 }),
      invoice({ id: 'si-submitted', si_number: 'SI-SUBMITTED', status: 'Submitted', erp_outstanding_amount: 900 }),
      invoice({ id: 'si-draft', si_number: 'SI-DRAFT', status: 'Draft' }),
      invoice({ id: 'si-paid', si_number: 'SI-PAID', status: 'Paid', erp_outstanding_amount: 0 }),
      invoice({ id: 'si-cancelled', si_number: 'SI-CANCELLED', status: 'Cancelled' }),
      invoice({ id: 'si-settled', si_number: 'SI-SETTLED', status: 'Unpaid', erp_outstanding_amount: 0 }),
    ];
    const user = userEvent.setup();
    renderPage();
    await openForm(user);

    await user.click(screen.getByRole('combobox', { name: /Sales Invoice/ }));

    const listbox = await screen.findByRole('listbox');
    expect(within(listbox).getByRole('option', { name: /SI-UNPAID/ })).toBeInTheDocument();
    expect(within(listbox).getByRole('option', { name: /SI-SUBMITTED/ })).toBeInTheDocument();
    expect(within(listbox).queryByRole('option', { name: /SI-DRAFT/ })).not.toBeInTheDocument();
    expect(within(listbox).queryByRole('option', { name: /SI-PAID/ })).not.toBeInTheDocument();
    expect(within(listbox).queryByRole('option', { name: /SI-CANCELLED/ })).not.toBeInTheDocument();
    expect(within(listbox).queryByRole('option', { name: /SI-SETTLED/ })).not.toBeInTheDocument();
  });

  it('narrows the invoice picker to the chosen customer (a receipt can\'t settle another client\'s invoice)', async () => {
    hoisted.invoicesState.data = [
      invoice({ id: 'si-a', si_number: 'SI-ACME', customer_id: 'cust-1' }),
      invoice({ id: 'si-b', si_number: 'SI-BOREALIS', customer_id: 'cust-2' }),
    ];
    const user = userEvent.setup();
    renderPage();
    await openForm(user);

    await pick(user, 'Customer', 'Acme Energy');
    await user.click(screen.getByRole('combobox', { name: /Sales Invoice/ }));

    const listbox = await screen.findByRole('listbox');
    expect(within(listbox).getByRole('option', { name: /SI-ACME/ })).toBeInTheDocument();
    expect(within(listbox).queryByRole('option', { name: /SI-BOREALIS/ })).not.toBeInTheDocument();
  });

  it('enables "Record payment" once the form is filled, and submits what the user entered', async () => {
    hoisted.invoicesState.data = [invoice({ id: 'si-a', si_number: 'SI-ACME', customer_id: 'cust-1' })];
    const user = userEvent.setup();
    renderPage();
    await openForm(user);

    expect(screen.getByRole('button', { name: 'Record payment' })).toBeDisabled();

    await pick(user, 'Customer', 'Acme Energy');
    await pick(user, /Sales Invoice/, 'SI-ACME');
    const paid = screen.getByLabelText(/Paid Amount/);
    await user.clear(paid);
    await user.type(paid, '750');
    const received = screen.getByLabelText(/Received Amount/);
    await user.clear(received);
    await user.type(received, '750');

    const submit = screen.getByRole('button', { name: 'Record payment' });
    expect(submit).toBeEnabled();
    await user.click(submit);

    expect(hoisted.createPaymentMutate).toHaveBeenCalledWith(
      expect.objectContaining({
        customerId: 'cust-1',
        salesInvoiceId: 'si-a',
        paidAmount: 750,
        receivedAmount: 750,
      }),
    );
  });
});
