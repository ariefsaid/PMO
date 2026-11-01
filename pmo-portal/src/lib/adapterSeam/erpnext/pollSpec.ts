/**
 * erpnext/pollSpec.ts: the ONE definition of what a modified-poll of each ERP kind requests and admits
 * (fields, payment-direction / party / company discriminators, kinds needing a full re-read). Shared by the
 * reconciliation sweep (`erpnext-sweep`) and the adapter's own change-feed read, so both poll a kind the same
 * way. Moved out of the sweep edge function unchanged; the sweep re-exports every symbol.
 */
import { DOCTYPE_REGISTRY, type ErpDocKind } from './doctypeRegistry.ts';
import type { ErpFilter } from './client.ts';
import { budgetFromDocFields } from './bodies/budget.ts';
import { TS_FROM_DOC_FIELDS } from './bodies/timesheet.ts';
import { EMPLOYEE_FROM_DOC_FIELDS } from './bodies/employee.ts';
import { SI_FROM_DOC_FIELDS } from './bodies/salesInvoice.ts';
import { PE_RECEIVE_FROM_DOC_FIELDS } from './bodies/incomingPayment.ts';
import { PE_PAY_FROM_DOC_FIELDS } from './bodies/paymentEntry.ts';
import { PI_FROM_DOC_FIELDS } from './bodies/purchaseInvoice.ts';
import { PO_FROM_DOC_FIELDS } from './bodies/purchaseOrder.ts';
import { GR_FROM_DOC_FIELDS } from './bodies/goodsReceipt.ts';
import { MR_FROM_DOC_FIELDS } from './bodies/materialRequest.ts';
import { RFQ_FROM_DOC_FIELDS } from './bodies/rfq.ts';
import { SQ_FROM_DOC_FIELDS } from './bodies/supplierQuotation.ts';
import { SUPPLIER_FROM_DOC_FIELDS } from './bodies/supplier.ts';
import { CONTACT_FROM_DOC_FIELDS } from './bodies/contact.ts';
import { CUSTOMER_FROM_DOC_FIELDS } from './bodies/customer.ts';
import { EXPENSE_JOURNAL_FROM_DOC_FIELDS } from './bodies/expenseJournal.ts';
import { EXPENSE_PAYMENT_FROM_DOC_FIELDS } from './bodies/expensePayment.ts';
import { pollDiscriminatorForKind } from './feedKinds.ts';
import { admitsDocForBindingCompany, companyDocFilters, isCompanyScopedKind } from './companyScope.ts';

/**
 * The list-endpoint fields each kind's poll must request (Luna BLOCK 6). Sourced from the field list
 * each body module declares NEXT TO its `fromDoc`, so the poll always fetches exactly what the mapper
 * reads — the sweep previously fetched only the four lifecycle fields, so every sweep-adopted Sales
 * Invoice entered the PMO revenue rollup with `amount = NULL` and `outstanding = NULL`.
 */
const FROM_DOC_FIELDS_BY_KIND: Record<ErpDocKind, readonly string[]> = {
  'purchase-request': MR_FROM_DOC_FIELDS,
  rfq: RFQ_FROM_DOC_FIELDS,
  quotation: SQ_FROM_DOC_FIELDS,
  'purchase-order': PO_FROM_DOC_FIELDS,
  'goods-receipt': GR_FROM_DOC_FIELDS,
  'purchase-invoice': PI_FROM_DOC_FIELDS,
  payment: PE_PAY_FROM_DOC_FIELDS,
  supplier: SUPPLIER_FROM_DOC_FIELDS,
  customer: CUSTOMER_FROM_DOC_FIELDS,
  contact: CONTACT_FROM_DOC_FIELDS,
  'sales-invoice': SI_FROM_DOC_FIELDS,
  'incoming-payment': PE_RECEIVE_FROM_DOC_FIELDS,
  // P3c: `budget` IS polled (`feedKinds.ts` SWEEP_UNPOLLED_KINDS is empty — the inbound never-adopt/never-fight-the-
  // operator branches landed). `accounts` is deliberately absent from its field list: the list endpoint
  // drops child tables anyway, and an ERP-side budget amount must never flow back into PMO (FR-BUD-152).
  budget: budgetFromDocFields(),
  timesheet: TS_FROM_DOC_FIELDS,
  employee: EMPLOYEE_FROM_DOC_FIELDS,
  // #775 phase B — expense postings (lifecycle-only inbound, FR-EXP-113).
  'expense-journal': EXPENSE_JOURNAL_FROM_DOC_FIELDS,
  'expense-payment': EXPENSE_PAYMENT_FROM_DOC_FIELDS,
  'expense-receipt': EXPENSE_PAYMENT_FROM_DOC_FIELDS,
  // #1515 §9 — site float transfers: the same lifecycle-only read as the expense journal.
  'imprest-transfer': EXPENSE_JOURNAL_FROM_DOC_FIELDS,
};

/** The fields the poll requests for one kind: the mapper's own fields plus the `payment_type`
 *  discriminator where the kind shares a doctype (BLOCK A1). Exported for direct unit testing. */
export function sweepFieldsForKind(kind: ErpDocKind, versionMajor?: number): string[] {
  const baseFields = kind === 'budget' ? budgetFromDocFields(versionMajor) : FROM_DOC_FIELDS_BY_KIND[kind] ?? [];
  const fields = new Set<string>(baseFields);
  const routingFields = ['name', 'modified', 'docstatus'];
  if (DOCTYPE_REGISTRY[kind].submittable) routingFields.push('amended_from');
  for (const routing of routingFields) fields.add(routing);
  if (PAYMENT_TYPE_BY_KIND[kind]) fields.add('payment_type');
  // #775 phase B (FR-EXP-113): the party/key discriminator's own fields — the per-row `admits` reads them.
  for (const field of pollDiscriminatorForKind(kind)?.fields ?? []) fields.add(field);
  // BLOCK 1: the recovery ANCHOR field (ADR-0058 §3 — 'remarks' for SI/PI/PR, 'reference_no' for the
  // Payment Entry kinds). Without it the poll cannot tell a PMO-originated, still-unresolved document
  // from a native one, and pull-adopts a SECOND PMO row for a doc the outbox is about to finalize.
  const anchorField = DOCTYPE_REGISTRY[kind].anchorField;
  if (anchorField) fields.add(anchorField);
  // WIRE 3 / B4: the `company` dimension, for the kinds whose doctype HAS one. The per-document
  // admission gate reads it off each returned row, and it fails CLOSED on a document that states no
  // company — so a poll that did not request the field would admit nothing at all. Never requested for
  // a global master (Supplier/Customer): Frappe rejects a list query naming a non-existent field.
  if (isCompanyScopedKind(kind)) fields.add('company');
  return Array.from(fields);
}

/**
 * Kinds whose canonical depends on a CHILD TABLE, which Frappe's list endpoint does not return
 * (Luna BLOCK 6). A Receive Payment Entry's `references` — the rows citing the Sales Invoice it pays —
 * is the money LINK behind `incoming_payments.sales_invoice_id`; without it every sweep-adopted receipt
 * is permanently unlinked from its invoice. These kinds therefore re-read each changed doc in full.
 * Deliberately minimal (no needless N+1): only the kinds whose child data drives a money column.
 */
export const KINDS_NEEDING_FULL_DOC: ErpDocKind[] = ['incoming-payment', 'contact'];

/** Luna BLOCK A1 (cross-domain corruption guard): `payment` (Pay/supplier) and `incoming-payment`
 *  (Receive/customer) share the ONE `Payment Entry` doctype (`doctypeRegistry.ts`) — polling it without
 *  a `payment_type` discriminator lets a Pay doc be adopted into `incoming_payments` (or vice-versa).
 *  Every OTHER kind polls its own dedicated doctype, so this map is empty for them (no filter needed).
 *  Exported for direct unit testing (mirrors the `reportVersionFromOrg` FIX-6 pattern). */
export const PAYMENT_TYPE_BY_KIND: Partial<Record<ErpDocKind, 'Pay' | 'Receive'>> = {
  payment: 'Pay',
  'incoming-payment': 'Receive',
  // #775 phase B — the Employee Payment Entry kinds poll their own direction.
  'expense-payment': 'Pay',
  'expense-receipt': 'Receive',
};

/**
 * The ONE definition of a kind's poll scope: payment direction (BLOCK A1) + party/key discriminator (#775 phase B,
 * FR-EXP-113) + company (WIRE 3). `extraFilters` is the server-side optimization; `admits` is the per-row authority.
 * `null` = UNSCOPEABLE (a company-scoped kind on a binding with no company) — the caller skips the kind.
 * Exported for direct unit testing (AC-EXP-122).
 */
export function pollFiltersForKind(
  kind: ErpDocKind,
  bindingCompany: string | null,
): { extraFilters: ErpFilter[]; admits: (row: Record<string, unknown>) => boolean } | null {
  const companyFilters = companyDocFilters(kind, bindingCompany);
  if (companyFilters === null) return null;
  const paymentType = PAYMENT_TYPE_BY_KIND[kind];
  const discriminator = pollDiscriminatorForKind(kind);
  return {
    extraFilters: [
      ...(paymentType ? ([['payment_type', '=', paymentType]] as ErpFilter[]) : []),
      ...((discriminator?.filters ?? []) as ErpFilter[]),
      ...(companyFilters as ErpFilter[]),
    ],
    admits: (row) =>
      (paymentType ? row.payment_type === paymentType : true)
      && (discriminator ? discriminator.admits(row) : true)
      && admitsDocForBindingCompany(kind, row, bindingCompany),
  };
}
