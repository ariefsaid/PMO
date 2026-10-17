import { describe, expect, it } from 'vitest';
import { projectSalesInvoiceEvidence } from './invoiceEvidence';

describe('projectSalesInvoiceEvidence', () => {
  it('projects read-only line evidence and authorized customer contact fields', () => {
    expect(projectSalesInvoiceEvidence({
      items: [{ item_code: 'SVC-01', description: 'Synthetic inspection', qty: 2, rate: 125, amount: 250 }],
      contact_display: 'Billing Desk', contact_email: 'billing@example.test', contact_mobile: '+62-TEST-000',
      name: 'SYNTHETIC-INVOICE-1', docstatus: 1,
    })).toEqual({
      lines: [{ item_code: 'SVC-01', description: 'Synthetic inspection', qty: 2, rate: 125, amount: 250 }],
      contact: { name: 'Billing Desk', email: 'billing@example.test', phone: '+62-TEST-000' },
    });
  });

  it('preserves unknown line and contact coverage instead of inventing empty values', () => {
    expect(projectSalesInvoiceEvidence({})).toEqual({ lines: null, contact: null });
    expect(projectSalesInvoiceEvidence({ items: [], contact_email: 'billing@example.test' })).toEqual({
      lines: [], contact: { name: null, email: 'billing@example.test', phone: null },
    });
  });

  it('drops malformed rows and never returns arbitrary ERP fields', () => {
    expect(projectSalesInvoiceEvidence({
      items: [{ item_code: 'SVC-02', qty: 'two', rate: 10 }, null],
      contact_person: 'CONTACT-REF-1', secret: 'not returned',
    })).toEqual({
      lines: [{ item_code: 'SVC-02', description: null, qty: null, rate: 10, amount: null }],
      contact: null,
    });
  });
});
