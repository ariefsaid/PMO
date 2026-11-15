/** AC-OCI-091 review: an Odoo org's invoice list keeps each invoice's own status and adds Odoo's word only when something is unsettled. */
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import type { SalesInvoiceRow } from '@/src/lib/db/revenue';
import { FinanceI18nTestProvider } from '@/test/financeI18nTestProvider';
import { financeTestI18n } from '@/test/financeI18nTestInstance';
import { setActiveLocale } from '@/src/lib/locale/activeLocale';
import { salesInvoiceColumns } from './salesInvoiceColumns';

afterEach(cleanup);
const T = '2026-11-03T10:00:00Z';
const inv = (over: Partial<SalesInvoiceRow> = {}) => ({
  id: 'si-1', org_id: 'o', project_id: null, customer_id: 'c', customer_name: 'Northwind', si_number: 'INV-1', invoice_date: '2026-11-01',
  amount: 120, currency: 'IDR', tax_treatment: 'exclusive', tax_amount: 0, erp_outstanding_amount: null, status: 'Paid', erp_docstatus: 1,
  pmo_native: false, ...over,
} as SalesInvoiceRow);

function cell(status: { label: string; odooOutcome?: { cls: 'confirmed' | 'pending' | 'held' | 'needs-attention' | 'refused'; asOf: string | null; reason: string | null } | null; odooOffline?: boolean }, row = inv()) {
  const t = ((_: string, d?: string) => d ?? _) as never;
  const { mobileCardDetails } = salesInvoiceColumns({
    t, all: [row], embedded: false, native: false, location: { pathname: '/', search: '', hash: '', state: null, key: 'k' }, orgCurrency: 'IDR', sharedTaxBasis: null,
    projectOptionsById: new Map(), projectsById: new Map(), profilesById: new Map(),
    invoiceStatus: () => ({ variant: 'neutral' as never, partlySettled: false, ...status }),
  });
  return render(<MemoryRouter><FinanceI18nTestProvider>{mobileCardDetails(row)}</FinanceI18nTestProvider></MemoryRouter>);
}

describe('AC-OCI-091 invoice list status with Odoo', () => {
  it('a confirmed invoice keeps its own status and adds no Odoo chip', () => {
    cell({ label: 'Paid', odooOutcome: { cls: 'confirmed', asOf: T, reason: null } });
    expect(screen.getByText('Paid')).toBeInTheDocument();
    expect(screen.queryByText('In Odoo')).toBeNull();
  });

  it('an unsettled invoice shows its own status with what Odoo has not settled underneath', () => {
    cell({ label: 'Unpaid', odooOutcome: { cls: 'held', asOf: T, reason: null } }, inv({ status: 'Unpaid' }));
    expect(screen.getByText('Unpaid')).toBeInTheDocument();
    expect(screen.getByText('Needs a decision')).toBeInTheDocument();
  });

  it('repeats no unreachable sentence on a row', () => {
    cell({ label: 'Unpaid', odooOutcome: { cls: 'pending', asOf: T, reason: null }, odooOffline: true }, inv({ status: 'Unpaid' }));
    expect(screen.queryByText(/cannot be reached/)).toBeNull();
  });

  it('a plain invoice renders as before', () => {
    cell({ label: 'Paid', odooOutcome: null });
    expect(screen.getByText('Paid')).toBeInTheDocument();
    expect(screen.queryByTestId('odoo-outcome')).toBeNull();
  });
});

function identity(row: SalesInvoiceRow, embedded: boolean) {
  const t = ((_: string, d?: string) => d ?? _) as never;
  const { displayColumns } = salesInvoiceColumns({
    t, all: [row], embedded, native: false, location: { pathname: '/', search: '', hash: '', state: null, key: 'k' }, orgCurrency: 'IDR', sharedTaxBasis: null,
    projectOptionsById: new Map(), projectsById: new Map(), profilesById: new Map(),
    invoiceStatus: () => ({ variant: 'neutral' as never, partlySettled: false, label: 'Unpaid', odooOutcome: null }),
  });
  const col = displayColumns.find((c) => c.key === 'si_number')!;
  const due = displayColumns.find((c) => c.key === 'due_date')!;
  const node = (
    <MemoryRouter><FinanceI18nTestProvider>
      <div data-testid="identity">{col.cell(row)}{embedded ? null : col.secondaryCell?.(row)}</div>
      <div data-testid="due">{due.cell(row)}</div>
    </FinanceI18nTestProvider></MemoryRouter>
  );
  return render(node);
}

// #2290: the ledger date rides the invoice's identity line in the app's one date format, never under the due date.
describe('AC-ODR-010 the invoice list shows the ledger date on the invoice identity line (#2290)', () => {
  it.each([true, false])('embedded=%s: a re-dated invoice shows one "Ledger date 1 Dec" line, not under the due date; an unmoved or PMO-held one none', (embedded) => {
    identity(inv({ status: 'Unpaid', erp_posting_date: '2026-12-01' }), embedded);
    expect(screen.getAllByTestId('ledger-date')).toHaveLength(1);
    expect(screen.getByTestId('identity')).toContainElement(screen.getByTestId('ledger-date'));
    expect(screen.getByTestId('ledger-date')).toHaveTextContent(/^Ledger date 1 Dec( 2026)? \(entered 1 Nov( 2026)?\)$/);
    expect(screen.getByTestId('due')).not.toContainElement(screen.getByTestId('ledger-date'));
    cleanup();
    identity(inv({ status: 'Unpaid', erp_posting_date: '2026-11-01' }), embedded);
    expect(screen.queryByTestId('ledger-date')).toBeNull();
    cleanup();
    identity(inv({ status: 'Unpaid' }), embedded);
    expect(screen.queryByTestId('ledger-date')).toBeNull();
  });
});

// #2290: the phone card (mobileCardDetails) carries the same ledger-date line as the desktop identity cell, in the viewer's language.
describe('AC-ODR-010 the phone invoice card shows the ledger date (#2290)', () => {
  afterEach(async () => { await financeTestI18n.changeLanguage('en'); });
  it.each([
    ['en', /^Ledger date 1 Dec( 2026)? \(entered 1 Nov( 2026)?\)$/],
    ['id', /^Tanggal buku besar 1 Des( 2026)? \(dimasukkan 1 Nov( 2026)?\)$/],
  ])('%s: a re-dated invoice shows one ledger-date line; an unmoved or PMO-held one none', async (lng, wording) => {
    await financeTestI18n.changeLanguage(lng);
    // The app's I18nProvider pins the formatters' locale to the UI language; the harness must do the same (test/setup.ts pins 'en').
    setActiveLocale({ locale: lng, numberLocale: lng === 'id' ? 'id-ID' : 'en-US', timezone: 'UTC' });
    cell({ label: 'Unpaid', odooOutcome: null }, inv({ status: 'Unpaid', erp_posting_date: '2026-12-01' }));
    // Placement matches desktop: under the record number on its own line, never in the status/amount block.
    expect(screen.queryByTestId('ledger-date')).toBeNull();
    cleanup();
    const row = inv({ status: 'Unpaid', erp_posting_date: '2026-12-01' });
    cardTitle(row);
    expect(screen.getAllByTestId('ledger-date')).toHaveLength(1);
    expect(screen.getByTestId('ledger-date')).toHaveTextContent(wording);
    const number = screen.getByText('INV-1');
    expect(number.nextElementSibling).toBe(screen.getByTestId('ledger-date'));
    cleanup();
    cardTitle(inv({ status: 'Unpaid', erp_posting_date: '2026-11-01' }));
    expect(screen.queryByTestId('ledger-date')).toBeNull();
    cleanup();
    cardTitle(inv({ status: 'Unpaid' }));
    expect(screen.queryByTestId('ledger-date')).toBeNull();
  });
});

function cardTitle(row: SalesInvoiceRow) {
  const t = ((_: string, d?: string) => d ?? _) as never;
  const { mobileCardTitle } = salesInvoiceColumns({
    t, all: [row], embedded: true, native: false, location: { pathname: '/', search: '', hash: '', state: null, key: 'k' }, orgCurrency: 'IDR', sharedTaxBasis: null,
    projectOptionsById: new Map(), projectsById: new Map(), profilesById: new Map(),
    invoiceStatus: () => ({ variant: 'neutral' as never, partlySettled: false, label: 'Unpaid', odooOutcome: null }),
  });
  return render(<MemoryRouter><FinanceI18nTestProvider>{mobileCardTitle(row)}</FinanceI18nTestProvider></MemoryRouter>);
}

describe('AC-ODR-010 invoice list: "entered" shows only when it differs from the ledger date (#2290)', () => {
  it.each([true, false])('embedded=%s: (a) equal dates show no entered wording, (b) different dates show it', (embedded) => {
    identity(inv({ status: 'Unpaid', erp_posting_date: '2026-11-01' }), embedded);
    expect(screen.getByTestId('identity')).not.toHaveTextContent(/entered/i);
    cleanup();
    identity(inv({ status: 'Unpaid', erp_posting_date: '2026-12-01' }), embedded);
    expect(screen.getByTestId('ledger-date')).toHaveTextContent(/entered 1 Nov/);
  });
});
