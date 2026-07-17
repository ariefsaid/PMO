/**
 * Multi-domain read-model writer registry (task 1.6). Replaces the dispatch's inline
 * `if (domain===CLICKUP_TASKS_DOMAIN)` with `READ_MODEL_WRITERS[domain]` so adding a domain never
 * grows an if-chain. ClickUp's `tasks` writer moves in verbatim (byte-for-byte); every other domain
 * that has no dedicated writer keeps the P0 `external_reference_items` behavior via the `reference`
 * entry. ERPNext's `companies`/`procurement` entries are registered here as explicit **not-yet-wired**
 * writers — a loud throw, never a silent no-op — until their real bodies land in slices 3–6; no org is
 * flipped in this slice so they are never called.
 *
 * Integration-only (like `index.ts`): not unit-tested through Vitest, verified by `deno check` +
 * `deno test readModelWriters.test.ts`. Relative imports only so this stays Deno-importable.
 */
import { AppError } from '../../../pmo-portal/src/lib/appError.ts';
import type { AdapterCommand, PmoRecord } from '../../../pmo-portal/src/lib/adapterSeam/contract.ts';
import { mapErpDocstatus } from '../../../pmo-portal/src/lib/adapterSeam/erpnext/doctypeRegistry.ts';
import { findPmoRecordId, type ExternalRefsLookupClient } from '../../../pmo-portal/src/lib/adapterSeam/refs.ts';
import { derivePurchaseOrderStatus, deriveProcurementReceiptStatus } from '../../../pmo-portal/src/lib/adapterSeam/erpnext/poGrStatus.ts';
import { derivePiStatus } from '../../../pmo-portal/src/lib/adapterSeam/erpnext/piStatus.ts';
import { deriveSiStatus } from '../../../pmo-portal/src/lib/adapterSeam/erpnext/siStatus.ts';
import { reconcileSiCancelAutoUnlink } from '../../../pmo-portal/src/lib/adapterSeam/erpnext/transitionPolicy.ts';

/** Structural service-role client seam the writers below need: `.from(t).{insert,update,upsert}`.
 *  The real supabase-js client satisfies this at runtime but is not nominally assignable (thenable
 *  PostgrestFilterBuilder) — callers cast `as never` at the boundary, matching `index.ts`'s existing
 *  cast idiom for `recordExternalRefWrite`. */
export interface ReadModelServiceClient {
  from(table: string): {
    insert(row: unknown): Promise<{ error: { message: string; code?: string } | null }>;
    upsert(
      rows: unknown,
      options: { onConflict: string },
    ): Promise<{ error: { message: string; code?: string } | null }>;
    update(patch: unknown): ReadModelEqChain;
  };
}
export interface ReadModelEqChain {
  eq(column: string, value: string): ReadModelEqChain;
}

export interface ReadModelWriterCtx {
  serviceClient: ReadModelServiceClient;
  orgId: string;
  /** Luna BLOCK 4: the dispatch caller's resolved user id (index.ts `verified.sub`), threaded in so a
   *  PMO-created sales invoice stamps `author_user_id` = the creator — the submit_sales_invoice SoD
   *  (approver≠author) is otherwise a no-op when author is null. Undefined on an inbound-adopted path
   *  (no PMO caller) → author_user_id stays null (SoD-exempt). */
  callerUserId?: string;
}

export interface ReadModelWriter {
  /** Write the canonical record into this domain's read-model. `command` carries the operation
   *  (create vs update/transition) and the original record fields (e.g. `project_id` on a task
   *  create), matching the fields the pre-1.6 inline branch relied on. */
  upsert(ctx: ReadModelWriterCtx, canonical: PmoRecord, command: AdapterCommand): Promise<void>;
  /** Tombstone-aware domains only (P1 `tasks`, AC-CUA-038) — omitted elsewhere. */
  tombstone?(ctx: ReadModelWriterCtx, pmoRecordId: string): Promise<void>;
}

/** P0 default: the generic `external_reference_items` mirror (byte-for-byte pre-1.6 `else` branch). */
const referenceWriter: ReadModelWriter = {
  async upsert(ctx, canonical) {
    const { error } = await ctx.serviceClient.from('external_reference_items').upsert(
      { org_id: ctx.orgId, pmo_record_id: canonical.id, payload: canonical },
      { onConflict: 'org_id,pmo_record_id' },
    );
    if (error) throw new AppError(error.message, error.code);
  },
};

/** P1 ClickUp `tasks` writer, moved in verbatim from `index.ts`'s pre-1.6 inline branch. */
const tasksWriter: ReadModelWriter = {
  async upsert(ctx, canonical, command) {
    const patch = {
      name: canonical.name,
      status: canonical.status,
      assignee_id: canonical.assignee_id ?? null,
      start_date: canonical.start_date ?? null,
      end_date: canonical.end_date ?? null,
      completed_at: (canonical.completed_at as string | null | undefined) ?? null,
      source_updated_at: new Date().toISOString(),
    };
    if (command.operation === 'create') {
      const projectId = (command.record as { project_id?: string }).project_id;
      if (!projectId) throw new AppError('project_id is required to mirror a created task', 'BAD_REQUEST');
      const { error } = await ctx.serviceClient
        .from('tasks')
        .insert({ id: canonical.id, org_id: ctx.orgId, project_id: projectId, ...patch });
      if (error) throw new AppError(error.message, error.code);
      return;
    }
    const { error } = await (
      ctx.serviceClient.from('tasks').update(patch).eq('org_id', ctx.orgId).eq('id', canonical.id) as unknown as Promise<{
        error: { message: string; code?: string } | null;
      }>
    );
    if (error) throw new AppError(error.message, error.code);
  },
  async tombstone(ctx, pmoRecordId) {
    const { error } = await (
      ctx.serviceClient
        .from('tasks')
        .update({ tombstoned_at: new Date().toISOString() })
        .eq('org_id', ctx.orgId)
        .eq('id', pmoRecordId) as unknown as Promise<{ error: { message: string; code?: string } | null }>
    );
    if (error) throw new AppError(error.message, error.code);
  },
};

/** ERPNext `companies` writer (task 3.6, FR-ENA-090): mirrors the adapter's canonical party shape
 *  (`name`/`type`/`erp_party_type`/`erp_supplier_name`/`erp_customer_name`/`erp_tax_id`/
 *  `erp_payment_terms_days`) into the `companies` read-model. `archived_at` is a PMO-owned
 *  enhancement (ADR-0018) — this writer NEVER sets it, on either create or update, so a mirror write
 *  can never clobber a user's soft-archive. */
const companiesWriter: ReadModelWriter = {
  async upsert(ctx, canonical, command) {
    const patch = {
      name: canonical.name,
      type: canonical.type,
      erp_party_type: (canonical.erp_party_type as string | null | undefined) ?? null,
      erp_supplier_name: (canonical.erp_supplier_name as string | null | undefined) ?? null,
      erp_customer_name: (canonical.erp_customer_name as string | null | undefined) ?? null,
      erp_tax_id: (canonical.erp_tax_id as string | null | undefined) ?? null,
      erp_payment_terms_days: (canonical.erp_payment_terms_days as number | null | undefined) ?? null,
    };
    if (command.operation === 'create') {
      const { error } = await ctx.serviceClient.from('companies').insert({ id: canonical.id, org_id: ctx.orgId, ...patch });
      if (error) throw new AppError(error.message, error.code);
      return;
    }
    const { error } = await (
      ctx.serviceClient.from('companies').update(patch).eq('org_id', ctx.orgId).eq('id', canonical.id) as unknown as Promise<{
        error: { message: string; code?: string } | null;
      }>
    );
    if (error) throw new AppError(error.message, error.code);
  },
};

/** A registered-but-not-yet-wired erp_doc_kind WITHIN the 'procurement' writer (task 4.5's own
 *  loud-throw discipline, one level down from `notWired` — 'procurement' the domain IS wired, but not
 *  every sub-doctype kind is yet). Slice 5 adds the purchase-order/goods-receipt cases to the switch
 *  below; slice 6 (purchase-invoice/payment) appends its own, additively. */
function kindNotWired(kind: unknown): never {
  throw new AppError(`erpnext procurement read-model writer for erp_doc_kind '${String(kind)}' is wired in slice 6`, 'UNSUPPORTED_DOMAIN');
}

/** `purchase_requests`/`rfqs` share the exact same mirror shape (§7: `<kind>_number`, `amount`,
 *  `erp_docstatus`, `erp_modified` + a derived `status`) — the only per-table deltas are the table
 *  name, the `<kind>_number` column name, and how a 'Submitted' docstatus maps into that table's own
 *  `status` CHECK domain (`rfqs` has no 'Submitted' value; it uses 'Issued' instead, FR-ENA-111). */
async function upsertHeaderMirror(
  ctx: ReadModelWriterCtx,
  canonical: PmoRecord,
  command: AdapterCommand,
  opts: { table: string; numberColumn: string; mapStatus: (label: ReturnType<typeof mapErpDocstatus>) => string },
): Promise<void> {
  const status = opts.mapStatus(mapErpDocstatus((canonical.erp_docstatus as number | null | undefined) ?? null));
  const mirrorFields: Record<string, unknown> = {
    [opts.numberColumn]: canonical[opts.numberColumn] ?? null,
    amount: canonical.amount ?? null,
    erp_docstatus: (canonical.erp_docstatus as number | null | undefined) ?? null,
    erp_modified: (canonical.erp_modified as string | null | undefined) ?? null,
    status,
  };
  if (command.operation === 'create') {
    const procurementId = (command.record as { procurementId?: string }).procurementId;
    if (!procurementId) throw new AppError(`procurementId is required to mirror a created ${opts.table} row`, 'BAD_REQUEST');
    const { error } = await ctx.serviceClient.from(opts.table).insert({ id: canonical.id, org_id: ctx.orgId, procurement_id: procurementId, ...mirrorFields });
    if (error) throw new AppError(error.message, error.code);
    return;
  }
  const { error } = await (
    ctx.serviceClient.from(opts.table).update(mirrorFields).eq('org_id', ctx.orgId).eq('id', canonical.id) as unknown as Promise<{
      error: { message: string; code?: string } | null;
    }>
  );
  if (error) throw new AppError(error.message, error.code);
}

/** `procurement_quotations` (§7, FR-ENA-112): native mirror is `total_amount`/`valid_until`/
 *  `vq_number`/`erp_*` — the PMO enhancement `is_selected` is NEVER touched here (it stays whatever
 *  the row already has; a fresh INSERT relies on the column's own `default false`, FR-ENA-130). */
async function upsertQuotationMirror(ctx: ReadModelWriterCtx, canonical: PmoRecord, command: AdapterCommand): Promise<void> {
  const mirrorFields: Record<string, unknown> = {
    vq_number: canonical.vq_number ?? null,
    total_amount: canonical.total_amount ?? null,
    valid_until: (canonical.valid_until as string | null | undefined) ?? null,
    erp_docstatus: (canonical.erp_docstatus as number | null | undefined) ?? null,
    erp_modified: (canonical.erp_modified as string | null | undefined) ?? null,
  };
  if (command.operation === 'create') {
    const record = command.record as { procurementId?: string; vendorId?: string };
    if (!record.procurementId || !record.vendorId) {
      throw new AppError('procurementId and vendorId are required to mirror a created procurement_quotations row', 'BAD_REQUEST');
    }
    const { error } = await ctx.serviceClient
      .from('procurement_quotations')
      .insert({ id: canonical.id, org_id: ctx.orgId, procurement_id: record.procurementId, vendor_id: record.vendorId, ...mirrorFields });
    if (error) throw new AppError(error.message, error.code);
    return;
  }
  const { error } = await (
    ctx.serviceClient.from('procurement_quotations').update(mirrorFields).eq('org_id', ctx.orgId).eq('id', canonical.id) as unknown as Promise<{
      error: { message: string; code?: string } | null;
    }>
  );
  if (error) throw new AppError(error.message, error.code);
}

/** `purchase_orders` (Slice 5, task 5.4, FR-ENA-113): `po_number`/`amount` mirror the ERP-derived
 *  canonical; `status` derives from `erp_docstatus` (poGrStatus.ts); `reference_number`/`date` are the
 *  ORIGINAL create-time PMO values (ERPNext's Purchase Order doctype has no equivalent field to
 *  re-derive them from on a later mirror refresh, unlike the invoice/receipt `bill_no`/`delivery_note`
 *  mirrors) — stamped once on create, left alone on a later update-mirror call. */
async function upsertPurchaseOrderMirror(ctx: ReadModelWriterCtx, canonical: PmoRecord, command: AdapterCommand): Promise<void> {
  const docstatus = canonical.erp_docstatus as number | null | undefined;
  const patch: Record<string, unknown> = {
    po_number: canonical.po_number ?? null,
    amount: canonical.amount ?? null,
    status: derivePurchaseOrderStatus(docstatus),
    erp_docstatus: docstatus ?? null,
    erp_modified: (canonical.erp_modified as string | null | undefined) ?? null,
    erp_amended_from: (canonical.erp_amended_from as string | null | undefined) ?? null,
  };
  if (command.operation === 'create') {
    const record = command.record as { procurementId?: string; referenceNumber?: string; date?: string };
    if (!record.procurementId) throw new AppError('procurementId is required to mirror a created purchase order', 'BAD_REQUEST');
    const { error } = await ctx.serviceClient.from('purchase_orders').insert({
      id: canonical.id,
      org_id: ctx.orgId,
      procurement_id: record.procurementId,
      reference_number: record.referenceNumber ?? null,
      date: record.date ?? null,
      ...patch,
    });
    if (error) throw new AppError(error.message, error.code);
    return;
  }
  const { error } = await (
    ctx.serviceClient.from('purchase_orders').update(patch).eq('org_id', ctx.orgId).eq('id', canonical.id) as unknown as Promise<{
      error: { message: string; code?: string } | null;
    }>
  );
  if (error) throw new AppError(error.message, error.code);
}

/** `procurement_receipts` (Slice 5, task 5.4, FR-ENA-114): `gr_number` mirrors ERP `name`; `po_id` is
 *  the RESOLVED `purchase_orders.id` (never the raw ERP PO name `grFromDoc.po_id` carries — resolved
 *  through `external_refs`, FR-ENA-103's "never a raw external name" clause) — `null` when the PO has
 *  no mapping yet (a standalone/unlinked GR, R9 §4). `status` derives from `erp_docstatus`
 *  (poGrStatus.ts). `receipt_date` is the ORIGINAL create-time PMO value (same reasoning as PO's
 *  `date`/`reference_number` — no ERP source to re-derive it from later). */
async function upsertGoodsReceiptMirror(ctx: ReadModelWriterCtx, canonical: PmoRecord, command: AdapterCommand): Promise<void> {
  const erpPoName = canonical.po_id as string | null | undefined;
  const resolvedPoId = erpPoName
    ? await findPmoRecordId(ctx.serviceClient as unknown as ExternalRefsLookupClient, ctx.orgId, 'procurement', erpPoName)
    : null;
  const docstatus = canonical.erp_docstatus as number | null | undefined;
  const patch: Record<string, unknown> = {
    gr_number: canonical.gr_number ?? null,
    reference_number: (canonical.reference_number as string | null | undefined) ?? null,
    po_id: resolvedPoId,
    status: deriveProcurementReceiptStatus(docstatus),
    erp_docstatus: docstatus ?? null,
    erp_modified: (canonical.erp_modified as string | null | undefined) ?? null,
  };
  if (command.operation === 'create') {
    const record = command.record as { procurementId?: string; receiptDate?: string };
    if (!record.procurementId) throw new AppError('procurementId is required to mirror a created goods receipt', 'BAD_REQUEST');
    const { error } = await ctx.serviceClient.from('procurement_receipts').insert({
      id: canonical.id,
      org_id: ctx.orgId,
      procurement_id: record.procurementId,
      receipt_date: record.receiptDate ?? null,
      ...patch,
    });
    if (error) throw new AppError(error.message, error.code);
    return;
  }
  const { error } = await (
    ctx.serviceClient.from('procurement_receipts').update(patch).eq('org_id', ctx.orgId).eq('id', canonical.id) as unknown as Promise<{
      error: { message: string; code?: string } | null;
    }>
  );
  if (error) throw new AppError(error.message, error.code);
}

/** Slice-6 task 6.10/6.11 (FR-ENA-052/053, NFR-ENA-DOC-001): writes an `external_ref_lineage` row for
 *  a PMO-INITIATED cancel or amend (the OUTBOUND counterpart to the inbound apply path's
 *  `lineage.ts` applyCancel/applyAmend, which slice 8 wires for webhook/sweep events). Called from
 *  the invoice/payment mirror writers AFTER the mirror upsert — the lineage row is the audit record of
 *  the supersession, separate from the mirror state itself. A docstatus-2 doc with no `amended_from` is
 *  a CANCEL (superseded name, no successor); a doc carrying `erp_amended_from` is an AMEND (the old
 *  name superseded by the new mirror name). Any other canonical (a fresh create, a draft update) is a
 *  no-op — a regular mirror supersedes nothing. Slice 6 has no inbound sweep, so this runs exactly once
 *  per finalized command (the outbox guarantees at-most-once finalize). The `domain` param stamps the
 *  lineage row's OWN domain (procurement OR revenue) — shared by both money-doc writers, never hardcoded. */
async function recordOutboundLineage(
  ctx: ReadModelWriterCtx,
  canonical: PmoRecord,
  domain: 'procurement' | 'revenue',
  erpName: string | undefined,
): Promise<void> {
  if (!erpName) return;
  const docstatus = canonical.erp_docstatus as number | null | undefined;
  const amendedFrom = (canonical.erp_amended_from as string | null | undefined) ?? null;
  if (docstatus === 2 && !amendedFrom) {
    const { error } = await ctx.serviceClient.from('external_ref_lineage').insert({
      org_id: ctx.orgId,
      domain,
      pmo_record_id: canonical.id,
      superseded_external_record_id: erpName,
      successor_external_record_id: null,
      reason: 'cancelled',
      erp_docstatus: 2,
    });
    if (error) throw new AppError(error.message, error.code);
    return;
  }
  if (amendedFrom) {
    const { error } = await ctx.serviceClient.from('external_ref_lineage').insert({
      org_id: ctx.orgId,
      domain,
      pmo_record_id: canonical.id,
      superseded_external_record_id: amendedFrom,
      successor_external_record_id: erpName,
      reason: 'amended',
      erp_docstatus: null,
    });
    if (error) throw new AppError(error.message, error.code);
  }
}

/** `procurement_invoices` (Slice 6, task 6.5, FR-ENA-115): `vi_number`/`amount` mirror the ERP-derived
 *  canonical (the header `grand_total` oracle, ADR-0048); `status` derives from
 *  `erp_outstanding_amount` (piStatus.ts's R9 paid-detection — Paid once a referenced PE submit flips
 *  outstanding to 0 server-side). `po_id` is left `null` on create (scope note: the R9-frozen PI body
 *  carries no PO link at all — unlike GR, there is no ERP-side or command-side PO reference to resolve
 *  from at write time; `po_id` stays whatever a later write sets, matching the column's own
 *  nullable/settlement-predecessor design, FR-PR-004b/004d). */
async function upsertInvoiceMirror(ctx: ReadModelWriterCtx, canonical: PmoRecord, command: AdapterCommand): Promise<void> {
  const outstanding = (canonical.erp_outstanding_amount as string | null | undefined) ?? null;
  const docstatus = canonical.erp_docstatus as number | null | undefined;
  const patch: Record<string, unknown> = {
    vi_number: canonical.vi_number ?? null,
    invoice_date: (canonical.invoice_date as string | null | undefined) ?? null,
    reference_number: (canonical.reference_number as string | null | undefined) ?? null,
    amount: canonical.amount ?? null,
    erp_outstanding_amount: outstanding,
    status: derivePiStatus(outstanding),
    erp_docstatus: docstatus ?? null,
    erp_modified: (canonical.erp_modified as string | null | undefined) ?? null,
    erp_amended_from: (canonical.erp_amended_from as string | null | undefined) ?? null,
    // Slice-6 task 6.10: stamp erp_cancelled_at on a cancel tombstone (docstatus 2). null otherwise
    // (a fresh create, a draft update, or an amended docstatus-1 new doc are not cancelled).
    erp_cancelled_at: docstatus === 2 ? new Date().toISOString() : null,
  };
  if (command.operation === 'create') {
    const record = command.record as { procurementId?: string };
    if (!record.procurementId) throw new AppError('procurementId is required to mirror a created purchase invoice', 'BAD_REQUEST');
    const { error } = await ctx.serviceClient.from('procurement_invoices').insert({ id: canonical.id, org_id: ctx.orgId, procurement_id: record.procurementId, ...patch });
    if (error) throw new AppError(error.message, error.code);
    return;
  }
  const { error } = await (
    ctx.serviceClient.from('procurement_invoices').update(patch).eq('org_id', ctx.orgId).eq('id', canonical.id) as unknown as Promise<{
      error: { message: string; code?: string } | null;
    }>
  );
  if (error) throw new AppError(error.message, error.code);
  // Slice-6 task 6.10/6.11: a cancel/amend writes an external_ref_lineage row (the audit record of the
  // supersession). A no-op for a regular draft update (no docstatus-2, no amended_from).
  await recordOutboundLineage(ctx, canonical, 'procurement', canonical.vi_number as string | undefined);
}

/** `payments` (Slice 6, task 6.5, FR-ENA-116): `pay_number`/`amount` mirror the ERP-derived canonical
 *  (the header `paid_amount` oracle — `peFromDoc`'s comment: a per-invoice allocated split, when the PE
 *  is multi-invoice, is a future refinement; this single-PE-row table mirrors the WHOLE PE). `invoice_id`
 *  is the command's OWN `record.invoiceId` — already a resolved PMO `procurement_invoices.id` at
 *  dispatch time (the FE/repository layer sets it, mirroring `create_payment`'s own `p_invoice_id`
 *  param), so unlike `purchase_orders`/`companies` refs this needs NO `external_refs` round-trip.
 *  `status` derives from `erp_docstatus` — a submitted (docstatus 1) PE is `'Paid'`; a draft/cancelled
 *  one stays `'Scheduled'` (the enum's pre-existing non-Paid value, FR-ENA-130e discipline). */
async function upsertPaymentMirror(ctx: ReadModelWriterCtx, canonical: PmoRecord, command: AdapterCommand): Promise<void> {
  const docstatus = canonical.erp_docstatus as number | null | undefined;
  const patch: Record<string, unknown> = {
    pay_number: canonical.pay_number ?? null,
    reference_number: (canonical.reference_number as string | null | undefined) ?? null,
    amount: canonical.amount ?? null,
    status: docstatus === 1 ? 'Paid' : 'Scheduled',
    erp_docstatus: docstatus ?? null,
    erp_modified: (canonical.erp_modified as string | null | undefined) ?? null,
    erp_amended_from: (canonical.erp_amended_from as string | null | undefined) ?? null,
    // Slice-6 task 6.11: stamp erp_cancelled_at on a cancel tombstone (docstatus 2).
    erp_cancelled_at: docstatus === 2 ? new Date().toISOString() : null,
  };
  if (command.operation === 'create') {
    const record = command.record as { procurementId?: string; invoiceId?: string; date?: string };
    if (!record.procurementId) throw new AppError('procurementId is required to mirror a created payment', 'BAD_REQUEST');
    const { error } = await ctx.serviceClient.from('payments').insert({
      id: canonical.id,
      org_id: ctx.orgId,
      procurement_id: record.procurementId,
      invoice_id: record.invoiceId ?? null,
      date: record.date ?? null,
      ...patch,
    });
    if (error) throw new AppError(error.message, error.code);
    return;
  }
  const { error } = await (
    ctx.serviceClient.from('payments').update(patch).eq('org_id', ctx.orgId).eq('id', canonical.id) as unknown as Promise<{
      error: { message: string; code?: string } | null;
    }>
  );
  if (error) throw new AppError(error.message, error.code);
  // Slice-6 task 6.11: a PE cancel writes an external_ref_lineage row.
  await recordOutboundLineage(ctx, canonical, 'procurement', canonical.pay_number as string | undefined);
}

// ============================================================================
// P3a Slice 2 — Revenue read-model writers (FR-SAR-013/103/121/161)
// ============================================================================

/** Luna SF7: cross-org FK guard. The service-role writer bypasses RLS, so before copying a PMO-side
 *  link (customer_id/project_id/sales_invoice_id) from the command into a created row, verify the
 *  referenced row belongs to ctx.orgId — otherwise the writer would silently link a sales invoice /
 *  incoming payment to ANOTHER org's record. A mismatch (or a missing referenced row) throws a
 *  classified 'cross-org-link-rejected' AppError; the dispatch never reaches the create insert. Same
 *  idiom as `findPmoRecordId` (the `as unknown as ExternalRefsLookupClient` cast over the structural
 *  client). */
async function assertLinkSameOrg(
  ctx: ReadModelWriterCtx,
  table: string,
  id: string,
): Promise<void> {
  const { data, error } = await (ctx.serviceClient as unknown as ExternalRefsLookupClient)
    .from(table)
    .select('org_id')
    .eq('id', id)
    .maybeSingle();
  if (error) throw new AppError(error.message, error.code);
  const orgId = (data as { org_id: string } | null)?.org_id;
  if (orgId !== ctx.orgId) {
    throw new AppError(
      `cross-org link rejected: ${table} '${id}' does not belong to org '${ctx.orgId}'`,
      'cross-org-link-rejected',
    );
  }
}

/** Structural seam for a LIST select (`.from(t).select(c).eq(...).eq(...)` awaited directly — the
 *  thenable PostgrestFilterBuilder shape real supabase-js resolves through with no terminal call).
 *  `ExternalRefsLookupClient` only models the `.maybeSingle()` single-row shape, and the SI-cancel
 *  auto-unlink needs every referencing row, not just one. */
interface ListSelectClient {
  from(table: string): { select(columns: string): ListFilterBuilder };
}
interface ListFilterBuilder extends PromiseLike<{ data: unknown; error: { message: string; code?: string } | null }> {
  eq(column: string, value: string): ListFilterBuilder;
}

/** AC-SAR-022 (Luna re-audit BLOCK 3) — the SI-cancel auto-unlink reconcile, OUTBOUND writer side.
 *  ERPNext returns 200 on an SI cancel even when a Receive Payment Entry references it, silently
 *  auto-unlinking the PE's `references` child table (OQ-SAR-1 #8 — unlike procurement, an active PE
 *  does NOT block the cancel). The PMO mirror must follow: every `incoming_payments` row still citing
 *  the cancelled SI becomes on-account (`sales_invoice_id` -> null), else the read-model shows a
 *  receipt allocated to an invoice ERPNext no longer considers allocated.
 *
 *  The per-row patch comes from `transitionPolicy.reconcileSiCancelAutoUnlink` (the designated pure
 *  helper — imported, never duplicated). Its `siTombstone` half is deliberately unused here: the SI's
 *  own `erp_cancelled_at`/`erp_docstatus`/`erp_modified` tombstone is already written by the caller's
 *  mirror `patch` from the ERP-refetched canonical; this writer applies only the PE-receive half. */
async function unlinkPeReceivesOnSiCancel(ctx: ReadModelWriterCtx, canonical: PmoRecord): Promise<void> {
  const { data, error } = await (ctx.serviceClient as unknown as ListSelectClient)
    .from('incoming_payments')
    .select('id')
    .eq('org_id', ctx.orgId)
    .eq('sales_invoice_id', String(canonical.id));
  if (error) throw new AppError(error.message, error.code);
  const referencing = Array.isArray(data) ? (data as Array<{ id: string }>) : [];
  const erpModified = (canonical.erp_modified as string | null | undefined) ?? '';
  for (const row of referencing) {
    const { peReceivePatch } = reconcileSiCancelAutoUnlink(row.id, erpModified);
    if (!peReceivePatch) continue;
    const { error: unlinkError } = await (
      ctx.serviceClient.from('incoming_payments').update(peReceivePatch).eq('org_id', ctx.orgId).eq('id', row.id) as unknown as Promise<{
        error: { message: string; code?: string } | null;
      }>
    );
    if (unlinkError) throw new AppError(unlinkError.message, unlinkError.code);
  }
}

/** `sales_invoices` — the SI read-model + project enhancement (spec §4.1).
 *  Mirrors ERP-derived canonical; `project_id`/`customer_id` from the command record;
 *  `status` via `deriveSiStatus` from `erp_outstanding_amount` + `erp_docstatus`;
 *  `erp_cancelled_at` stamped on docstatus 2. */
async function upsertSalesInvoiceMirror(ctx: ReadModelWriterCtx, canonical: PmoRecord, command: AdapterCommand): Promise<void> {
  const outstanding = (canonical.erp_outstanding_amount as string | null | undefined) ?? null;
  const docstatus = canonical.erp_docstatus as number | null | undefined;
  const patch: Record<string, unknown> = {
    si_number: canonical.si_number ?? null,
    // customer_id/project_id are PMO-side links set ONLY on create (from command.record, below) —
    // intentionally absent here: spreading them (even as null) would clobber the create-branch values
    // AND null a stable link on a later update mirror (inbound feed / status sync).
    reference_number: (canonical.reference_number as string | null | undefined) ?? null,
    invoice_date: (canonical.invoice_date as string | null | undefined) ?? null,
    amount: canonical.amount ?? null,
    erp_outstanding_amount: outstanding,
    status: deriveSiStatus(outstanding, docstatus),
    erp_docstatus: docstatus ?? null,
    erp_modified: (canonical.erp_modified as string | null | undefined) ?? null,
    erp_amended_from: (canonical.erp_amended_from as string | null | undefined) ?? null,
    // stamp erp_cancelled_at on a cancel tombstone (docstatus 2)
    erp_cancelled_at: docstatus === 2 ? new Date().toISOString() : null,
  };
  if (command.operation === 'create') {
    const record = command.record as { projectId?: string; customerId?: string };
    // Luna SF7: cross-org FK guard — verify each non-null link belongs to ctx.orgId BEFORE the
    // service-role insert (RLS is bypassed, so the writer must enforce tenancy itself). A null link
    // (e.g. an SI without a project) skips the lookup — only asserted links are guarded.
    if (record.customerId) await assertLinkSameOrg(ctx, 'companies', record.customerId);
    if (record.projectId) await assertLinkSameOrg(ctx, 'projects', record.projectId);
    // project_id and customer_id are machine-set from the command record
    // Luna BLOCK 4: stamp author_user_id = the dispatch caller (creator) so the submit SoD is not a
    // no-op (the RPC skips the approver≠author check when author is null). ctx.callerUserId is
    // undefined on the inbound-adopted path → null (SoD-exempt).
    const { error } = await ctx.serviceClient.from('sales_invoices').insert({
      id: canonical.id,
      org_id: ctx.orgId,
      project_id: record.projectId ?? null,
      customer_id: record.customerId ?? null,
      author_user_id: ctx.callerUserId ?? null,
      ...patch,
    });
    if (error) throw new AppError(error.message, error.code);
    return;
  }
  const { error } = await (
    ctx.serviceClient.from('sales_invoices').update(patch).eq('org_id', ctx.orgId).eq('id', canonical.id) as unknown as Promise<{
      error: { message: string; code?: string } | null;
    }>
  );
  if (error) throw new AppError(error.message, error.code);
  // AC-SAR-022 (Luna B3): an SI cancel auto-unlinks its PE-receives ERP-side — mirror that here, or
  // the read-model keeps a stale allocation to a cancelled invoice.
  if (docstatus === 2) await unlinkPeReceivesOnSiCancel(ctx, canonical);
  // Slice-6 task 6.10/6.11 (P3a FR-SAR-050/052/053): a cancel/amend writes an external_ref_lineage
  // row (the audit record of the supersession — the outbound counterpart to the inbound apply path's
  // lineage.ts applyCancel/applyAmend). A no-op for a regular status sync (no docstatus-2, no amended_from).
  await recordOutboundLineage(ctx, canonical, 'revenue', canonical.si_number as string | undefined);
}

/** `incoming_payments` — the PE-receive read-model (spec §4.2).
 *  Mirrors ERP-derived canonical; `sales_invoice_id` resolved from the command's
 *  `record.salesInvoiceId`; `status` derives from docstatus (1 = Paid, else Scheduled);
 *  `erp_cancelled_at` on docstatus 2. */
async function upsertIncomingPaymentMirror(ctx: ReadModelWriterCtx, canonical: PmoRecord, command: AdapterCommand): Promise<void> {
  const docstatus = canonical.erp_docstatus as number | null | undefined;
  const patch: Record<string, unknown> = {
    ip_number: canonical.ip_number ?? null,
    // customer_id/sales_invoice_id/date are PMO-side links+values set ONLY on create (from
    // command.record, below) — intentionally absent here: spreading them (even as null) would clobber
    // the create-branch values AND null a stable link/value on a later update mirror (inbound feed /
    // status sync). Luna SF6: `date` was previously in this patch (canonical.date, null from
    // peReceiveFromDoc) and the create branch spread `...patch` AFTER `date: record.date`, clobbering
    // the create-time date to null — now removed, matching the customer_id/sales_invoice_id discipline.
    reference_number: (canonical.reference_number as string | null | undefined) ?? null,
    amount: canonical.amount ?? null,
    status: docstatus === 1 ? 'Paid' : 'Scheduled',
    erp_docstatus: docstatus ?? null,
    erp_modified: (canonical.erp_modified as string | null | undefined) ?? null,
    erp_amended_from: (canonical.erp_amended_from as string | null | undefined) ?? null,
    // stamp erp_cancelled_at on a cancel tombstone (docstatus 2)
    erp_cancelled_at: docstatus === 2 ? new Date().toISOString() : null,
  };
  if (command.operation === 'create') {
    const record = command.record as { customerId?: string; salesInvoiceId?: string; date?: string };
    // Luna SF7: cross-org FK guard — verify each non-null link belongs to ctx.orgId BEFORE the
    // service-role insert (RLS is bypassed). customer_id → companies, sales_invoice_id →
    // sales_invoices. A null link (e.g. an on-account PE with no customer/SI) skips the lookup.
    if (record.customerId) await assertLinkSameOrg(ctx, 'companies', record.customerId);
    if (record.salesInvoiceId) await assertLinkSameOrg(ctx, 'sales_invoices', record.salesInvoiceId);
    const { error } = await ctx.serviceClient.from('incoming_payments').insert({
      id: canonical.id,
      org_id: ctx.orgId,
      customer_id: record.customerId ?? null,
      sales_invoice_id: record.salesInvoiceId ?? null,
      date: record.date ?? null,
      ...patch,
    });
    if (error) throw new AppError(error.message, error.code);
    return;
  }
  const { error } = await (
    ctx.serviceClient.from('incoming_payments').update(patch).eq('org_id', ctx.orgId).eq('id', canonical.id) as unknown as Promise<{
      error: { message: string; code?: string } | null;
    }>
  );
  if (error) throw new AppError(error.message, error.code);
  // Slice-6 task 6.10/6.11 (P3a FR-SAR-050/052/053): a cancel writes an external_ref_lineage row.
  await recordOutboundLineage(ctx, canonical, 'revenue', canonical.ip_number as string | undefined);
}

/** P2 ERPNext `procurement` writer (task 4.5): dispatches by the command's `erp_doc_kind` — the SAME
 *  PMO-side discriminator `erpnext/doctypeRegistry.ts` uses (confinement, FR-ENA-013). Slice 4 wired
 *  the first 3 non-money sub-doctypes; slice 5 (task 5.4) appends `purchase-order`/`goods-receipt`;
 *  slice 6 appends `purchase-invoice`/`payment`, additively — this switch is the SHARED registration
 *  point. */
const procurementWriter: ReadModelWriter = {
  async upsert(ctx, canonical, command) {
    const kind = (command.record as { erp_doc_kind?: string }).erp_doc_kind;
    switch (kind) {
      case 'purchase-request':
        return upsertHeaderMirror(ctx, canonical, command, {
          table: 'purchase_requests',
          numberColumn: 'pr_number',
          // purchase_requests.status has no 'Cancelled' value (Draft|Submitted|Approved|Closed) — the
          // terminal ERP-cancelled state maps onto the existing 'Closed' value instead (FR-ENA-130e:
          // status CHECK constraints are preserved unchanged, populated by derivation).
          mapStatus: (s) => (s === 'Cancelled' ? 'Closed' : s),
        });
      case 'rfq':
        return upsertHeaderMirror(ctx, canonical, command, {
          table: 'rfqs',
          numberColumn: 'rfq_number',
          // rfqs.status has no 'Submitted'/'Cancelled' value (Draft|Issued|Closed) — FR-ENA-111.
          mapStatus: (s) => (s === 'Submitted' ? 'Issued' : s === 'Cancelled' ? 'Closed' : s),
        });
      case 'quotation':
        return upsertQuotationMirror(ctx, canonical, command);
      case 'purchase-order':
        return upsertPurchaseOrderMirror(ctx, canonical, command);
      case 'goods-receipt':
        return upsertGoodsReceiptMirror(ctx, canonical, command);
      case 'purchase-invoice':
        return upsertInvoiceMirror(ctx, canonical, command);
      case 'payment':
        return upsertPaymentMirror(ctx, canonical, command);
      default:
        return kindNotWired(kind);
    }
  },
};

/**
 * Mirrors an ERP line's `quantity`/`rate`/`erp_line_amount`/`erp_docstatus`/`erp_modified` onto an
 * EXISTING `procurement_items` row (§7, FR-ENA-071) — NEVER `amount` (the `quantity*rate` GENERATED
 * column, FR-ENA-171: the adapter must never attempt to write it).
 *
 * Scope note (task 4.5): this is the typed, tested per-row mirror PRIMITIVE. Wiring it into the live
 * `procurementWriter.upsert` switch above needs a concrete PMO-item<->ERP-line-row correlation — MR/
 * RFQ/SQ commands this slice carry `items` inline in the command body (no `procurement_items.id`
 * round-trips through the ERP body/response, R9's bodies §0/§3 send only `{item_code,qty,rate,...}`)
 * so there is no existing target row to correlate an ERP-returned line against yet. Slices 5/6 (PO/GR)
 * resolve the PO item CHILD-ROW `name` explicitly (FR-ENA-103) and are the first callers with a real
 * key to correlate against — this primitive is what they call. Never guessed/auto-matched here.
 */
export async function upsertProcurementItemMirror(
  ctx: ReadModelWriterCtx,
  procurementItemId: string,
  line: { quantity: string; rate: string; erpLineAmount: string | null; erpDocstatus: number | null; erpModified: string | null },
): Promise<void> {
  const { error } = await (
    ctx.serviceClient
      .from('procurement_items')
      .update({ quantity: line.quantity, rate: line.rate, erp_line_amount: line.erpLineAmount, erp_docstatus: line.erpDocstatus, erp_modified: line.erpModified })
      .eq('org_id', ctx.orgId)
      .eq('id', procurementItemId) as unknown as Promise<{ error: { message: string; code?: string } | null }>
  );
  if (error) throw new AppError(error.message, error.code);
}

/** P3a Slice 2 — Revenue writer (FR-SAR-013/121): dispatches by the command's `erp_doc_kind`
 *  (`sales-invoice` / `incoming-payment`) — additive, never touching `procurement` or `companies` entries.
 */
const revenueWriter: ReadModelWriter = {
  async upsert(ctx, canonical, command) {
    const kind = (command.record as { erp_doc_kind?: string }).erp_doc_kind;
    switch (kind) {
      case 'sales-invoice':
        return upsertSalesInvoiceMirror(ctx, canonical, command);
      case 'incoming-payment':
        return upsertIncomingPaymentMirror(ctx, canonical, command);
      default:
        throw new AppError(`erpnext revenue read-model writer for erp_doc_kind '${String(kind)}' is not wired`, 'UNSUPPORTED_DOMAIN');
    }
  },
};

// Both P2 ERPNext domains are wired: `companies` (task 3.6, supplier/customer parties) and
// `procurement` (task 4.5/5.4, the per-erp_doc_kind money-doc switch above) — one registry entry per
// domain, never a per-slice edit to another domain's entry (confinement, FR-ENA-013/090).
// P3a adds `revenue` (task 2.4) additively.
export const READ_MODEL_WRITERS: Record<string, ReadModelWriter> = {
  reference: referenceWriter,
  tasks: tasksWriter,
  companies: companiesWriter,
  procurement: procurementWriter,
  revenue: revenueWriter,
};

/** The single lookup point — an unknown domain throws (no silent skip). */
export function getReadModelWriter(domain: string): ReadModelWriter {
  const writer = READ_MODEL_WRITERS[domain];
  if (!writer) throw new AppError(`no read-model writer registered for domain "${domain}"`, 'UNSUPPORTED_DOMAIN');
  return writer;
}
