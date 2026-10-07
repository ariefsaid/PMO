import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import React from 'react';
import { ToastProvider } from '@/src/components/ui';
import { ImpersonationProvider } from '@/src/auth/impersonation';
import type { SalesInvoiceRow } from '@/src/lib/db/revenue';

/**
 * #784 — Sales Invoices while PMO owns revenue. The form needs a project (it decides VAT, OD-TAX-4), the page says
 * invoices are raised and settled in PMO, a PMO Draft offers "Approve" to anyone but its author (real can(), no
 * stub), a part-paid PMO invoice reads "Partly paid", and once an ERP owns revenue a PMO invoice is history.
 */
const h = vi.hoisted(() => ({
  createMutate: vi.fn(async () => ({ id: 'si-new', si_number: '' })),
  submitMutate: vi.fn(async () => undefined),
  invoices: { data: [] as unknown[], isPending: false, isError: false, refetch: vi.fn() },
  route: 'pmo' as 'pmo' | 'external',
  userId: 'u-fin2',
}));
vi.mock('@/src/hooks/useErpItemOptions', () => ({ useErpItemOptions: () => ({ connected: false, loadOptions: async () => [] }) }));
vi.mock('@/src/hooks/useOrgCurrency', () => ({ useOrgCurrency: () => 'IDR' }));
vi.mock('@/src/hooks/useRevenue', () => ({
  useSalesInvoices: () => h.invoices,
  useRevenueMutations: () => ({
    create: { mutateAsync: h.createMutate, isPending: false },
    submitInvoice: { mutateAsync: h.submitMutate, isPending: false },
    cancelInvoice: { mutateAsync: vi.fn(), isPending: false },
    setReceivedDate: { mutateAsync: vi.fn(), isPending: false },
    pendingPush: { status: 'idle', lastError: null, lastPushAt: null },
  }),
}));
vi.mock('@/src/hooks/useFkOptions', () => ({
  useClientCompanyOptions: () => ({ data: [{ value: 'cust-1', label: 'Acme Energy', sub: 'Client' }] }),
  useProjectOptions: () => ({ data: [{ value: 'proj-1', label: 'Alpha Platform', sub: 'ALP-01' }] }),
}));
vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: { id: h.userId, org_id: 'org-1' }, role: 'Finance' }) }));
vi.mock('@/src/lib/adapterSeam/ownershipCache', () => ({ routeDomainWrite: vi.fn(() => h.route) }));

import SalesInvoices from '../SalesInvoices';
import { FinanceI18nTestProvider } from './financeI18nTestProvider';
import { financeTestI18n } from './financeI18nTestInstance';

const nativeInvoice = (over: Partial<SalesInvoiceRow> = {}): SalesInvoiceRow => ({
  id: 'si-n1', org_id: 'org-1', project_id: 'proj-1', customer_id: 'cust-1', customer_name: 'Acme Energy',
  si_number: null, pmo_number: null, pmo_native: true, reference_number: null, invoice_date: null,
  amount: 1_000_000, currency: 'IDR', tax_treatment: 'exclusive', tax_amount: 110_000, tax_rate: 12,
  tax_base_numerator: 11, tax_base_denominator: 12, erp_outstanding_amount: null, status: 'Draft',
  erp_docstatus: null, erp_modified: null, erp_amended_from: null, erp_cancelled_at: null,
  created_at: '2026-10-07T00:00:00Z', author_user_id: 'u-fin1', author_user_ids: ['u-fin1'],
  erp_payment_terms_days: null, erp_due_date: null, received_date: null, ...over,
}) as SalesInvoiceRow;

const renderPage = () => render(
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

async function pick(user: ReturnType<typeof userEvent.setup>, picker: string, label: string) {
  await user.click(screen.getByRole('combobox', { name: picker }));
  await user.click(await screen.findByRole('option', { name: new RegExp(label) }));
}

beforeEach(async () => {
  h.createMutate.mockClear();
  h.submitMutate.mockClear();
  h.invoices.data = [];
  h.route = 'pmo';
  h.userId = 'u-fin2';
  await financeTestI18n.changeLanguage('en');
});

describe('Sales Invoices while PMO owns revenue (#784)', () => {
  it('AC-NAR-001 the page says invoices are raised and settled in PMO', () => {
    renderPage();
    expect(screen.getByText('Client invoices raised, approved and settled in PMO.')).toBeInTheDocument();
  });

  it('AC-NAR-001 a PMO invoice needs a project — Create stays disabled until one is chosen — and sends the typed line', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getAllByRole('button', { name: /New Invoice/i })[0]);
    await pick(user, 'Customer', 'Acme Energy');
    await user.type(screen.getByLabelText(/Item code/), 'SVC');
    await user.type(screen.getByLabelText('Description'), 'Site survey');
    const rate = screen.getByLabelText(/Rate/);
    await user.clear(rate);
    await user.type(rate, '500000');
    expect(screen.getByRole('button', { name: 'Create invoice' })).toBeDisabled();
    await pick(user, 'Project', 'Alpha Platform');
    await user.click(screen.getByRole('button', { name: 'Create invoice' }));
    expect(h.createMutate).toHaveBeenCalledWith({
      customerId: 'cust-1',
      projectId: 'proj-1',
      items: [{ item_code: 'SVC', qty: 1, rate: 500000, description: 'Site survey' }],
      intent: { id: expect.any(String), idempotencyKey: expect.any(String) },
    });
  });

  it('AC-NAR-002 a PMO Draft offers "Approve" to a Finance user who did not raise it, and approving calls the approve path', async () => {
    h.invoices.data = [nativeInvoice()];
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getAllByRole('button', { name: 'Row actions' })[0]);
    await user.click(screen.getByRole('menuitem', { name: 'Approve' }));
    await user.click(screen.getByRole('button', { name: 'Approve invoice' }));
    expect(h.submitMutate).toHaveBeenCalledWith({ siId: 'si-n1', intent: expect.objectContaining({ id: expect.any(String) }) });
  });

  it('AC-NAR-002 the author of a PMO Draft is not offered "Approve"', async () => {
    h.userId = 'u-fin1';
    h.invoices.data = [nativeInvoice()];
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getAllByRole('button', { name: 'Row actions' })[0]);
    expect(screen.queryByRole('menuitem', { name: 'Approve' })).toBeNull();
  });

  it('AC-NAR-003 a part-paid PMO invoice reads "Partly paid" under its PMO number', () => {
    h.invoices.data = [nativeInvoice({ status: 'Unpaid', pmo_number: 'INV-2610070001', erp_outstanding_amount: 610_000 })];
    renderPage();
    expect(screen.getAllByText('Partly paid')[0]).toBeInTheDocument();
    expect(screen.getAllByText('INV-2610070001')[0]).toBeInTheDocument();
  });

  it('AC-NAR-004 once an ERP owns revenue, a PMO invoice reads as recorded before connect and offers no Approve or Cancel', async () => {
    h.route = 'external';
    h.invoices.data = [nativeInvoice({ status: 'Unpaid', pmo_number: 'INV-2610070001', erp_outstanding_amount: 1_110_000 })];
    const user = userEvent.setup();
    renderPage();
    expect(screen.getAllByText('Recorded in PMO before the ERP was connected')[0]).toBeInTheDocument();
    await user.click(screen.getAllByRole('button', { name: 'Row actions' })[0]);
    expect(screen.queryByRole('menuitem', { name: 'Cancel' })).toBeNull();
    expect(screen.queryByRole('menuitem', { name: 'Approve' })).toBeNull();
  });
  it('AC-NAR-003 (DD-NAR-17) a PMO invoice paid beyond its gross reads Paid and shows the overpaid excess', () => {
    h.invoices.data = [nativeInvoice({ status: 'Paid', pmo_number: 'INV-2610070001', erp_outstanding_amount: 0, overpaid_amount: 90_000 })];
    renderPage();
    expect(screen.getAllByText('Paid')[0]).toBeInTheDocument();
    expect(screen.getAllByText(/Overpaid by .*90,000/)[0]).toBeInTheDocument();
    expect(screen.queryByText('Partly paid')).toBeNull();
  });

  it('FR-NAR-009 a Paid PMO invoice offers no Cancel', async () => {
    h.invoices.data = [nativeInvoice({ status: 'Paid', pmo_number: 'INV-2610070001', erp_outstanding_amount: 0 })];
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getAllByRole('button', { name: 'Row actions' })[0]);
    expect(screen.queryByRole('menuitem', { name: 'Cancel' })).toBeNull();
  });

  it('AC-NAR-004 (DD-NAR-16) a PMO invoice frozen at connect shows what was carried into the ERP opening balance', () => {
    h.route = 'external';
    h.invoices.data = [nativeInvoice({
      status: 'Unpaid', pmo_number: 'INV-2610070001', erp_outstanding_amount: 610_000,
      erp_opening_amount: 610_000, erp_opening_at: '2026-10-07T03:00:00Z',
    })];
    renderPage();
    expect(screen.getAllByText(/Carried into the ERP opening balance: .*610,000\.00 on Oct 7, 2026/)[0]).toBeInTheDocument();
  });

  it('AC-NAR-001 an ERP-mode page keeps the ERP copy and an optional project', async () => {
    h.route = 'external';
    const user = userEvent.setup();
    renderPage();
    expect(screen.getByText(/mirrored from ERPNext/)).toBeInTheDocument();
    await user.click(screen.getAllByRole('button', { name: /New Invoice/i })[0]);
    await pick(user, 'Customer', 'Acme Energy');
    await user.type(screen.getByLabelText(/Item code/), 'SVC');
    expect(screen.getByRole('button', { name: 'Create invoice' })).toBeEnabled();
  });
});
