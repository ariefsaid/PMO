import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
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
  /** null = ownership still loading; otherwise derived from `route`. */
  ownershipLoaded: true,
  userId: 'u-fin2',
  toast: vi.fn(),
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
  useClientCompanyOptions: () => ({ data: [{ value: 'cust-1', label: 'Acme Energy', sub: 'Client' }, { value: 'cust-2', label: 'Borealis Marine', sub: 'Client' }] }),
  useInvoiceProjectOptions: () => ({ data: [
    { value: 'proj-1', label: 'Alpha Platform', sub: 'ALP-01', clientId: 'cust-1', subjectToVat: true, taxRate: 12, archived: false },
    { value: 'proj-2', label: 'Beta Norates', sub: 'BNR-01', clientId: 'cust-1', subjectToVat: true, taxRate: null, archived: false },
    { value: 'proj-3', label: 'Gamma Other Client', sub: 'GOC-01', clientId: 'cust-2', subjectToVat: false, taxRate: null, archived: false },
    { value: 'proj-4', label: 'Delta Archived', sub: 'DAR-01', clientId: 'cust-1', subjectToVat: false, taxRate: null, archived: true },
  ] }),
}));
vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: { id: h.userId, org_id: 'org-1' }, role: 'Finance' }) }));
vi.mock('@/src/lib/adapterSeam/ownershipCache', () => ({ routeDomainWrite: vi.fn(() => h.route) }));
vi.mock('@/src/hooks/useExternalDomainOwnership', () => ({ useExternalDomainOwnership: () => ({
  data: !h.ownershipLoaded ? undefined : h.route === 'external' ? [{ id: 'o-1', orgId: 'org-1', externalTier: 'erpnext', domain: 'revenue' }] : [],
  isError: false,
}) }));
vi.mock('@/src/components/ui', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/src/components/ui')>();
  return { ...real, useToast: () => ({ toast: h.toast }) };
});

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

/** The one list row (table row or phone card) whose text matches — never "the first of several matches". */
function rowFor(text: string | RegExp): HTMLElement {
  const branch = screen.queryByTestId('dt-table-branch') ?? screen.getByTestId('dt-card-branch');
  const rows = within(branch).queryAllByRole('row').length > 0 ? within(branch).getAllByRole('row') : within(branch).getAllByRole('listitem');
  const hits = rows.filter((r) => (typeof text === 'string' ? r.textContent?.includes(text) : text.test(r.textContent ?? '')));
  expect(hits).toHaveLength(1);
  return hits[0];
}

async function openMenu(user: ReturnType<typeof userEvent.setup>, row: HTMLElement) {
  await user.click(within(row).getByRole('button', { name: 'Row actions' }));
}

const page = () => (
  <FinanceI18nTestProvider>
    <ImpersonationProvider realRole="Finance">
      <MemoryRouter>
        <ToastProvider>
          <SalesInvoices />
        </ToastProvider>
      </MemoryRouter>
    </ImpersonationProvider>
  </FinanceI18nTestProvider>
);
const renderPage = () => render(page());

async function pick(user: ReturnType<typeof userEvent.setup>, picker: string, label: string) {
  await user.click(screen.getByRole('combobox', { name: picker }));
  await user.click(await screen.findByRole('option', { name: new RegExp(label) }));
}

beforeEach(async () => {
  h.createMutate.mockClear();
  h.submitMutate.mockClear();
  h.invoices.data = [];
  h.route = 'pmo';
  h.ownershipLoaded = true;
  h.userId = 'u-fin2';
  h.toast.mockClear();
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
    await openMenu(user, rowFor('Acme Energy'));
    await user.click(screen.getByRole('menuitem', { name: 'Approve' }));
    await user.click(screen.getByRole('button', { name: 'Approve invoice' }));
    expect(h.submitMutate).toHaveBeenCalledWith({ siId: 'si-n1', intent: expect.objectContaining({ id: expect.any(String) }) });
  });

  it('AC-NAR-002 the author of a PMO Draft is not offered "Approve"', async () => {
    h.userId = 'u-fin1';
    h.invoices.data = [nativeInvoice()];
    const user = userEvent.setup();
    renderPage();
    await openMenu(user, rowFor('Acme Energy'));
    expect(screen.queryByRole('menuitem', { name: 'Approve' })).toBeNull();
  });

  it('AC-NAR-003 a part-paid PMO invoice reads "Partly paid" under its PMO number', () => {
    h.invoices.data = [nativeInvoice({ status: 'Unpaid', pmo_number: 'INV-2610070001', erp_outstanding_amount: 610_000 })];
    renderPage();
    const row = rowFor('INV-2610070001');
    expect(within(row).getByText('Partly paid')).toBeInTheDocument();
  });

  it('AC-NAR-004 once an ERP owns revenue, a PMO invoice reads as recorded before connect and offers no Approve or Cancel', async () => {
    h.route = 'external';
    h.invoices.data = [nativeInvoice({ status: 'Unpaid', pmo_number: 'INV-2610070001', erp_outstanding_amount: 1_110_000 })];
    const user = userEvent.setup();
    renderPage();
    const row = rowFor('INV-2610070001');
    // M-3: a compact badge; the full sentence stays available as its tooltip and to a screen reader.
    const badge = within(row).getByText('Pre-ERP');
    expect(badge.closest('[title]')).toHaveAttribute('title', 'Recorded in PMO before the ERP was connected');
    expect(within(row).getByText(/Recorded in PMO before the ERP was connected/)).toHaveClass('sr-only');
    await openMenu(user, row);
    expect(screen.queryByRole('menuitem', { name: 'Cancel' })).toBeNull();
    expect(screen.queryByRole('menuitem', { name: 'Approve' })).toBeNull();
  });
  it('AC-NAR-003 (DD-NAR-17) a PMO invoice paid beyond its gross reads Paid and shows the overpaid excess', () => {
    h.invoices.data = [nativeInvoice({ status: 'Paid', pmo_number: 'INV-2610070001', erp_outstanding_amount: 0, overpaid_amount: 90_000 })];
    renderPage();
    const row = rowFor('INV-2610070001');
    expect(within(row).getByText('Paid')).toBeInTheDocument();
    expect(within(row).getByText(/Overpaid by .*90,000/)).toBeInTheDocument();
    expect(within(row).queryByText('Partly paid')).toBeNull();
  });

  it('FR-NAR-009 a Paid PMO invoice offers no Cancel', async () => {
    h.invoices.data = [nativeInvoice({ status: 'Paid', pmo_number: 'INV-2610070001', erp_outstanding_amount: 0 })];
    const user = userEvent.setup();
    renderPage();
    await openMenu(user, rowFor('INV-2610070001'));
    expect(screen.queryByRole('menuitem', { name: 'Cancel' })).toBeNull();
  });

  it('AC-NAR-004 (DD-NAR-16) a PMO invoice frozen at connect shows what was carried into the ERP opening balance', () => {
    h.route = 'external';
    h.invoices.data = [nativeInvoice({
      status: 'Unpaid', pmo_number: 'INV-2610070001', erp_outstanding_amount: 610_000,
      erp_opening_amount: 610_000, erp_opening_at: '2026-10-07T03:00:00Z',
    })];
    renderPage();
    expect(within(rowFor('INV-2610070001')).getByText(/Carried into the ERP opening balance: .*610,000\.00 on Oct 7, 2026/)).toBeInTheDocument();
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

  it('#784 (item 7) the page waits for ownership, then switches to the ERP mode it loads — no PMO-mode flash', () => {
    h.ownershipLoaded = false;
    h.route = 'external';
    const { rerender } = renderPage();
    expect(screen.queryByText('Client invoices raised, approved and settled in PMO.')).toBeNull();
    expect(screen.queryByText(/mirrored from ERPNext/)).toBeNull();
    expect(screen.queryByRole('button', { name: /New Invoice/i })).toBeNull();
    h.ownershipLoaded = true;
    rerender(page());
    expect(screen.getByText(/mirrored from ERPNext/)).toBeInTheDocument();
    expect(screen.queryByText('Client invoices raised, approved and settled in PMO.')).toBeNull();
  });

  it('FR-NAR-002 (I-3) a PMO line needs an item code OR a description — a description alone is enough', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getAllByRole('button', { name: /New Invoice/i })[0]);
    await pick(user, 'Customer', 'Acme Energy');
    await pick(user, 'Project', 'Alpha Platform');
    await user.type(screen.getByLabelText('Description'), 'Site survey');
    const rate = screen.getByLabelText(/Rate/);
    await user.clear(rate);
    await user.type(rate, '500000');
    expect(screen.getByLabelText(/Item code/)).not.toBeRequired();
    await user.click(screen.getByRole('button', { name: 'Create invoice' }));
    expect(h.createMutate).toHaveBeenCalledWith(expect.objectContaining({
      items: [{ item_code: '', qty: 1, rate: 500000, description: 'Site survey' }],
    }));
  });

  it('FR-NAR-002 (I-3) a PMO line with neither an item code nor a description is refused before the round trip', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getAllByRole('button', { name: /New Invoice/i })[0]);
    await pick(user, 'Customer', 'Acme Energy');
    await pick(user, 'Project', 'Alpha Platform');
    const rate = screen.getByLabelText(/Rate/);
    await user.clear(rate);
    await user.type(rate, '500000');
    await user.click(screen.getByRole('button', { name: 'Create invoice' }));
    expect((await screen.findAllByText('Line 1: Enter an item code or a description.')).length).toBeGreaterThan(0);
    expect(h.createMutate).not.toHaveBeenCalled();
  });

  it('AC-NAR-001 (M-1) the project picker offers only the chosen customer\'s live projects', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getAllByRole('button', { name: /New Invoice/i })[0]);
    await pick(user, 'Customer', 'Acme Energy');
    await user.click(screen.getByRole('combobox', { name: 'Project' }));
    const list = await screen.findByRole('listbox');
    expect(within(list).getByRole('option', { name: /Alpha Platform/ })).toBeInTheDocument();
    expect(within(list).queryByRole('option', { name: /Gamma Other Client/ })).toBeNull();
    expect(within(list).queryByRole('option', { name: /Delta Archived/ })).toBeNull();
  });

  it('DD-TAX-4a (I-2) a VAT project with no recorded rate is flagged in the form before submit, with a way to record it', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getAllByRole('button', { name: /New Invoice/i })[0]);
    await pick(user, 'Customer', 'Acme Energy');
    await pick(user, 'Project', 'Beta Norates');
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getAllByText(/This project has no VAT rate recorded/).length).toBeGreaterThan(0);
    expect(within(dialog).getByRole('link', { name: /Record the VAT rate on the project/ })).toHaveAttribute('href', '/projects/proj-2');
    await user.type(screen.getByLabelText('Description'), 'Site survey');
    await user.click(screen.getByRole('button', { name: 'Create invoice' }));
    expect(h.createMutate).not.toHaveBeenCalled();
  });

  it('DD-TAX-4a (I-2) a server vat-rate-missing refusal is shown ONCE (in the dialog, no toast) with a link to the project', async () => {
    const { AppError } = await import('@/src/lib/appError');
    h.createMutate.mockRejectedValueOnce(new AppError('this project is subject to VAT but has no VAT rate recorded', 'vat-rate-missing'));
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getAllByRole('button', { name: /New Invoice/i })[0]);
    await pick(user, 'Customer', 'Acme Energy');
    await pick(user, 'Project', 'Alpha Platform');
    await user.type(screen.getByLabelText('Description'), 'Site survey');
    await user.click(screen.getByRole('button', { name: 'Create invoice' }));
    const banner = await screen.findByTestId('entity-modal-save-error');
    expect(banner).toHaveTextContent('This project has no VAT rate recorded');
    expect(within(banner).getByRole('link', { name: /Record the VAT rate on the project/ })).toHaveAttribute('href', '/projects/proj-1');
    expect(screen.getAllByText('This project has no VAT rate recorded')).toHaveLength(1);
    expect(h.toast).not.toHaveBeenCalled();
  });

  it('AC-NAR-003 (I-4) a PMO invoice shows its total due and what has been paid, so the outstanding reconciles by eye', () => {
    h.invoices.data = [nativeInvoice({ status: 'Unpaid', pmo_number: 'INV-2610070001', erp_outstanding_amount: 610_000 })];
    renderPage();
    const row = rowFor('INV-2610070001');
    expect(row).toHaveTextContent(/Total due .*1,110,000\.00/);
    expect(row).toHaveTextContent(/Paid .*500,000\.00/);
    expect(row).toHaveTextContent(/610,000\.00/);
  });

  it('AC-NAR-001 (M-2) a PMO Draft with no number yet reads "Draft · <customer>"', () => {
    h.invoices.data = [nativeInvoice()];
    renderPage();
    expect(within(rowFor('Acme Energy')).getByText('Draft · Acme Energy')).toBeInTheDocument();
  });

  it('DD-NAR-3 (M-7) PMO mode filters by Partly paid and never offers Submitted', async () => {
    h.invoices.data = [
      nativeInvoice({ id: 'si-a', status: 'Unpaid', pmo_number: 'INV-2610070001', erp_outstanding_amount: 610_000 }),
      nativeInvoice({ id: 'si-b', status: 'Unpaid', pmo_number: 'INV-2610070002', erp_outstanding_amount: 1_110_000 }),
    ];
    const user = userEvent.setup();
    renderPage();
    const filters = screen.getByRole('tablist', { name: 'Filter by status' });
    expect(within(filters).queryByRole('tab', { name: 'Submitted' })).toBeNull();
    await user.click(within(filters).getByRole('tab', { name: 'Partly paid' }));
    expect(screen.getByText('INV-2610070001')).toBeInTheDocument();
    expect(screen.queryByText('INV-2610070002')).toBeNull();
  });

  it('(M-7) an ERP-mode page keeps the Submitted filter', () => {
    h.route = 'external';
    renderPage();
    expect(within(screen.getByRole('tablist', { name: 'Filter by status' })).getByRole('tab', { name: 'Submitted' })).toBeInTheDocument();
  });

  it('#767 (M-7) a Draft offers no "Record received date" — the client cannot have received an unissued invoice', async () => {
    h.userId = 'u-fin1';
    h.invoices.data = [nativeInvoice()];
    const user = userEvent.setup();
    renderPage();
    await openMenu(user, rowFor('Acme Energy'));
    expect(screen.queryByRole('menuitem', { name: 'Record received date' })).toBeNull();
  });

  it('NFR-NAR-006 (M-6) the new-invoice form is translated', async () => {
    await financeTestI18n.changeLanguage('id');
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getAllByRole('button', { name: financeTestI18n.t('financeCopy.newInvoice') })[0]);
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByRole('heading', { name: financeTestI18n.t('financeCopy.newInvoiceTitle') })).toBeInTheDocument();
    expect(financeTestI18n.t('financeCopy.newInvoiceTitle')).not.toBe('New invoice');
    expect(within(dialog).getByRole('button', { name: financeTestI18n.t('financeCopy.createInvoice') })).toBeInTheDocument();
    expect(financeTestI18n.t('financeCopy.createInvoice')).not.toBe('Create invoice');
  });
});
