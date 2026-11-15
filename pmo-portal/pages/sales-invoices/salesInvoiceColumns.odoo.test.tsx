/** AC-OCI-091 review: an Odoo org's invoice list keeps each invoice's own status and adds Odoo's word only when something is unsettled. */
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import type { SalesInvoiceRow } from '@/src/lib/db/revenue';
import { FinanceI18nTestProvider } from '@/test/financeI18nTestProvider';
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

describe('AC-ODR-010 the invoice list shows the ledger date under a moved invoice date (#2290)', () => {
  it('a re-dated invoice shows "Ledger: {date}"; an unmoved or PMO-held one does not', () => {
    cell({ label: 'Unpaid', odooOutcome: null }, inv({ status: 'Unpaid', erp_posting_date: '2026-12-01' }));
    expect(screen.getByTestId('ledger-date')).toHaveTextContent(/^Ledger: .*2026/);
    cleanup();
    cell({ label: 'Unpaid', odooOutcome: null }, inv({ status: 'Unpaid', erp_posting_date: '2026-11-01' }));
    expect(screen.queryByTestId('ledger-date')).toBeNull();
    cleanup();
    cell({ label: 'Unpaid', odooOutcome: null }, inv({ status: 'Unpaid' }));
    expect(screen.queryByTestId('ledger-date')).toBeNull();
  });
});

describe('AC-ODR-010 the desktop receivables table shows the ledger date in the date column (#2290)', () => {
  function dueCell(row: SalesInvoiceRow, embedded: boolean) {
    const t = ((_: string, d?: string) => d ?? _) as never;
    const { displayColumns } = salesInvoiceColumns({
      t, all: [row], embedded, native: false, location: { pathname: '/', search: '', hash: '', state: null, key: 'k' }, orgCurrency: 'IDR', sharedTaxBasis: null,
      projectOptionsById: new Map(), projectsById: new Map(), profilesById: new Map(),
      invoiceStatus: () => ({ variant: 'neutral' as never, partlySettled: false, label: 'Unpaid', odooOutcome: null }),
    });
    const column = displayColumns.find((c) => c.key === 'due_date')!;
    return render(<MemoryRouter><FinanceI18nTestProvider>{column.cell(row)}</FinanceI18nTestProvider></MemoryRouter>);
  }
  it.each([true, false])('embedded=%s: a re-dated invoice shows one "Ledger: {date}" line; an unmoved one none', (embedded) => {
    dueCell(inv({ status: 'Unpaid', erp_posting_date: '2026-12-01' }), embedded);
    expect(screen.getAllByTestId('ledger-date')).toHaveLength(1);
    expect(screen.getByTestId('ledger-date')).toHaveTextContent(/^Ledger: .*2026/);
    cleanup();
    dueCell(inv({ status: 'Unpaid', erp_posting_date: '2026-11-01' }), embedded);
    expect(screen.queryByTestId('ledger-date')).toBeNull();
  });
});
