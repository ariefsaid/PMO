import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import React from 'react';
import { ToastProvider } from '@/src/components/ui';
import { ImpersonationProvider } from '@/src/auth/impersonation';

/**
 * SalesInvoices — the create-invoice journey (read-model audit BLOCK 1 + 1b).
 *
 * Before the fix a Finance user could NOT raise an invoice from PMO at all: all four money
 * pickers were `loadOptions={async () => []}` stubs, so `customerId` could never leave '' (the
 * Combobox only emits on select), `isComplete` stayed false and "Create invoice" was permanently
 * disabled. And the line items lived in a DETACHED `useState`, so whatever the user typed never
 * reached the submitted `values.lineItems` — a $50,000 invoice would have posted as $0.
 *
 * These tests drive the real journey: open the form, pick a real customer, type a real line item,
 * submit, and assert what the mutation actually receives.
 *
 * NOTE: the affordance gate is stubbed here — this file tests the FORM, not the gate. The gate is
 * owned by src/auth/policy.test.ts (`create salesInvoice` = Finance + Admin, owner ruling 2026-07-20).
 */

const hoisted = vi.hoisted(() => ({
  createMutate: vi.fn(async () => ({ id: 'si-new', si_number: 'ACC-SINV-0001' })),
  salesInvoicesState: { data: [] as unknown[], isPending: false, isError: false, refetch: vi.fn() },
  navigateMock: vi.fn(),
  clientOptions: [
    { value: 'cust-1', label: 'Acme Energy', sub: 'Client' },
    { value: 'cust-2', label: 'Borealis Marine', sub: 'Client' },
  ],
  projectOptions: [{ value: 'proj-1', label: 'Alpha Platform', sub: 'ALP-01' }],
  connected: false,
}));
vi.mock('@/src/hooks/useErpItemOptions', () => ({ useErpItemOptions: () => ({ connected: hoisted.connected, loadOptions: async () => [{ value: 'ITEM-TEST', label: 'ITEM-TEST', sub: 'Test service' }] }) }));

// #731: the create form's money adornment reads the org currency. Pinned here rather than left to a
// real query. ⚑ At LINE-START — inside a neighbouring vi.mock it parses as a syntax error.
vi.mock('@/src/hooks/useOrgCurrency', () => ({ useOrgCurrency: () => 'USD' }));
vi.mock('@/src/hooks/useRevenue', () => ({
  useSalesInvoices: () => hoisted.salesInvoicesState,
  useRevenueMutations: () => ({
    create: { mutateAsync: hoisted.createMutate, isPending: false },
    submitInvoice: { mutateAsync: vi.fn(), isPending: false },
    cancelInvoice: { mutateAsync: vi.fn(), isPending: false },
    pendingPush: { status: 'idle', lastError: null, lastPushAt: null },
  }),
}));

vi.mock('@/src/hooks/useFkOptions', () => ({
  useClientCompanyOptions: () => ({ data: hoisted.clientOptions }),
  useProjectOptions: () => ({ data: hoisted.projectOptions }),
}));

vi.mock('@/src/auth/usePermission', () => ({
  usePermission: () => () => true,
}));

vi.mock('@/src/auth/useAuth', () => ({
  useAuth: () => ({ currentUser: { id: 'u-fin', org_id: 'org-1' }, role: 'Finance' }),
}));

vi.mock('@/src/lib/adapterSeam/ownershipCache', () => ({ routeDomainWrite: vi.fn(() => 'pmo') }));
vi.mock('react-router', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router')>();
  return { ...actual, useNavigate: () => hoisted.navigateMock };
});

import SalesInvoices from '../SalesInvoices';
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
            <SalesInvoices />
          </ToastProvider>
        </MemoryRouter>
      </ImpersonationProvider>
    </FinanceI18nTestProvider>,
  );

/** Opens the create form (the header action; the empty state offers the same button). */
async function openForm(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getAllByRole('button', { name: /New Invoice/i })[0]);
}

/** Picks `label` in the named picker. */
async function pick(user: ReturnType<typeof userEvent.setup>, picker: string, label: string) {
  await user.click(screen.getByRole('combobox', { name: picker }));
  const option = await screen.findByRole('option', { name: new RegExp(label) });
  await user.click(option);
}

beforeEach(async () => {
  hoisted.createMutate.mockClear();
  hoisted.navigateMock.mockClear();
  hoisted.salesInvoicesState.data = [];
  hoisted.connected = false;
  setActiveLocale(EN_LOCALE);
  await financeTestI18n.changeLanguage('en');
});
afterEach(() => resetActiveLocale());

describe('SalesInvoices — a Finance user can actually raise an invoice (BLOCK 1)', () => {
  it('keeps the status filters inside a keyboard-accessible horizontal region', async () => {
    renderPage();

    const filterRegion = screen.getByRole('region', { name: 'Filter by status' });
    expect(filterRegion).toHaveAttribute('tabindex', '0');
    expect(filterRegion).toHaveClass('max-w-full', 'overflow-x-auto');
    expect(within(filterRegion).getByRole('tablist', { name: 'Filter by status' })).toBeInTheDocument();
  });

  it('groups the invoice amount and its tax-basis note for narrow card layouts', () => {
    hoisted.salesInvoicesState.data = [
      {
        id: 'si-1',
        si_number: 'ACC-SINV-0001',
        status: 'Draft',
        amount: 12345678900,
        currency: 'IDR',
        tax_treatment: 'exclusive',
        tax_rate: 11,
        erp_docstatus: 1,
      },
    ];
    renderPage();

    const taxBasis = screen.getByText(/excl\. PPN/);
    expect(taxBasis.parentElement).toHaveClass('w-full', 'flex-col', 'items-end');
  });

  it('AC-L10N-B01 renders the Finance page title in Bahasa from the shipped catalogue', async () => {
    await financeTestI18n.changeLanguage('id');
    renderPage();
    expect(await screen.findByRole('heading', { name: 'Faktur Penjualan' })).toBeInTheDocument();
  });

  it('AC-L10N-B01 renders invoice form section labels from the shipped Bahasa catalogue', async () => {
    const user = userEvent.setup();
    renderPage();
    await openForm(user);
    await financeTestI18n.changeLanguage('id');
    expect(await screen.findByText('Detail faktur')).toBeInTheDocument();
    expect(screen.getByText('Item faktur')).toBeInTheDocument();
  });

  it('AC-ITM-001/002 connected invoice searches ERP item name and submits separate authored description', async () => {
    hoisted.connected = true;
    const user = userEvent.setup();
    renderPage();
    await openForm(user);
    await pick(user, 'Customer', 'Acme Energy');
    await user.click(screen.getByRole('combobox', { name: 'ERP item' }));
    await user.type(screen.getByRole('searchbox', { name: /ERP items/i }), 'Test service');
    await user.click(await screen.findByRole('option', { name: /ITEM-TEST/ }));
    await user.type(screen.getByLabelText('Description'), 'Inspection of test unit');
    await user.clear(screen.getByLabelText(/Rate/));
    await user.type(screen.getByLabelText(/Rate/), '100');
    await user.click(screen.getByRole('button', { name: /Create invoice/i }));
    expect(hoisted.createMutate).toHaveBeenCalledWith(expect.objectContaining({ items: [{ item_code: 'ITEM-TEST', description: 'Inspection of test unit', qty: 1, rate: 100 }] }));
  });

  it('AC-ITM-004 standalone invoices retain the free-text item code field', async () => {
    const user = userEvent.setup();
    renderPage();
    await openForm(user);
    expect(screen.getByLabelText(/Item code/)).toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: 'ERP item' })).not.toBeInTheDocument();
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

  it('offers the org\'s real projects in the project picker', async () => {
    const user = userEvent.setup();
    renderPage();
    await openForm(user);

    await user.click(screen.getByRole('combobox', { name: 'Project' }));

    expect(await screen.findByRole('option', { name: /Alpha Platform/ })).toBeInTheDocument();
  });

  it('enables "Create invoice" once a customer is chosen (it was permanently disabled)', async () => {
    const user = userEvent.setup();
    renderPage();
    await openForm(user);

    const submit = screen.getByRole('button', { name: 'Create invoice' });
    expect(submit).toBeDisabled();

    await pick(user, 'Customer', 'Acme Energy');

    expect(screen.getByRole('button', { name: 'Create invoice' })).toBeEnabled();
  });

  it('submits the line items the USER typed — never the untouched $0 stub (BLOCK 1b)', async () => {
    const user = userEvent.setup();
    renderPage();
    await openForm(user);

    await pick(user, 'Customer', 'Acme Energy');
    await pick(user, 'Project', 'Alpha Platform');

    await user.type(screen.getByLabelText(/Item code/), 'ITEM-001');
    const qty = screen.getByLabelText(/Qty/);
    await user.clear(qty);
    await user.type(qty, '2');
    const rate = screen.getByLabelText(/Rate/);
    await user.clear(rate);
    await user.type(rate, '25000');

    await user.click(screen.getByRole('button', { name: 'Create invoice' }));

    expect(hoisted.createMutate).toHaveBeenCalledWith({
      customerId: 'cust-1',
      projectId: 'proj-1',
      items: [{ item_code: 'ITEM-001', qty: 2, rate: 25000 }],
      // BLOCK 2 (ADR-0058): the form session's command identity rides along with the body.
      intent: { id: expect.any(String), idempotencyKey: expect.any(String) },
    });
  });

  it('AC-PLC-009: rejects an en-US sales-invoice rate with excess precision before creating', async () => {
    setActiveLocale(EN_LOCALE);
    const user = userEvent.setup();
    renderPage();
    await openForm(user);
    await pick(user, 'Customer', 'Acme Energy');
    await user.type(screen.getByLabelText(/Item code/), 'ITEM-001');
    const rate = screen.getByLabelText(/Rate/);
    await user.clear(rate);
    await user.type(rate, '1.234');
    await user.click(screen.getByRole('button', { name: 'Create invoice' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/rate|decimal/i);
    expect(hoisted.createMutate).not.toHaveBeenCalled();
  });

  it('AC-PLC-009: persists an id-ID grouped sales-invoice rate as 1234', async () => {
    setActiveLocale(ID_LOCALE);
    const user = userEvent.setup();
    renderPage();
    await openForm(user);
    await pick(user, 'Customer', 'Acme Energy');
    await user.type(screen.getByLabelText(/Item code/), 'ITEM-001');
    const rate = screen.getByLabelText(/Rate/);
    await user.clear(rate);
    await user.type(rate, '1.234');
    await user.click(screen.getByRole('button', { name: 'Create invoice' }));

    expect(hoisted.createMutate).toHaveBeenCalledWith(
      expect.objectContaining({ items: [{ item_code: 'ITEM-001', qty: 1, rate: 1234 }] }),
    );
  });

  it('submits every line the user added, not just the first', async () => {
    const user = userEvent.setup();
    renderPage();
    await openForm(user);

    await pick(user, 'Customer', 'Acme Energy');
    await user.type(screen.getByLabelText(/Item code/), 'ITEM-001');
    await user.click(screen.getByRole('button', { name: /Add line item/i }));

    const codes = screen.getAllByLabelText(/Item code/);
    expect(codes).toHaveLength(2);
    await user.type(codes[1], 'ITEM-002');

    await user.click(screen.getByRole('button', { name: 'Create invoice' }));

    expect(hoisted.createMutate).toHaveBeenCalledWith(
      expect.objectContaining({
        items: [
          { item_code: 'ITEM-001', qty: 1, rate: 0 },
          { item_code: 'ITEM-002', qty: 1, rate: 0 },
        ],
      }),
    );
  });

  it('does not expose a row activation that navigates to a missing invoice detail route', async () => {
    hoisted.salesInvoicesState.data = [
      {
        id: 'si-1',
        si_number: 'ACC-SINV-0001',
        status: 'Draft',
        amount: 410000000,
        currency: 'USD',
        tax_treatment: 'exclusive',
      },
    ];
    const user = userEvent.setup();
    renderPage();

    expect(screen.queryByRole('button', { name: 'Open ACC-SINV-0001' })).not.toBeInTheDocument();
    await user.click(screen.getByText('ACC-SINV-0001'));

    expect(hoisted.navigateMock).not.toHaveBeenCalled();
  });
});
