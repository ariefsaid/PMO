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
import { EXPENSE_JOURNAL_KEY_RE } from './expensePostingKey.ts';

export type { ErpDocKind } from './doctypeRegistry.ts';

/** kind → the PMO domain (the ERPNext-owned domains: companies/procurement/revenue/timesheets/budget/expenses). */
export const KIND_DOMAIN: Record<ErpDocKind, 'companies' | 'procurement' | 'revenue' | 'timesheets' | 'budget' | 'expenses'> = {
  'purchase-request': 'procurement',
  rfq: 'procurement',
  quotation: 'procurement',
  'purchase-order': 'procurement',
  'goods-receipt': 'procurement',
  'purchase-invoice': 'procurement',
  payment: 'procurement',
  supplier: 'companies',
  customer: 'companies',
  contact: 'companies',
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
  // #775 phase B — expense postings (Posture B). Lifecycle-only inbound; never adopted (FR-EXP-113).
  'expense-journal': 'expenses',
  'expense-payment': 'expenses',
  'expense-receipt': 'expenses',
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
  contact: 'contacts',
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
  // #775 phase B — the SIDE mirror (0263). ⛔ NEVER `expense_claims`: PMO is the SoT for the claim; only the side
  // mirror is a feed target.
  'expense-journal': 'expense_posting_erp_mirror',
  'expense-payment': 'expense_posting_erp_mirror',
  'expense-receipt': 'expense_posting_erp_mirror',
};

/** Kinds that share a doctype with an earlier kind and are reached only through a discriminator
 *  (`kindFromDoctypeAndPaymentType`'s party type). Kept out of the plain reverse map so `kindFromDoctype` answers
 *  exactly as it did before they existed. */
const DISCRIMINATED_KINDS: ReadonlySet<ErpDocKind> = new Set<ErpDocKind>(['expense-payment', 'expense-receipt']);

/** Reverse doctype→kind lookup (built from the registry — one source of doctype names). */
const DOCTYPE_TO_KIND: Record<string, ErpDocKind> = Object.fromEntries(
  (Object.entries(DOCTYPE_REGISTRY) as Array<[ErpDocKind, { doctype: string }]>)
    .filter(([kind]) => !DISCRIMINATED_KINDS.has(kind))
    .map(([kind, entry]) => [entry.doctype, kind]),
);

/** Resolve a Frappe doctype name → the PMO `erp_doc_kind`, or `undefined` for a doctype P2 does not
 *  mirror (the feed ack's-and-skips it — lossy hint, FR-ENA-083). */
export function kindFromDoctype(doctype: string): ErpDocKind | undefined {
  return DOCTYPE_TO_KIND[doctype];
}

/** Disambiguate an inbound Payment Entry by payment_type (FR-SAR-081) and, for an Employee party, route it to the
 *  expense kinds (FR-EXP-113): one doctype → four PMO kinds. */
export function kindFromDoctypeAndPaymentType(doctype: string, paymentType?: string, partyType?: string): ErpDocKind | undefined {
  if (doctype === 'Payment Entry') {
    if (partyType === 'Employee') {
      if (paymentType === 'Receive') return 'expense-receipt';
      if (paymentType === 'Pay') return 'expense-payment';
      return undefined;
    }
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
  if (kind === 'contact') return `Contact:${erpName}`;
  if (kind === 'customer') return `Customer:${erpName}`;
  // P3b (FR-TSP-091): the SAME collision-prevention idiom as Supplier:/Customer: — deterministic and
  // namespace-safe within the domain, even though `Employee` collides with no other doctype here today.
  if (kind === 'employee') return `Employee:${erpName}`;
  return erpName;
}

// ─── The sweep poll scope (moved from erpnext-sweep, #656) ─────────────────────────────────────────

/**
 * Kinds whose OUTBOUND push shipped before their INBOUND handling did, so the poll had to stay closed
 * for them in the meantime. Registering a kind in DOCTYPE_REGISTRY enrols it in the poll
 * automatically, which is exactly why an exclusion here has to be explicit.
 *
 * `timesheet` (P3b) WAS excluded: FR-TSP's feed is LIFECYCLE-ONLY and must NEVER adopt a
 * natively-created ERP Timesheet — PMO owns entry AND approval (ADR-0059 Posture B), so minting a
 * mirror from a Desk-created Timesheet would import hours that no PMO approver ever approved. That
 * never-adopt branch landed (task 6.2, `erpnextFeedDeps.ts`'s `mintMirrorRow` throws
 * `native-timesheet-not-adopted` for an unmapped Timesheet — it mints nothing), and the desk-cancel
 * reopen (task 6.3) needed the poll running to ever observe a cancelled Timesheet — so `timesheet` was
 * REMOVED from this set in that same change. `employee` was never added here: it is the adopt TARGET
 * (FR-TSP-090/091), gated only by domain ownership (`KIND_DOMAIN.employee === 'timesheets'`,
 * AC-TSP-003) via `sweepKindsForOrg`, exactly like every other adopted master (Supplier/Customer).
 *
 * `budget` (P3c) WAS excluded for the identical shape: FR-BUD-140's never-adopt (a Desk-created ERP
 * Budget is ack-and-skipped, NEVER minted into PMO — PMO is the SoT for the budget figure,
 * OD-BUDGET-1) and FR-BUD-142's never-fight-the-operator (an external cancel reopens `push_state`,
 * never auto-re-pushes). Both now land (slice 5, `erpnextFeedDeps.ts`'s `mintMirrorRow` throws
 * `native-budget-not-adopted` for an unmapped Budget; `cancelStatusPatch`/`tombstoneMirror` reopen +
 * surface a desk-cancel) — so `budget` is REMOVED from this set in the SAME change, per the rule below.
 *
 * ⚑ Remove an entry in the SAME change that lands its inbound branch — never before.
 */
const SWEEP_UNPOLLED_KINDS = new Set<ErpDocKind>([]);

const SWEEP_DOCTYPES: Array<{ kind: ErpDocKind; doctype: string }> = (Object.entries(DOCTYPE_REGISTRY) as Array<
  [ErpDocKind, { doctype: string }]
>)
  .filter(([kind]) => !SWEEP_UNPOLLED_KINDS.has(kind))
  .map(([kind, entry]) => ({ kind, doctype: entry.doctype }));

/** A master another domain also needs: the ERP Employee is polled for `timesheets` AND `expenses` (DD-EXP-21).
 *  Its feed domain stays `timesheets` (`KIND_DOMAIN`), so its `external_refs` namespace is unchanged. */
const KIND_ALSO_POLLED_FOR: Partial<Record<ErpDocKind, readonly string[]>> = { employee: ['expenses'] };

/**
 * The doctypes ONE org's sweep may poll (Luna BLOCK 9). A valid, activated ERPNext binding says the org
 * talks to ERPNext; it does NOT say which PMO domains it handed over. Polling every doctype regardless
 * pushed native Sales Invoice / Receive PE mirrors into a procurement-only org's revenue read model.
 * Fail-CLOSED: an org with no recorded ownership polls nothing. Shared (#656) by the sweep's poll and the
 * activation read-permission probe, so what activation checks is exactly what the sweep will read.
 */
export function sweepKindsForOrg(ownedDomains: readonly string[]): Array<{ kind: ErpDocKind; doctype: string }> {
  const owned = new Set(ownedDomains);
  return SWEEP_DOCTYPES.filter(({ kind }) =>
    owned.has(KIND_DOMAIN[kind]) || (KIND_ALSO_POLLED_FOR[kind] ?? []).some((domain) => owned.has(domain)));
}

/** A poll's extra server-side filter + the per-row authority behind it (FR-EXP-113). `null` = no discriminator. */
export interface KindPollDiscriminator {
  filters: Array<[string, string, string]>;
  fields: string[];
  admits(row: Record<string, unknown>): boolean;
  /** A field every genuine row of this kind states: a row without it means the source omitted it (a webhook
   *  configuration gap), which the ingress surfaces instead of dropping silently. */
  requiredField?: string;
}

/** A Payment Entry states its party type; a row without one is not adopted by any Payment Entry kind. */
function statedPartyType(row: Record<string, unknown>): string | null {
  return typeof row.party_type === 'string' && row.party_type.trim() !== '' ? row.party_type : null;
}

/**
 * Payment Entry carries Supplier, Customer AND Employee parties. Before #775 phase B the procurement/revenue polls
 * read Employee entries too — a revenue-owned org would adopt an employee's cash return as a customer receipt.
 * A Payment Entry without party_type is not adopted: the field decides the domain, so a row that omits it (a
 * webhook whose configuration leaves it out) cannot be placed. The sweep always requests it; ERPNext requires it
 * on every Pay/Receive entry.
 * The Journal Entry poll admits only PMO keys: native journals (payroll, depreciation) are never even listed.
 */
export function pollDiscriminatorForKind(kind: ErpDocKind): KindPollDiscriminator | null {
  if (kind === 'payment' || kind === 'incoming-payment') {
    return {
      filters: [['party_type', '!=', 'Employee']],
      fields: ['party_type'],
      requiredField: 'party_type',
      admits: (row) => {
        const partyType = statedPartyType(row);
        return partyType !== null && partyType !== 'Employee';
      },
    };
  }
  if (kind === 'expense-payment' || kind === 'expense-receipt') {
    return { filters: [['party_type', '=', 'Employee']], fields: ['party_type'], admits: (row) => row.party_type === 'Employee' };
  }
  if (kind === 'expense-journal') {
    return {
      filters: [['user_remark', 'like', 'exp%']],
      fields: ['user_remark'],
      admits: (row) => typeof row.user_remark === 'string' && EXPENSE_JOURNAL_KEY_RE.test(row.user_remark),
    };
  }
  return null;
}
