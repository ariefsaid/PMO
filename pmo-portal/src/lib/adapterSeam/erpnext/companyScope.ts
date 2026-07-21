/**
 * erpnext/companyScope.ts — round-7 cross-family B4: the ONE definition of "does this ERP document
 * belong to the tenant this binding represents?".
 *
 * An ERPNext site routinely hosts several `Company` records (a group with two operating entities, a
 * partner hosting several clients). The binding names exactly ONE of them
 * (`external_org_bindings.config.company`, resolved at bind time by `binding.ts`) and every OUTBOUND
 * body stamps it. INBOUND adoption had no such scoping: the webhook admitted on HMAC + domain
 * ownership, the sweep's document filters carried only modified/payment-type. A Company-B Sales Invoice
 * or Receive Payment Entry was therefore adopted into Company A's PMO tenant and surfaced in its
 * revenue/AR views with no error — another tenant's financial data inside this one.
 *
 * Both inbound paths share this module so they cannot drift: the webhook applies
 * `admitsDocForBindingCompany` per event (the admission gate), the sweep applies `companyDocFilters`
 * to its list query (the same rule pushed server-side) AND the per-document gate on what comes back.
 *
 * Fail CLOSED, in both directions:
 *   • a company-scoped document that does not STATE its company is not adopted (an ERP that will not
 *     say whose money this is cannot be trusted to have meant ours), and
 *   • a binding that names no company can scope nothing, so it adopts no company-scoped document at all.
 * `null` from `companyDocFilters` means "unscopeable — do not sweep this kind", deliberately distinct
 * from `[]` ("no company dimension, sweep freely").
 */
import type { ErpDocKind } from './feedKinds.ts';

/** The kinds whose Frappe doctype carries a `company` field — every transaction/money doctype.
 *  `supplier`/`customer` are GLOBAL masters in ERPNext (a Customer is site-wide; only its optional
 *  accounts child-rows are per-company), so they have no company dimension to scope by. */
const COMPANY_SCOPED_KINDS: ReadonlySet<string> = new Set<ErpDocKind>([
  'purchase-request',
  'rfq',
  'quotation',
  'purchase-order',
  'goods-receipt',
  'purchase-invoice',
  'payment',
  'sales-invoice',
  'incoming-payment',
]);

/** Does this kind's ERP doctype carry a `company` dimension? */
export function isCompanyScopedKind(kind: ErpDocKind | string | undefined): boolean {
  return typeof kind === 'string' && COMPANY_SCOPED_KINDS.has(kind);
}

/** The ERP document's own `company` (exactly as ERPNext states it), or `null` when it states none. */
function docCompany(doc: unknown): string | null {
  const value = (doc as { company?: unknown } | null | undefined)?.company;
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/**
 * May this inbound ERP document be adopted into the tenant whose binding names `bindingCompany`?
 *
 * `true` only when the kind carries no company dimension (a global master), or the document states
 * EXACTLY this binding's company. Exact string comparison on purpose: an ERPNext Company name IS its
 * primary key, so trimming/casefolding would merge two genuinely distinct companies.
 */
export function admitsDocForBindingCompany(
  kind: ErpDocKind | undefined,
  doc: unknown,
  bindingCompany: string | null | undefined,
): boolean {
  if (kind === undefined) return false;            // unmapped kind — nothing to reason about
  if (!isCompanyScopedKind(kind)) return true;     // global master (Supplier/Customer)
  if (!bindingCompany) return false;               // the binding scopes nothing ⇒ adopt nothing
  return docCompany(doc) === bindingCompany;       // absent/other company ⇒ refused (fail closed)
}

/** A Frappe REST list filter triple, e.g. `['company','=','PMO Smoke Co']`. */
export type ErpDocFilter = [string, string, string];

/**
 * The company filter the SWEEP must conjoin onto its document-list query for this kind, so the ERP
 * never even returns another company's rows.
 *   • `[['company','=',<binding company>]]` — a company-scoped kind on a configured binding;
 *   • `[]`   — a global master (Supplier/Customer): no company dimension, nothing to filter;
 *   • `null` — UNSCOPEABLE (a company-scoped kind with no configured binding company): the caller MUST
 *              skip this kind entirely. Never `[]` here — an empty list reads as "no scoping needed"
 *              and would sweep the whole ERP site into one tenant, which is the B4 defect itself.
 */
export function companyDocFilters(
  kind: ErpDocKind | undefined,
  bindingCompany: string | null | undefined,
): ErpDocFilter[] | null {
  if (!isCompanyScopedKind(kind)) return kind === undefined ? null : [];
  if (!bindingCompany) return null;
  return [['company', '=', bindingCompany]];
}
