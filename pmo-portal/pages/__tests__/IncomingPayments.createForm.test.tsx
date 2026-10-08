import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
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
    customer_name: 'Acme Energy',
    si_number: 'ACC-SINV-0001',
    reference_number: null,
    invoice_date: '2026-07-01',
    amount: 1000,
    // FR-L10N-020: SalesInvoiceRow now declares the invoice's own currency (0187).
    currency: 'USD',
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
  paymentsState: { data: [] as unknown[], isPending: false, isError: false, refetch: vi.fn() },
  invoicesState: { data: [] as unknown[], isPending: false, isError: false, refetch: vi.fn() },
  navigateMock: vi.fn(),
  clientOptions: [
    { value: 'cust-1', label: 'Acme Energy', sub: 'Client' },
    { value: 'cust-2', label: 'Borealis Marine', sub: 'Client' },
  ],
}));

// FR-L10N-020: this tree reads useOrgCurrency (org-denominated aggregates). Pinned here rather
// than left to a real query. ⚑ At LINE-START — inside a neighbouring vi.mock it parses as a
// syntax error and hides every real error beneath it.
vi.mock('@/src/hooks/useOrgCurrency', () => ({ useOrgCurrency: () => 'USD' }));
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
// These journeys are the ERP-path receipt (optional invoice, on-account, withholding against an ERP invoice); the PMO
// receipt path is IncomingPayments.native.test.tsx.
vi.mock('@/src/hooks/useExternalDomainOwnership', () => ({ useExternalDomainOwnership: () => ({ data: [{ id: 'o-1', orgId: 'org-1', externalTier: 'erpnext', domain: 'revenue' }], isError: false }) }));
vi.mock('react-router', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router')>();
  return { ...actual, useNavigate: () => hoisted.navigateMock };
});

import IncomingPayments from '../IncomingPayments';
import { resetActiveLocale, setActiveLocale } from '@/src/lib/locale/activeLocale';
import { FinanceI18nTestProvider } from './financeI18nTestProvider';
import { financeTestI18n } from './financeI18nTestInstance';

const EN_LOCALE = { locale: 'en', numberLocale: 'en-US', timezone: 'UTC' };
const ID_LOCALE = { locale: 'id', numberLocale: 'id-ID', timezone: 'Asia/Jakarta' };

const renderPage = () =>
  render(
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

async function openForm(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getAllByRole('button', { name: /Receive Payment/i })[0]);
}

async function pick(user: ReturnType<typeof userEvent.setup>, picker: string | RegExp, label: string) {
  await user.click(screen.getByRole('combobox', { name: picker }));
  await user.click(await screen.findByRole('option', { name: new RegExp(label) }));
}

beforeEach(async () => {
  hoisted.createPaymentMutate.mockClear();
  hoisted.navigateMock.mockClear();
  hoisted.paymentsState.data = [];
  hoisted.invoicesState.data = [];
  setActiveLocale(EN_LOCALE);
  await financeTestI18n.changeLanguage('en');
});
afterEach(() => resetActiveLocale());

describe('IncomingPayments — a Finance user can actually record a receipt (BLOCK 1)', () => {
  it('AC-WHT-001: records cash received and the client withholding slip against the full allocation', async () => {
    hoisted.invoicesState.data = [invoice({ id: 'si-a', si_number: 'SI-WHT' })];
    const user = userEvent.setup();
    renderPage();
    await openForm(user);
    await pick(user, 'Customer', 'Acme Energy');
    await pick(user, /Sales Invoice/, 'SI-WHT');
    for (const [label, value] of [['Paid Amount', '1000'], ['Received Amount', '980'], ['Withheld tax amount', '20']]) {
      const input = screen.getByLabelText(new RegExp(label));
      await user.clear(input);
      await user.type(input, value);
    }
    await user.type(screen.getByLabelText('Withholding-slip number'), 'WHT-001');
    await user.click(screen.getByRole('button', { name: 'Record payment' }));
    expect(hoisted.createPaymentMutate).toHaveBeenCalledWith(expect.objectContaining({
      paidAmount: 1000, receivedAmount: 980, withheldAmount: 20, withholdingSlipNumber: 'WHT-001',
      salesInvoiceId: 'si-a',
    }));
  });

  it('AC-WHT-001: an unbalanced receipt or missing slip cannot be sent', async () => {
    const user = userEvent.setup();
    renderPage();
    await openForm(user);
    await pick(user, 'Customer', 'Acme Energy');
    for (const [label, value] of [['Paid Amount', '1000'], ['Received Amount', '980'], ['Withheld tax amount', '19']]) {
      const input = screen.getByLabelText(new RegExp(label));
      await user.clear(input);
      await user.type(input, value);
    }
    await user.click(screen.getByRole('button', { name: 'Record payment' }));
    expect(hoisted.createPaymentMutate).not.toHaveBeenCalled();
    expect(screen.getAllByText(/cash received plus withheld tax must equal/i).length).toBeGreaterThan(0);
  });

  it('AC-L10N-B01 renders the Finance page title in Bahasa from the shipped catalogue', async () => {
    await financeTestI18n.changeLanguage('id');
    renderPage();
    expect(await screen.findByRole('heading', { name: 'Pembayaran Masuk' })).toBeInTheDocument();
  });

  it('AC-L10N-B01 renders the payment form section label from the shipped Bahasa catalogue', async () => {
    const user = userEvent.setup();
    renderPage();
    await openForm(user);
    await financeTestI18n.changeLanguage('id');
    expect(await screen.findByText('Detail pembayaran')).toBeInTheDocument();
  });

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
    expect(await screen.findByText('Payment created')).toBeInTheDocument();
    expect(screen.queryByText('cust-1')).not.toBeInTheDocument();
  });

  it('AC-PLC-009: rejects en-US payment amounts with excess precision before creating', async () => {
    setActiveLocale(EN_LOCALE);
    const user = userEvent.setup();
    renderPage();
    await openForm(user);
    await pick(user, 'Customer', 'Acme Energy');
    for (const label of [/Paid Amount/, /Received Amount/]) {
      const field = screen.getByLabelText(new RegExp(label));
      await user.clear(field);
      await user.type(field, '1.234');
    }
    await user.click(screen.getByRole('button', { name: 'Record payment' }));

    // The shared dialog renders BOTH a summary alert and each field's own alert; target the fields'.
    expect(
      await screen.findAllByText(/amount.*decimal/i, { selector: 'span[role="alert"]' }),
    ).toHaveLength(2);
    expect(hoisted.createPaymentMutate).not.toHaveBeenCalled();
  });

  it('AC-PLC-009: persists id-ID grouped payment amounts as 1234', async () => {
    hoisted.invoicesState.data = [invoice({ id: 'si-a', si_number: 'SI-ACME', customer_id: 'cust-1' })];
    setActiveLocale(ID_LOCALE);
    const user = userEvent.setup();
    renderPage();
    await openForm(user);
    await pick(user, 'Customer', 'Acme Energy');
    await pick(user, /Sales Invoice/, 'SI-ACME');
    for (const label of [/Paid Amount/, /Received Amount/]) {
      const field = screen.getByLabelText(new RegExp(label));
      await user.clear(field);
      await user.type(field, '1.234');
    }
    await user.click(screen.getByRole('button', { name: 'Record payment' }));

    expect(hoisted.createPaymentMutate).toHaveBeenCalledWith(
      expect.objectContaining({ paidAmount: 1234, receivedAmount: 1234 }),
    );
  });

  it('does not expose a row activation that navigates to a missing payment detail route', async () => {
    hoisted.paymentsState.data = [
      {
        id: 'ip-1',
        ip_number: 'ACC-PAY-0001',
        status: 'Scheduled',
        amount: 410000000,
        currency: 'USD',
      },
    ];
    const user = userEvent.setup();
    renderPage();

    expect(screen.queryByRole('button', { name: 'Open ACC-PAY-0001' })).not.toBeInTheDocument();
    await user.click(screen.getByText('ACC-PAY-0001'));

    expect(hoisted.navigateMock).not.toHaveBeenCalled();
  });
});
