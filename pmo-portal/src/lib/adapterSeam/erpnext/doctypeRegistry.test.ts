/**
 * FR-ENA-014 — erpnext/doctypeRegistry.ts: the internal (domain,kind,op)->doctype map. This is the
 * ONE place Frappe doctype names live (confinement, FR-ENA-013/NFR-ENA-CONTRACT-001). A pure static
 * table + `submittable` flag (drives the two-step create->submit); `toBody`/`fromDoc` are attached
 * per-kind by later tasks (2.7 + slice 3) via a separate side table, kept out of this registry.
 *
 * `remarksQueryable` (task 6.4, ADR-0057 §3/Consequences — live-bench-discovered, R9-bench-verified
 * 2026-07-12): the recovery-probe anchor `GET .../<DocType>?filters=[["remarks",...]]` requires the
 * doctype to actually carry a filterable `remarks` field — confirmed against the real ERPNext v15
 * bench that only Purchase Invoice/Payment Entry/Purchase Receipt (money + receipt docs) do; Material
 * Request/RFQ/Supplier Quotation/Purchase Order/Supplier/Customer do NOT (Frappe rejects the filter
 * with `DataError: Field not permitted in query: remarks` — the field doesn't exist on those
 * doctypes). The ADR's own Consequences section anticipates this exact case ("If a future doctype
 * lacks remarks, that doctype's toBody chooses another stable stock text field") — this flag is the
 * MINIMAL safe response within that authorization: `false` doctypes skip the probe query entirely
 * (never issue the erroring GET) and always fall through to a fresh claim+POST, which stays R1-safe
 * (the DB claim is the actual concurrent-duplicate guard, unaffected) but forgoes R3 orphan-adoption
 * for those kinds — a smaller, cross-slice body-remapping fix is flagged for the Director as a
 * follow-up, not attempted here (touching 6 already-frozen/tested body files spans slices 2-5).
 */
import { describe, expect, it } from 'vitest';
import { DOCTYPE_REGISTRY } from './doctypeRegistry.ts';

describe('erpnext/doctypeRegistry', () => {
  it('FR-ENA-014 maps every PMO erp_doc_kind to its exact Frappe doctype name + submittable + remarksQueryable flags', () => {
    expect(DOCTYPE_REGISTRY).toEqual({
      'purchase-request': { doctype: 'Material Request', submittable: true, remarksQueryable: false },
      rfq: { doctype: 'Request for Quotation', submittable: true, remarksQueryable: false },
      quotation: { doctype: 'Supplier Quotation', submittable: true, remarksQueryable: false },
      'purchase-order': { doctype: 'Purchase Order', submittable: true, remarksQueryable: false },
      'goods-receipt': { doctype: 'Purchase Receipt', submittable: true, remarksQueryable: true },
      'purchase-invoice': { doctype: 'Purchase Invoice', submittable: true, remarksQueryable: true },
      payment: { doctype: 'Payment Entry', submittable: true, remarksQueryable: true },
      supplier: { doctype: 'Supplier', submittable: false, remarksQueryable: false },
      customer: { doctype: 'Customer', submittable: false, remarksQueryable: false },
    });
  });

  it('FR-ENA-013 no Frappe doctype name appears twice (each ERP doc kind is unambiguous)', () => {
    const doctypes = Object.values(DOCTYPE_REGISTRY).map((entry) => entry.doctype);
    expect(new Set(doctypes).size).toBe(doctypes.length);
  });
});
