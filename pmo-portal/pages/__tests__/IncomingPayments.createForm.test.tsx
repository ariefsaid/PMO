import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import React from 'react';
import { ToastProvider } from '@/src/components/ui';
import { findToastAnnouncement } from '@/src/components/ui/__tests__/toastTestQueries';
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
  createPaymentMutate: vi.fn(async (_input: Record<string, unknown>) => ({ id: 'ip-new' })),
  paymentsState: { data: [] as unknown[], isPending: false, isError: false, refetch: vi.fn() },
  invoicesState: { data: [] as unknown[], isPending: false, isError: false, refetch: vi.fn() },
  ownershipState: { data: [] as unknown[], isError: false },
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
vi.mock('@/src/hooks/useExternalDomainOwnership', () => ({ useExternalDomainOwnership: () => hoisted.ownershipState }));
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
  await user.click(screen.getAllByRole('button', { name: /Receive Payment|Terima Pembayaran/i })[0]);
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
  hoisted.ownershipState.data = [{ id: 'o-1', orgId: 'org-1', externalTier: 'erpnext', domain: 'revenue' }];
  setActiveLocale(EN_LOCALE);
  await financeTestI18n.changeLanguage('en');
});
afterEach(() => resetActiveLocale());

describe('IncomingPayments — a Finance user can actually record a receipt (BLOCK 1)', () => {
  it('AC-S27-001: labels settlement and cash plainly, and keeps native no-withholding prefill in the existing payload', async () => {
    hoisted.ownershipState.data = [];
    hoisted.invoicesState.data = [invoice({
      id: 'si-native',
      si_number: 'SI-NATIVE',
      pmo_native: true,
      erp_outstanding_amount: 111_000,
    })];
    const user = userEvent.setup();
    renderPage();
    await openForm(user);
    const settled = screen.getByLabelText(/^Amount settled/);
    const cash = screen.getByLabelText(/^Cash received/);
    const disclosure = screen.getByRole('button', { name: 'Tax withheld' });
    expect(disclosure).toHaveAttribute('aria-expanded', 'false');
    const panelId = disclosure.getAttribute('aria-controls');
    expect(panelId).toBeTruthy();
    expect(document.getElementById(panelId!)).toHaveAttribute('hidden');

    await pick(user, 'Customer', 'Acme Energy');
    await pick(user, /Sales Invoice/, 'SI-NATIVE');
    expect(screen.queryByText(/Amount settled is the invoice balance covered/)).not.toBeInTheDocument();
    expect(screen.getByText(/Starts at the .*111,000.* outstanding/)).toBeInTheDocument();
    expect(settled).toHaveValue('111,000');
    expect(cash).toHaveValue('111,000');

    await user.click(screen.getByRole('button', { name: 'Record payment' }));
    const submitted = hoisted.createPaymentMutate.mock.calls.at(-1)?.[0];
    expect(submitted).toMatchObject({
      customerId: 'cust-1', salesInvoiceId: 'si-native', paidAmount: 111_000, receivedAmount: 111_000,
    });
    expect(Object.keys(submitted ?? {}).sort()).toEqual([
      'customerId', 'date', 'intent', 'paidAmount', 'receivedAmount', 'salesInvoiceId',
    ]);
  });

  it('AC-S27-002: collapsing withholding retains the deduction, evidence, summary, and exact receipt values', async () => {
    hoisted.invoicesState.data = [invoice({ id: 'si-s27', si_number: 'SI-S27' })];
    const user = userEvent.setup();
    renderPage();
    await openForm(user);
    await pick(user, 'Customer', 'Acme Energy');
    await pick(user, /Sales Invoice/, 'SI-S27');

    for (const [label, value] of [['Amount settled', '1110'], ['Cash received', '1000']] as const) {
      const field = screen.getByLabelText(new RegExp(label));
      await user.clear(field);
      await user.type(field, value);
    }
    const disclosure = screen.getByRole('button', { name: 'Tax withheld' });
    await user.click(disclosure);
    const withheld = screen.getByLabelText(/Withheld tax amount/);
    const slip = screen.getByLabelText('Withholding-slip number');
    await user.clear(withheld);
    await user.type(withheld, '110');
    await user.type(slip, 'SYN-WHT-27');

    await user.click(disclosure);
    expect(disclosure).toHaveAttribute('aria-expanded', 'false');
    expect(withheld).not.toBeVisible();
    expect(slip).not.toBeVisible();
    expect(screen.getByText('Tax withheld: $110')).toBeInTheDocument();
    expect(screen.getByText('Withholding slip: SYN-WHT-27')).toBeInTheDocument();

    await user.click(disclosure);
    expect(withheld).toHaveValue('110');
    expect(slip).toHaveValue('SYN-WHT-27');
    await user.click(disclosure);
    await user.click(screen.getByRole('button', { name: 'Record payment' }));

    const submitted = hoisted.createPaymentMutate.mock.calls.at(-1)?.[0];
    expect(submitted).toMatchObject({
      customerId: 'cust-1', salesInvoiceId: 'si-s27', paidAmount: 1110,
      receivedAmount: 1000, withheldAmount: 110, withholdingSlipNumber: 'SYN-WHT-27',
    });
    expect(Object.keys(submitted ?? {}).sort()).toEqual([
      'customerId', 'date', 'intent', 'paidAmount', 'receivedAmount', 'salesInvoiceId',
      'withheldAmount', 'withholdingSlipNumber',
    ]);
  });

  it('AC-S27-003: a native reconciliation error reveals the collapsed withholding evidence', async () => {
    hoisted.ownershipState.data = [];
    hoisted.invoicesState.data = [invoice({ id: 'si-native-mismatch', si_number: 'SI-NATIVE-MISMATCH', pmo_native: true })];
    const user = userEvent.setup();
    renderPage();
    await openForm(user);
    await pick(user, 'Customer', 'Acme Energy');
    await pick(user, /Sales Invoice/, 'SI-NATIVE-MISMATCH');

    for (const [label, value] of [['Amount settled', '1110'], ['Cash received', '1000']] as const) {
      const field = screen.getByLabelText(new RegExp(label));
      await user.clear(field);
      await user.type(field, value);
    }
    const disclosure = screen.getByRole('button', { name: 'Tax withheld' });
    await user.click(disclosure);
    const withheld = screen.getByLabelText(/Withheld tax amount/);
    await user.clear(withheld);
    await user.type(withheld, '109');
    await user.type(screen.getByLabelText('Withholding-slip number'), 'SYN-WHT-27');
    await user.click(disclosure);
    await user.click(screen.getByRole('button', { name: 'Record payment' }));

    expect(hoisted.createPaymentMutate).not.toHaveBeenCalled();
    expect(disclosure).toHaveAttribute('aria-expanded', 'true');
    expect(withheld).toBeVisible();
    expect((await screen.findAllByText(/cash received plus withheld tax must equal/i)).length).toBeGreaterThan(0);
  });

  it('AC-S27-003: missing withholding evidence reveals and focuses the slip field before save', async () => {
    hoisted.ownershipState.data = [];
    hoisted.invoicesState.data = [invoice({ id: 'si-native-slip', si_number: 'SI-NATIVE-SLIP', pmo_native: true })];
    const user = userEvent.setup();
    renderPage();
    await openForm(user);
    await pick(user, 'Customer', 'Acme Energy');
    await pick(user, /Sales Invoice/, 'SI-NATIVE-SLIP');
    for (const [label, value] of [['Amount settled', '1110'], ['Cash received', '1000']] as const) {
      const field = screen.getByLabelText(new RegExp(label));
      await user.clear(field);
      await user.type(field, value);
    }
    const disclosure = screen.getByRole('button', { name: 'Tax withheld' });
    await user.click(disclosure);
    const withheld = screen.getByLabelText(/Withheld tax amount/);
    await user.clear(withheld);
    await user.type(withheld, '110');
    const slip = screen.getByLabelText('Withholding-slip number');
    await user.click(disclosure);
    await user.click(screen.getByRole('button', { name: 'Record payment' }));

    expect(hoisted.createPaymentMutate).not.toHaveBeenCalled();
    expect(disclosure).toHaveAttribute('aria-expanded', 'true');
    expect(slip).toBeVisible();
    expect((await screen.findAllByText(/enter a withholding-slip number/i)).length).toBeGreaterThan(0);
    expect(document.activeElement).toBe(slip);
  });

  it.each([
    ['-1', /withheld tax must be non-negative/i],
    ['1.234', /withheld tax must be non-negative/i],
  ])('AC-S27-003: refuses invalid withheld amount %s without sending a receipt', async (value, error) => {
    const user = userEvent.setup();
    renderPage();
    await openForm(user);
    await pick(user, 'Customer', 'Acme Energy');
    for (const [label, amount] of [['Amount settled', '1000'], ['Cash received', '1000']] as const) {
      const field = screen.getByLabelText(new RegExp(label));
      await user.clear(field);
      await user.type(field, amount);
    }
    const disclosure = screen.getByRole('button', { name: 'Tax withheld' });
    await user.click(disclosure);
    const withheld = screen.getByLabelText(/Withheld tax amount/);
    await user.clear(withheld);
    await user.type(withheld, value);
    await user.click(disclosure);
    await user.click(screen.getByRole('button', { name: 'Record payment' }));

    expect(hoisted.createPaymentMutate).not.toHaveBeenCalled();
    expect(disclosure).toHaveAttribute('aria-expanded', 'true');
    expect(withheld).toBeVisible();
    expect((await screen.findAllByText(error)).length).toBeGreaterThan(0);
  });

  it('AC-S27-003: accepts an existing partial settlement with recorded withholding', async () => {
    hoisted.ownershipState.data = [];
    hoisted.invoicesState.data = [invoice({ id: 'si-partial', si_number: 'SI-PARTIAL', pmo_native: true })];
    const user = userEvent.setup();
    renderPage();
    await openForm(user);
    await pick(user, 'Customer', 'Acme Energy');
    await pick(user, /Sales Invoice/, 'SI-PARTIAL');
    for (const [label, value] of [['Amount settled', '555'], ['Cash received', '500']] as const) {
      const field = screen.getByLabelText(new RegExp(label));
      await user.clear(field);
      await user.type(field, value);
    }
    await user.click(screen.getByRole('button', { name: 'Tax withheld' }));
    await user.type(screen.getByLabelText(/Withheld tax amount/), '55');
    await user.type(screen.getByLabelText('Withholding-slip number'), 'SYN-WHT-27');
    await user.click(screen.getByRole('button', { name: 'Record payment' }));

    expect(hoisted.createPaymentMutate).toHaveBeenCalledWith(expect.objectContaining({
      salesInvoiceId: 'si-partial', paidAmount: 555, receivedAmount: 500,
      withheldAmount: 55, withholdingSlipNumber: 'SYN-WHT-27',
    }));
  });

  it('AC-S27-005: keeps the same receipt intent and entered values after a rejected save, then retries', async () => {
    hoisted.createPaymentMutate.mockRejectedValueOnce(new Error('Synthetic retryable failure'));
    const user = userEvent.setup();
    renderPage();
    await openForm(user);
    await pick(user, 'Customer', 'Acme Energy');
    for (const [label, value] of [['Amount settled', '750'], ['Cash received', '750']] as const) {
      const field = screen.getByLabelText(new RegExp(label));
      await user.clear(field);
      await user.type(field, value);
    }
    await user.click(screen.getByRole('button', { name: 'Record payment' }));
    await screen.findByTestId('entity-modal-save-error');

    const settled = screen.getByLabelText(/^Amount settled/);
    const cash = screen.getByLabelText(/^Cash received/);
    expect(settled).toHaveValue('750');
    expect(cash).toHaveValue('750');
    const firstIntent = hoisted.createPaymentMutate.mock.calls[0]?.[0].intent;
    await user.click(screen.getByRole('button', { name: 'Record payment' }));
    expect(hoisted.createPaymentMutate).toHaveBeenCalledTimes(2);
    expect(hoisted.createPaymentMutate.mock.calls[1]?.[0].intent).toEqual(firstIntent);
  });

  it('AC-S27-005: cancel confirms dirty discard and reopening starts with no old withholding', async () => {
    const user = userEvent.setup();
    renderPage();
    await openForm(user);
    await pick(user, 'Customer', 'Acme Energy');
    const disclosure = screen.getByRole('button', { name: 'Tax withheld' });
    await user.click(disclosure);
    await user.type(screen.getByLabelText(/Withheld tax amount/), '20');
    await user.type(screen.getByLabelText('Withholding-slip number'), 'SYN-WHT-27');
    await user.click(screen.getByRole('button', { name: /^Cancel$/ }));
    await screen.findByText('Discard your changes?');
    await user.click(screen.getByRole('button', { name: /^Discard$/ }));

    expect(screen.queryByRole('dialog', { name: /Receive Payment/i })).not.toBeInTheDocument();
    await openForm(user);
    const reopenedDisclosure = screen.getByRole('button', { name: 'Tax withheld' });
    expect(reopenedDisclosure).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByLabelText(/^Amount settled/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Withheld tax amount/)).not.toBeVisible();
  });

  it('AC-S27-005: shows the settlement and withholding disclosure in Bahasa Indonesia', async () => {
    setActiveLocale(ID_LOCALE);
    await financeTestI18n.changeLanguage('id');
    const user = userEvent.setup();
    renderPage();
    await openForm(user);

    expect(screen.getByLabelText(/^Jumlah yang dilunasi/)).toBeInTheDocument();
    expect(screen.getByLabelText(/^Kas diterima/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Pajak dipotong' })).toHaveAttribute('aria-expanded', 'false');
  });

  it('AC-WHT-001: records cash received and the client withholding slip against the full allocation', async () => {
    hoisted.invoicesState.data = [invoice({ id: 'si-a', si_number: 'SI-WHT' })];
    const user = userEvent.setup();
    renderPage();
    await openForm(user);
    await pick(user, 'Customer', 'Acme Energy');
    await pick(user, /Sales Invoice/, 'SI-WHT');
    for (const [label, value] of [['Amount settled', '1000'], ['Cash received', '980']] as const) {
      const input = screen.getByLabelText(new RegExp(label));
      await user.clear(input);
      await user.type(input, value);
    }
    await user.click(screen.getByRole('button', { name: 'Tax withheld' }));
    const withheld = screen.getByLabelText(/Withheld tax amount/);
    await user.clear(withheld);
    await user.type(withheld, '20');
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
    for (const [label, value] of [['Amount settled', '1000'], ['Cash received', '980']] as const) {
      const input = screen.getByLabelText(new RegExp(label));
      await user.clear(input);
      await user.type(input, value);
    }
    await user.click(screen.getByRole('button', { name: 'Tax withheld' }));
    const withheld = screen.getByLabelText(/Withheld tax amount/);
    await user.clear(withheld);
    await user.type(withheld, '19');
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
    const paid = screen.getByLabelText(/Amount settled/);
    await user.clear(paid);
    await user.type(paid, '750');
    const received = screen.getByLabelText(/Cash received/);
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
    expect(await findToastAnnouncement('status', 'Payment created')).toBeInTheDocument();
    expect(screen.queryByText('cust-1')).not.toBeInTheDocument();
  });

  it('AC-PLC-009: rejects en-US payment amounts with excess precision before creating', async () => {
    setActiveLocale(EN_LOCALE);
    const user = userEvent.setup();
    renderPage();
    await openForm(user);
    await pick(user, 'Customer', 'Acme Energy');
    for (const label of [/Amount settled/, /Cash received/]) {
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
    for (const label of [/Amount settled/, /Cash received/]) {
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
