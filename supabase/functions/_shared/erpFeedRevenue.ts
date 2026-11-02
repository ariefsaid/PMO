import type { SupabaseClient } from '@supabase/supabase-js';
import { AppError } from '../../../pmo-portal/src/lib/appError.ts';
import { KIND_DOMAIN, type ErpDocKind } from '../../../pmo-portal/src/lib/adapterSeam/erpnext/feedKinds.ts';
import { deriveSiStatus } from '../../../pmo-portal/src/lib/adapterSeam/erpnext/siStatus.ts';
import { derivePiStatus } from '../../../pmo-portal/src/lib/adapterSeam/erpnext/piStatus.ts';
import { WITHHOLDING_REVIEW_FIELD } from '../../../pmo-portal/src/lib/adapterSeam/erpnext/bodies/incomingPayment.ts';
import type { PmoRecord } from '../../../pmo-portal/src/lib/adapterSeam/contract.ts';
import { allocationDetailsPatch } from './receiptAllocations.ts';
import { surfaceActionRequired } from './erpFeedNotifications.ts';

/**
 * The ONE incoming-payment status derivation (Luna BLOCK 8). `incoming_payments.status` is constrained
 * to `'Scheduled'|'Paid'` (0104) — there is no 'Cancelled' member — so a submitted receipt is `Paid` and
 * everything else (draft, and a CANCELLED receipt, which is no longer money received) is `Scheduled`.
 * Defined once and used by BOTH the mint and the update/cancel paths: a second, divergent copy of a
 * status derivation is exactly the defect class this codebase has already been bitten by.
 */
export function deriveIpStatus(docstatus: number | null | undefined): 'Scheduled' | 'Paid' {
  return docstatus === 1 ? 'Paid' : 'Scheduled';
}

/** Add `key: value` only when the inbound change actually carries the value — an absent field must
 *  never be written as NULL over live data (the update is a repair, not a wholesale overwrite). */
export function putIfPresent(patch: Record<string, unknown>, key: string, value: unknown): void {
  if (value !== undefined && value !== null) patch[key] = value;
}

/**
 * #876 (DD-VWH-5, FR-VWH-005) — FR-ENA-116's paid-detection, built. A mirrored Purchase Invoice's money and derived
 * status follow ERPNext on every inbound change that carries the WHOLE money header (`piFromDoc`: gross `amount`, VAT
 * `tax_amount`, `withheld_amount`, `erp_outstanding_amount`). All-or-nothing: a webhook carrying only part of it (an
 * operator-configured field subset) writes none of it, so a partial payload can never record a net total as the gross,
 * pair a new gross with a stale withholding, or flip a settled bill back to Received. `tax_treatment` rides with
 * `amount` (readModelWriters.ts' rule: 'inclusive' is a fact about a gross that includes VAT). Before this, a bill's
 * money was written only by its own dispatch, so a bill paid in ERPNext never showed Paid in PMO.
 */
export function purchaseInvoiceFieldPatch(kind: ErpDocKind, canonical: PmoRecord): Record<string, unknown> {
  if (kind !== 'purchase-invoice') return {};
  const amount = canonical.amount as string | null | undefined;
  const taxAmount = canonical.tax_amount as string | null | undefined;
  const withheld = canonical.withheld_amount as string | null | undefined;
  const outstanding = canonical.erp_outstanding_amount as string | null | undefined;
  if (amount == null || taxAmount == null || withheld == null || outstanding == null) return {};
  // The template the VAT/withholding was computed under rides with those figures; absent ⇒ omitted, never nulled.
  const taxTemplate = canonical.tax_template as string | null | undefined;
  return {
    amount, tax_amount: taxAmount, withheld_amount: withheld, tax_treatment: 'inclusive',
    erp_outstanding_amount: outstanding, status: derivePiStatus(outstanding),
    ...(taxTemplate != null ? { tax_template: taxTemplate } : {}),
  };
}

/**
 * The DERIVED-status + financial/link columns an inbound revenue change must repair on an EXISTING row
 * (Luna BLOCKs 6+8). Before this, `updateMirror` patched only `erp_*`, so: (a) a cancel/settle in ERP
 * never moved the PMO `status`, and (b) a row adopted with NULL money (or a payment adopted before its
 * invoice) could never be repaired — the sweep saw the row as "already mapped" forever.
 * Only fields the change CARRIES are written; PMO-owned columns (project_id) are never touched.
 */
export async function revenueFieldPatch(
  serviceClient: SupabaseClient,
  orgId: string,
  kind: ErpDocKind,
  canonical: PmoRecord,
): Promise<Record<string, unknown>> {
  if (KIND_DOMAIN[kind] !== 'revenue') return {};
  const docstatus = (canonical.erp_docstatus as number | null | undefined) ?? null;
  const patch: Record<string, unknown> = {};
  const customerId = await resolveCustomerId(serviceClient, orgId, canonical);
  putIfPresent(patch, 'customer_id', customerId);
  putIfPresent(patch, 'reference_number', (canonical as { reference_number?: unknown }).reference_number);
  putIfPresent(patch, 'amount', (canonical as { amount?: unknown }).amount);

  if (kind === 'sales-invoice') {
    if (Object.prototype.hasOwnProperty.call(canonical, 'erp_project')) patch.erp_project = canonical.erp_project;
    const outstanding = (canonical as { erp_outstanding_amount?: string | number | null }).erp_outstanding_amount;
    putIfPresent(patch, 'si_number', (canonical as { si_number?: unknown }).si_number);
    putIfPresent(patch, 'invoice_date', (canonical as { invoice_date?: unknown }).invoice_date);
    putIfPresent(patch, 'erp_outstanding_amount', outstanding);
    // Money-safety (audit SHOULD-FIX 2): `status` follows the SAME "only write what the change
    // carries" discipline as every column above it. `deriveSiStatus(null, 1)` is deliberately
    // 'Unpaid' (null is NOT zero, siStatus.ts) — so recomputing it from an absent oracle flipped a
    // SETTLED invoice back to 'Unpaid' and re-entered it into `open_ar` at its FULL amount. The
    // sweep always carries `outstanding_amount`, but a Frappe WEBHOOK maps whatever field subset the
    // operator configured, so a lifecycle-only payload is a real inbound shape. A cancel is the one
    // case whose oracle IS the docstatus, so it still derives.
    // The oracle for `status` is the LIFECYCLE (docstatus); `outstanding` only splits a SUBMITTED
    // invoice into Paid vs Unpaid. So both halves must be present before we rewrite it:
    //   • docstatus absent  -> leave status alone. deriveSiStatus(x, null) returns 'Draft', and since
    //     revenue positively allow-lists Submitted/Unpaid/Paid, a money-only webhook (outstanding
    //     present, docstatus omitted) would otherwise demote a live invoice to Draft and make its
    //     revenue and open AR VANISH from the rollup — while erp_docstatus still says 1.
    //   • docstatus 1 with no outstanding -> leave alone (a settled 'Paid' must not flip to 'Unpaid').
    //   • docstatus 0 or 2 -> the docstatus IS the whole oracle; always derive.
    if (docstatus != null && (docstatus !== 1 || outstanding != null)) {
      patch.status = deriveSiStatus(outstanding == null ? null : String(outstanding), docstatus);
    }
    return patch;
  }

  putIfPresent(patch, 'ip_number', (canonical as { ip_number?: unknown }).ip_number);
  putIfPresent(patch, 'date', (canonical as { date?: unknown }).date);
  putIfPresent(patch, 'received_amount', canonical.received_amount);
  if (canonical.withheld_amount !== undefined) patch.withheld_amount = canonical.withheld_amount;
  if (canonical.withholding_slip_number !== undefined) patch.withholding_slip_number = canonical.withholding_slip_number;
  Object.assign(patch, await allocationDetailsPatch(serviceClient, orgId, canonical));
  // The late-link repair: a Receive PE adopted BEFORE the Sales Invoice it cites kept
  // sales_invoice_id = NULL forever. An unresolvable reference leaves the column UNTOUCHED — a
  // repair pass must never un-link a payment that is already correctly linked.
  putIfPresent(patch, 'sales_invoice_id', await resolveSalesInvoiceId(serviceClient, orgId, canonical));
  // The IP twin of the SI status guard above: `status` carries an oracle only when the payload states
  // the lifecycle. A partial webhook that omits `docstatus` must NOT flip a Paid payment back to
  // Scheduled (deriveIpStatus(null) === 'Scheduled'). A cancel (docstatus 2) always writes.
  if (docstatus != null) patch.status = deriveIpStatus(docstatus);
  await surfaceWithholdingReview(serviceClient, orgId, canonical);
  return patch;
}

/**
 * #762 — a receipt whose withholding PMO could not confirm (the mapper marks it and mirrors the tax as
 * unknown) still syncs; this asks Finance to reconcile it in ERPNext. Best-effort, deduped per document
 * and reason by `surfaceActionRequired`.
 */
export async function surfaceWithholdingReview(serviceClient: SupabaseClient, orgId: string, canonical: PmoRecord): Promise<void> {
  const reason = canonical[WITHHOLDING_REVIEW_FIELD];
  if (typeof reason !== 'string') return;
  await surfaceActionRequired(serviceClient, orgId, 'receipt-withholding-unconfirmed', {
    erpName: String(canonical.ip_number ?? canonical.id ?? ''),
    reason,
  });
}

/** Resolve the PMO `customer_id` from the canonical's ERP customer name via `external_refs`
 *  (`Customer:<name>` in the companies domain). `null` only when unmapped/absent; a read error throws. */
export async function resolveCustomerId(serviceClient: SupabaseClient, orgId: string, canonical: PmoRecord): Promise<string | null> {
  const customerErpName = (canonical as { customer?: string | null }).customer;
  if (!customerErpName) return null;
  const { data, error } = await serviceClient.from('external_refs').select('pmo_record_id')
    .eq('org_id', orgId).eq('domain', 'companies').eq('external_record_id', `Customer:${customerErpName}`).maybeSingle();
  if (error) throw new AppError(error.message, error.code);
  return (data as { pmo_record_id?: string } | null)?.pmo_record_id ?? null;
}

/** Resolve the PMO `sales_invoice_id` a Receive PE's first `references` row cites. `null` when the
 *  cited invoice is not (yet) mapped — the caller must then leave the column alone; a read error throws. */
export async function resolveSalesInvoiceId(serviceClient: SupabaseClient, orgId: string, canonical: PmoRecord): Promise<string | null> {
  const references = (canonical as { references?: Array<{ reference_name?: string | null }> }).references;
  const siErpName = Array.isArray(references) ? references[0]?.reference_name : null;
  if (!siErpName) return null;
  const { data, error } = await serviceClient.from('external_refs').select('pmo_record_id')
    .eq('org_id', orgId).eq('domain', 'revenue').eq('external_record_id', siErpName).maybeSingle();
  if (error) throw new AppError(error.message, error.code);
  return (data as { pmo_record_id?: string } | null)?.pmo_record_id ?? null;
}
