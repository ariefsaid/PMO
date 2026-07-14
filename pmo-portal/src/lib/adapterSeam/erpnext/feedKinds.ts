/**
 * erpnext/feedKinds.ts (task 8.2/8.5/8.6 helper) — the confined kind↔domain↔mirror-table +
 * doctype→kind reverse maps the inbound feed (webhook 8.2 + sweep 8.6) uses to route an ERP event.
 * Built FROM `DOCTYPE_REGISTRY` (the single source of Frappe doctype names, slice 2.10) so this file
 * adds NO new doctype names — only the PMO-side routing tables the feed needs. Frappe vocabulary
 * (doctype names) stays confined here + DOCTYPE_REGISTRY (FR-ENA-013/NFR-ENA-CONTRACT-001).
 *
 * `externalIdForKind` mirrors `partyAdopt.externalIdFor`'s `'Supplier:<name>'`/`'Customer:<name>'`
 * encoding (the companies-domain collision rule, FR-ENA-091) and falls back to the raw ERP name for
 * procurement doctypes — the SAME encoding the dispatch path stamps, so an inbound event resolves to
 * the SAME `external_refs` row the outbound create recorded.
 */
import { DOCTYPE_REGISTRY, type ErpDocKind } from './doctypeRegistry.ts';

export type { ErpDocKind } from './doctypeRegistry.ts';

/** kind → the PMO domain (the three ERPNext-owned domains). */
export const KIND_DOMAIN: Record<ErpDocKind, 'companies' | 'procurement' | 'revenue'> = {
  'purchase-request': 'procurement',
  rfq: 'procurement',
  quotation: 'procurement',
  'purchase-order': 'procurement',
  'goods-receipt': 'procurement',
  'purchase-invoice': 'procurement',
  payment: 'procurement',
  supplier: 'companies',
  customer: 'companies',
  // P3a Slice 1 — Revenue domain:
  'sales-invoice': 'revenue',
  'incoming-payment': 'revenue',
};

/** kind → the PMO mirror table the feed upserts/reads (the table carrying `erp_modified`/`erp_docstatus`).
 *  Procurement sub-doctypes each have their own mirror table (slices 4-6); parties share `companies`;
 *  Revenue kinds map to the new slice-0 tables. */
export const KIND_MIRROR_TABLE: Record<ErpDocKind, string> = {
  'purchase-request': 'purchase_requests',
  rfq: 'rfqs',
  quotation: 'procurement_quotations',
  'purchase-order': 'purchase_orders',
  'goods-receipt': 'procurement_receipts',
  'purchase-invoice': 'procurement_invoices',
  payment: 'payments',
  supplier: 'companies',
  customer: 'companies',
  // P3a Slice 1 — Revenue domain mirror tables (created in slice 0):
  'sales-invoice': 'sales_invoices',
  'incoming-payment': 'incoming_payments',
};

/** Reverse doctype→kind lookup (built from the registry — one source of doctype names). */
const DOCTYPE_TO_KIND: Record<string, ErpDocKind> = Object.fromEntries(
  (Object.entries(DOCTYPE_REGISTRY) as Array<[ErpDocKind, { doctype: string }]>).map(([kind, entry]) => [
    entry.doctype,
    kind,
  ]),
);

/** Resolve a Frappe doctype name → the PMO `erp_doc_kind`, or `undefined` for a doctype P2 does not
 *  mirror (the feed ack's-and-skips it — lossy hint, FR-ENA-083). */
export function kindFromDoctype(doctype: string): ErpDocKind | undefined {
  return DOCTYPE_TO_KIND[doctype];
}

/** Disambiguate an inbound Payment Entry by payment_type (FR-SAR-081): one doctype → two PMO kinds. */
export function kindFromDoctypeAndPaymentType(doctype: string, paymentType?: string): ErpDocKind | undefined {
  if (doctype === 'Payment Entry') {
    if (paymentType === 'Receive') return 'incoming-payment';
    if (paymentType === 'Pay') return 'payment';
    return undefined; // unknown/absent payment_type → ack-and-skip (lossy hint, FR-SAR-083)
  }
  return kindFromDoctype(doctype); // Sales Invoice + every other doctype is unique
}

/** The externalRecordId the feed uses for an event of this kind (parties encode the doctype so the
 *  Supplier/Customer collision rule is deterministic; procurement uses the raw ERP name). */
export function externalIdForKind(kind: ErpDocKind, erpName: string): string {
  if (kind === 'supplier') return `Supplier:${erpName}`;
  if (kind === 'customer') return `Customer:${erpName}`;
  return erpName;
}