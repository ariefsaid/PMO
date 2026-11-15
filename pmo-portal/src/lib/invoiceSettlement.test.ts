import { describe, expect, it } from 'vitest';
import { summarizeInvoiceSettlement } from './invoiceSettlement';

describe('summarizeInvoiceSettlement', () => {
  it('keeps the settled paid amount when an invoice has no ERP balance', () => {
    expect(summarizeInvoiceSettlement([
      { status: 'Paid', amount: 125.55, erp_outstanding_amount: null },
      { status: 'Submitted', amount: 80, erp_outstanding_amount: 20 },
    ])).toEqual({
      invoiced: 205.55,
      paid: 125.55,
      unpaid: null,
      balancesKnown: false,
    });
  });
});
