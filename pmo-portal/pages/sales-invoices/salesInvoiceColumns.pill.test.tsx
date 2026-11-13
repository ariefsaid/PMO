/**
 * R2 impeccable "cramped-padding" on /finance/receivables at 1440: the coloured status pill in the
 * embedded list's desktop table needs its own 8px vertical inset, or the label sits flush against the
 * tint. The shared StatusPill keeps DESIGN.md's 20px pill spec for every other surface, so the inset
 * lives in this usage. Asserted as classes/sizes, never pixel positions.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import type { SalesInvoiceRow } from '@/src/lib/db/revenue';
import { FinanceI18nTestProvider } from '@/test/financeI18nTestProvider';
import { salesInvoiceColumns } from './salesInvoiceColumns';

afterEach(cleanup);

const row = {
  id: 'si-pill', org_id: 'o', project_id: null, customer_id: 'c', customer_name: 'Northwind', si_number: 'INV-1', invoice_date: '2026-11-01',
  amount: 120, currency: 'IDR', tax_treatment: 'exclusive', tax_amount: 0, erp_outstanding_amount: 0, status: 'Paid', erp_docstatus: 1,
  pmo_native: false,
} as SalesInvoiceRow;

/** Render just the list's status cell, and return the pill (the outer span that carries the surface). */
function statusPill(embedded: boolean, label = 'Paid') {
  const t = ((_: string, d?: string) => d ?? _) as never;
  const { displayColumns } = salesInvoiceColumns({
    t, all: [row], visibleInvoices: [row], embedded, native: false, location: { pathname: '/', search: '', hash: '', state: null, key: 'k' }, orgCurrency: 'IDR', sharedTaxBasis: null,
    projectOptionsById: new Map(), projectsById: new Map(), profilesById: new Map(),
    invoiceStatus: () => ({ label, variant: 'won' as never, partlySettled: false, odooOutcome: null }),
  });
  const statusColumn = displayColumns.find((column) => column.key === 'status')!;
  render(<MemoryRouter><FinanceI18nTestProvider>{statusColumn.cell!(row)}</FinanceI18nTestProvider></MemoryRouter>);
  return screen.getByText(label).closest('span[class*="bg-status-"]')!;
}

describe('the embedded invoice list status pill carries its own vertical inset', () => {
  it('pads the embedded list pill by 8px top and bottom', () => {
    const pill = statusPill(true);
    expect(pill.className).toContain('py-2');
    expect(pill.className).toContain('bg-status-success-surface');
  });

  it('keeps the embedded receivables status label on one line', () => {
    const pill = statusPill(true, 'Partly paid · 90 days overdue');
    expect(pill).toHaveClass('whitespace-nowrap');
    expect(pill).toHaveTextContent('Partly paid · 90 days overdue');
  });

  it('leaves the shared pill unchanged on the standalone list', () => {
    const pill = statusPill(false);
    expect(pill.className).not.toContain('py-2');
    // The shared spec: 14px label in a full-radius pill, no extra vertical padding.
    expect(pill.className).toContain('min-h-6');
    expect(pill.className).toContain('rounded-full');
  });
});
