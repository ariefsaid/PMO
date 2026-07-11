/**
 * FR-ENA-014 — erpnext/doctypeRegistry.ts: the internal (domain,kind,op)->doctype map. This is the
 * ONE place Frappe doctype names live (confinement, FR-ENA-013/NFR-ENA-CONTRACT-001). A pure static
 * table + `submittable` flag (drives the two-step create->submit); `toBody`/`fromDoc` are attached
 * per-kind by later tasks (2.7 + slice 3) via a separate side table, kept out of this registry.
 */
import { describe, expect, it } from 'vitest';
import { DOCTYPE_REGISTRY } from './doctypeRegistry.ts';

describe('erpnext/doctypeRegistry', () => {
  it('FR-ENA-014 maps every PMO erp_doc_kind to its exact Frappe doctype name + submittable flag', () => {
    expect(DOCTYPE_REGISTRY).toEqual({
      'purchase-request': { doctype: 'Material Request', submittable: true },
      rfq: { doctype: 'Request for Quotation', submittable: true },
      quotation: { doctype: 'Supplier Quotation', submittable: true },
      'purchase-order': { doctype: 'Purchase Order', submittable: true },
      'goods-receipt': { doctype: 'Purchase Receipt', submittable: true },
      'purchase-invoice': { doctype: 'Purchase Invoice', submittable: true },
      payment: { doctype: 'Payment Entry', submittable: true },
      supplier: { doctype: 'Supplier', submittable: false },
      customer: { doctype: 'Customer', submittable: false },
    });
  });

  it('FR-ENA-013 no Frappe doctype name appears twice (each ERP doc kind is unambiguous)', () => {
    const doctypes = Object.values(DOCTYPE_REGISTRY).map((entry) => entry.doctype);
    expect(new Set(doctypes).size).toBe(doctypes.length);
  });
});
