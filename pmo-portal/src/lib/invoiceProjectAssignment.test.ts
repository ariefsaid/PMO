import { describe, expect, it } from 'vitest';
import type { SalesInvoiceRow } from './db/revenue';
import { canAttributeInvoice } from './invoiceProjectAssignment';

describe('invoice project attribution eligibility', () => {
  const base = { pmo_native: false, si_number: 'SI-1', author_user_id: null, author_user_ids: [] } as unknown as SalesInvoiceRow;

  it('AC-PFIN-009 allows an adopted, numbered invoice with no PMO authors', () => {
    expect(canAttributeInvoice(base)).toBe(true);
  });

  it.each([
    { ...base, pmo_native: true },
    { ...base, si_number: null },
    { ...base, author_user_id: 'user-1' },
    { ...base, author_user_ids: ['user-1'] },
  ])('AC-PFIN-009 refuses native, unnumbered, or PMO-authored invoices %#', (invoice) => {
    expect(canAttributeInvoice(invoice)).toBe(false);
  });
});
