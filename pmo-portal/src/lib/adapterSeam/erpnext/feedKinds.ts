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

/** kind → the PMO domain (the ERPNext-owned domains: companies/procurement/revenue/timesheets/budget). */
export const KIND_DOMAIN: Record<ErpDocKind, 'companies' | 'procurement' | 'revenue' | 'timesheets' | 'budget'> = {
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
  // P3b — Timesheets (ADR-0059 Posture B: PMO-SoT + an ERP side mirror).
  timesheet: 'timesheets',
  // P3b — the Employee MASTER (OQ-TSP-3 ruling). `timesheets`, deliberately NOT `companies`
  // (FR-TSP-094): `companies` is ALREADY FLIPPED for existing orgs, so adding an Employee doctype to
  // its sweep/feed would change their behavior — an FR-ENA-004 violation. The timesheets flip brings
  // its own master. AC-TSP-003 proves this.
  employee: 'timesheets',
  // P3c — the budget push (ADR-0059 Posture B). PMO authors the budget; ERP receives a copy for the GL
  // + its native overspend controls.
  budget: 'budget',
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
  // P3b — the SIDE mirror (0136). ⛔ NEVER `timesheets`/`timesheet_entries`: PMO is the SoT there and
  // no feed/mirror write may ever touch them (ADR-0059 §3.1, FR-TSP-004(ii)).
  timesheet: 'timesheet_erp_mirror',
  // P3b — the adopted Employee master (0136). Its OWN table, never `companies` (FR-TSP-094).
  employee: 'erp_employees',
  // P3c — the SIDE mirror (0137). ⛔ NEVER `budget_versions`/`budget_line_items`: PMO is the SoT for the
  // budget figure (OD-BUDGET-1) and no feed/mirror write may ever touch them. A Desk-created ERP Budget
  // is ack-and-skipped, never adopted (FR-BUD-140) — the inverse of P3a's adopt rule.
  budget: 'budget_version_erp_mirror',
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
  // P3b (FR-TSP-091): the SAME collision-prevention idiom as Supplier:/Customer: — deterministic and
  // namespace-safe within the domain, even though `Employee` collides with no other doctype here today.
  if (kind === 'employee') return `Employee:${erpName}`;
  return erpName;
}