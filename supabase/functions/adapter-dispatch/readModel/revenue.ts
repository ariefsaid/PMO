import { AppError } from '../../../../pmo-portal/src/lib/appError.ts';
import type { AdapterCommand, PmoRecord } from '../../../../pmo-portal/src/lib/adapterSeam/contract.ts';
import { deriveSiStatus } from '../../../../pmo-portal/src/lib/adapterSeam/erpnext/siStatus.ts';
import { reconcileSiCancelAutoUnlink } from '../../../../pmo-portal/src/lib/adapterSeam/erpnext/transitionPolicy.ts';
import { buildsSalesInvoiceBody } from '../../../../pmo-portal/src/lib/adapterSeam/erpnext/dispatchFactory.ts';
import { recordOutboundLineage, resolveLinkOrNull } from './shared.ts';
import type { ReadModelWriter, ReadModelWriterCtx } from './types.ts';

// ============================================================================
// P3a Slice 2 — Revenue read-model writers (FR-SAR-013/103/121/161)
// ============================================================================


/** Structural seam for a LIST select (`.from(t).select(c).eq(...).eq(...)` awaited directly — the
 *  thenable PostgrestFilterBuilder shape real supabase-js resolves through with no terminal call).
 *  `ExternalRefsLookupClient` only models the `.maybeSingle()` single-row shape, and the SI-cancel
 *  auto-unlink needs every referencing row, not just one. */
/** Reconcile all receipt links for a cancelled invoice in one org-scoped update. */
async function unlinkPeReceivesOnSiCancel(ctx: ReadModelWriterCtx, canonical: PmoRecord): Promise<void> {
  const { peReceivePatch } = reconcileSiCancelAutoUnlink(String(canonical.id), String(canonical.erp_modified ?? ''));
  if (!peReceivePatch) return;
  const { error } = await (ctx.serviceClient.from('incoming_payments').update(peReceivePatch)
    .eq('org_id', ctx.orgId).eq('sales_invoice_id', String(canonical.id)) as unknown as Promise<{
      error: { message: string; code?: string } | null;
    }>);
  if (error) throw new AppError(error.message, error.code);
}

/** Append a body-writing caller to `sales_invoice_authors` — the APPEND-ONLY authorship SET the
 *  submit SoD reads (migration 0113).
 *
 *  `sales_invoices.author_user_id` records only the MOST RECENT body-writer, so authorship was
 *  last-writer-wins: A authors a 1,000,000 invoice, asks the designated approver B to fix one field,
 *  B's update re-stamps the author to B — and A, who chose the number, may now "approve" it, because
 *  the RPC compared the submitter against that one current value. The invariant is *nobody who ever
 *  wrote the body may approve*, so every body-building write APPENDS its caller here and the set is
 *  never overwritten. `author_user_id` is still stamped (0106's mirror guard and other code reference
 *  it) but is no longer the SoD oracle.
 *
 *  `ignoreDuplicates` makes a repeat writer a silent no-op (append-only, PK (sales_invoice_id,
 *  user_id)). A caller-less write (inbound feed / sweep finalize) appends nothing: a machine tick
 *  authors nothing, and an empty set already fails the submit closed. */
async function appendSalesInvoiceAuthor(ctx: ReadModelWriterCtx, salesInvoiceId: string): Promise<void> {
  if (!ctx.callerUserId) return;
  const { error } = await ctx.serviceClient.from('sales_invoice_authors').upsert(
    { org_id: ctx.orgId, sales_invoice_id: salesInvoiceId, user_id: ctx.callerUserId },
    { onConflict: 'sales_invoice_id,user_id', ignoreDuplicates: true },
  );
  if (error) throw new AppError(error.message, error.code);
}

/** `sales_invoices` — the SI read-model + project enhancement (spec §4.1).
 *  Mirrors ERP-derived canonical; `project_id`/`customer_id` from the command record;
 *  `status` via `deriveSiStatus` from `erp_outstanding_amount` + `erp_docstatus`;
 *  `erp_cancelled_at` stamped on docstatus 2. */
async function upsertSalesInvoiceMirror(ctx: ReadModelWriterCtx, canonical: PmoRecord, command: AdapterCommand): Promise<void> {
  const outstanding = (canonical.erp_outstanding_amount as string | null | undefined) ?? null;
  const docstatus = canonical.erp_docstatus as number | null | undefined;
  // DD-EFK-1: efaktur_number/efaktur_date are PMO-owned; intentionally absent from mirror writes.
  const patch: Record<string, unknown> = {
    si_number: canonical.si_number ?? null,
    // customer_id/project_id are PMO-side links set ONLY on create (from command.record, below) —
    // intentionally absent here: spreading them (even as null) would clobber the create-branch values
    // AND null a stable link on a later update mirror (inbound feed / status sync).
    reference_number: (canonical.reference_number as string | null | undefined) ?? null,
    invoice_date: (canonical.invoice_date as string | null | undefined) ?? null,
    amount: canonical.amount ?? null,
    erp_outstanding_amount: outstanding,
    // #478 (0188): `tax_treatment` says whether THIS ROW's `amount` includes `tax_amount`. This writer
    // sets `amount` from ERPNext's `grand_total`, which includes taxes BY DEFINITION — so 'inclusive'
    // here is a FACT about the figure just written, not a guess about how the ERP doc was keyed in.
    // It rides with `amount` deliberately: if a natively-authored 'exclusive' row is ever mirrored,
    // its amount becomes the grand total and the marker must follow it, or the row starts lying.
    tax_treatment: 'inclusive',
    ...(Object.prototype.hasOwnProperty.call(canonical, 'erp_project')
      ? { erp_project: canonical.erp_project }
      : {}),
    status: deriveSiStatus(outstanding, docstatus),
    erp_docstatus: docstatus ?? null,
    erp_modified: (canonical.erp_modified as string | null | undefined) ?? null,
    erp_amended_from: (canonical.erp_amended_from as string | null | undefined) ?? null,
    // stamp erp_cancelled_at on a cancel tombstone (docstatus 2)
    erp_cancelled_at: docstatus === 2 ? new Date().toISOString() : null,
  };
  // #1506 (0511): an Odoo-held invoice also records the Odoo facts (state, why it needs a person, the figure PMO sent, when it was read). ERPNext
  // canonicals carry none of these keys, so its writes are byte-for-byte unchanged. A read-back whose money header was incomplete carries no
  // `amount` at all: the money keys (and the status derived from them) are then left out whole, so an update never erases what the ledger said
  // and a create (which needs them) is refused by the NOT NULL it meets.
  if (Object.prototype.hasOwnProperty.call(canonical, 'odoo_state')) {
    patch.odoo_state = canonical.odoo_state ?? null;
    patch.odoo_attention = canonical.odoo_attention ?? null;
    patch.odoo_sent_total = canonical.odoo_sent_total ?? null;
    patch.odoo_read_at = canonical.odoo_read_at ?? null;
    if (canonical.amount === undefined) for (const key of ['amount', 'erp_outstanding_amount', 'status', 'tax_treatment']) delete patch[key];
  }
  // #478: `currency`, `tax_amount` and `tax_template` are OMITTED rather than written as null when the
  // canonical does not carry them (the `authorPatch` discipline already used below). `currency` and
  // `tax_amount` are NOT NULL columns — writing null would fail the write outright — and nulling a
  // recorded tax template on a status-sync tick would silently erase a fact ERP still holds.
  const siCurrency = (canonical.currency as string | null | undefined) ?? null;
  if (siCurrency !== null) patch.currency = siCurrency;
  const siTaxAmount = (canonical.tax_amount as string | null | undefined) ?? null;
  if (siTaxAmount !== null) patch.tax_amount = siTaxAmount;
  const siTaxTemplate = (canonical.tax_template as string | null | undefined) ?? null;
  if (siTaxTemplate !== null) patch.tax_template = siTaxTemplate;
  // #767: ERP's due_date and the mirrored receipt date. Written ONLY when ERP carries a value — an ERP
  // doc without the custom field must never erase a receipt date PMO recorded after submission. Stored
  // as ERP says it: 0244 checks "not before the invoice date" in the user RPC only, so this read-back
  // can never be refused (a refusal would stall the invoice's status sync).
  const siErpDue = (canonical.erp_due_date as string | null | undefined) ?? null;
  if (siErpDue !== null) patch.erp_due_date = siErpDue;
  const siReceived = (canonical.received_date as string | null | undefined) ?? null;
  if (siReceived !== null) patch.received_date = siReceived;
  if (command.operation === 'create') {
    const record = command.record as { projectId?: string; customerId?: string; workOrderId?: string | null; billingKind?: unknown };
    // Luna SF7 + BLOCK #11: cross-org FK guard — verify each non-null link belongs to ctx.orgId BEFORE
    // the service-role insert (RLS is bypassed, so the writer must enforce tenancy itself). A null link
    // (e.g. an SI without a project) skips the lookup — only asserted links are guarded. A link whose
    // row VANISHED in the TOCTOU window is nulled rather than fatal (the ERP invoice already exists;
    // it lands in the Unassigned bucket instead of becoming invisible money). A CROSS-ORG link still
    // throws.
    const customerId = await resolveLinkOrNull(ctx, 'companies', record.customerId);
    const projectId = await resolveLinkOrNull(ctx, 'projects', record.projectId);
    // #766 + OD-BILL-1 (DD-BWO-8): a create records the work order it bills — a claim's (set from the claim) or the
    // one an ordinary create names. The outbox fence (0262) checked its project, status and what is left before the
    // ERP write, so the same-project trigger (0193 §10) cannot refuse it here; an absent work order writes no key.
    const workOrderId = await resolveLinkOrNull(ctx, 'work_orders', record.workOrderId);
    // #1471 (D5): only the two known kinds are written; anything else is ignored so a bad value cannot abort the mirror
    // after the ERP document already exists. Update/transition branches never mention the column (FR-012).
    // A kind only means something on a project-linked invoice, so an unlinked mirror keeps the column default.
    const billingKind = projectId && (record.billingKind === 'contract' || record.billingKind === 'other') ? record.billingKind : null;
    // project_id and customer_id are machine-set from the command record
    // Luna BLOCK 4: stamp author_user_id = the dispatch caller (creator) so the submit SoD is not a
    // no-op (the RPC skips the approver≠author check when author is null). ctx.callerUserId is
    // undefined on the inbound-adopted path → null (SoD-exempt).
    const { error } = await ctx.serviceClient.from('sales_invoices').insert({
      id: canonical.id,
      org_id: ctx.orgId,
      project_id: projectId,
      erp_project: canonical.erp_project ?? null,
      customer_id: customerId,
      ...(workOrderId ? { work_order_id: workOrderId } : {}),
      ...(billingKind ? { billing_kind: billingKind } : {}),
      author_user_id: ctx.callerUserId ?? null,
      ...patch,
      // NOT NULL with no DB default (0188), so the create branch must always state it. ERPNext returns
      // `total_taxes_and_charges` on every Sales Invoice (0 when the doc carries no taxes), and
      // SI_FROM_DOC_FIELDS requests it — '0.00' is the untaxed-document case, never "unknown".
      tax_amount: siTaxAmount ?? '0.00',
    });
    if (error) throw new AppError(error.message, error.code);
    // 0113: the creator joins the append-only authorship SET (the submit SoD's real oracle).
    await appendSalesInvoiceAuthor(ctx, String(canonical.id));
    return;
  }
  // Luna re-audit (SoD, approver half) — WHOEVER BUILDS THE BODY IS THE AUTHOR.
  // `buildsSalesInvoiceBody` (imported from dispatchFactory — the ONE definition, never duplicated)
  // marks the operations that REBUILD the ERP Sales Invoice body from the caller-supplied `items`:
  // `update` (draft field PUT / routeEdit -> commitAmend) and `transition{verb:'amend'}`. Those SET
  // THE MONEY, but the submit SoD (`isRevenueSiSubmitTransition`) only fires on verb 'submit' — so
  // without this the designated approver B could rewrite A's draft to their own number under A's
  // name and then satisfy approver≠author against a person who never chose it. Re-stamping makes the
  // body-writer the author, which the RPC then refuses to let them self-approve.
  // A NON-body-building transition (submit/cancel) leaves authorship untouched: submitting is not
  // authoring. The service-role writer bypasses 0106's mirror guard (it early-returns on
  // `auth.jwt()->>'role' = 'service_role'`, verified), so no migration is needed for this write.
  //
  // ONLY when the caller is KNOWN. On the inbound feed / sweep finalize `ctx.callerUserId` is
  // undefined, and the key must be OMITTED rather than written as null — nulling a real author would
  // re-open the NULL-author SoD hole 0108 §B fails closed on (and a machine tick authors nothing).
  const buildsBody = buildsSalesInvoiceBody({
    operation: command.operation,
    // (the `as` mirrors dispatchFactory's own call site: PmoRecord is an index-signature record, so
    //  TypeScript's weak-type check rejects the structurally-fine `{ verb?: unknown }` narrowing)
    record: command.record as { verb?: unknown },
  });
  const authorPatch = ctx.callerUserId && buildsBody ? { author_user_id: ctx.callerUserId } : {};
  const { error } = await (
    ctx.serviceClient.from('sales_invoices').update({ ...patch, ...authorPatch }).eq('org_id', ctx.orgId).eq('id', canonical.id) as unknown as Promise<{
      error: { message: string; code?: string } | null;
    }>
  );
  if (error) throw new AppError(error.message, error.code);
  // 0113: the body-writer ALSO joins the append-only authorship SET. The scalar re-stamp above is
  // last-writer-wins (a later co-worker edit hands approval rights back to the original author); the
  // set is the invariant the submit SoD actually reads.
  if (buildsBody) await appendSalesInvoiceAuthor(ctx, String(canonical.id));
  // AC-SAR-022 (Luna B3): an SI cancel auto-unlinks its PE-receives ERP-side — mirror that here, or
  // the read-model keeps a stale allocation to a cancelled invoice.
  if (docstatus === 2) await unlinkPeReceivesOnSiCancel(ctx, canonical);
  // Slice-6 task 6.10/6.11 (P3a FR-SAR-050/052/053): a cancel/amend writes an external_ref_lineage
  // row (the audit record of the supersession — the outbound counterpart to the inbound apply path's
  // lineage.ts applyCancel/applyAmend). A no-op for a regular status sync (no docstatus-2, no amended_from).
  await recordOutboundLineage(ctx, canonical, 'revenue', canonical.si_number as string | undefined);
}

/** #1825 — a receipt finalize records its Odoo read-back on the invoice mirror. The settle (`settleReceipt`)
 *  read the invoice back from Odoo AFTER reconciling the receipt against it, so the receipt's own reference
 *  merged into `odoo_matched_payment_refs` — together with the money Odoo then showed — is the
 *  single-system evidence the invoice's awaiting-Odoo flag clears on: the reference appears in the invoice's
 *  read-back, and no wall-clock comparison decides anything. Canonicals without the block (ERPNext receipts,
 *  rows finalized before the evidence existed) write nothing; an unreadable header keeps the money keys out
 *  whole (the mirror never erases what the ledger said). */
async function recordReceiptReadBackOnInvoice(ctx: ReadModelWriterCtx, canonical: PmoRecord, salesInvoiceId: string | null): Promise<void> {
  const refs = canonical.odoo_matched_payment_refs;
  const readBack = canonical.odoo_invoice_read_back;
  if (!Array.isArray(refs) || refs.length === 0 || typeof readBack !== 'object' || readBack === null) return;
  if (salesInvoiceId === null) return;
  // #1825 (review I2): the merge is ONE server-side statement (`record_sales_invoice_receipt_read_back`,
  // 0695). The read-merge-write that stood here raced a concurrent receipt finalizing on the same
  // invoice — the loser's stale merge dropped the winner's ref, whose flag then never clears (no clock
  // fallback once the read-back is recorded). The RPC serializes concurrent callers on the invoice row
  // and appends-with-distinct, so every committed ref survives; a replay's duplicate collapses.
  const facts = readBack as { erp_modified?: unknown; erp_outstanding_amount?: unknown; odoo_read_at?: unknown };
  const outstanding = typeof facts.erp_outstanding_amount === 'string' ? facts.erp_outstanding_amount : null;
  const { error } = await ctx.serviceClient.rpc('record_sales_invoice_receipt_read_back', {
    p_org: ctx.orgId,
    p_invoice_id: salesInvoiceId,
    p_refs: refs.filter((ref): ref is string => typeof ref === 'string'),
    // A fact the read-back could not read is LEFT OUT (null → the RPC coalesces instead of writing):
    // the mirror never erases what the ledger said — erp_modified and odoo_read_at included (review M1).
    p_erp_modified: typeof facts.erp_modified === 'string' ? facts.erp_modified : null,
    p_outstanding: outstanding,
    p_status: outstanding !== null ? deriveSiStatus(outstanding, 1) : null,
    p_odoo_read_at: typeof facts.odoo_read_at === 'string' ? facts.odoo_read_at : null,
  });
  if (error) throw new AppError(error.message, error.code);
}

/** `incoming_payments` — the PE-receive read-model (spec §4.2).
 *  Mirrors ERP-derived canonical; `sales_invoice_id` resolved from the command's
 *  `record.salesInvoiceId`; `status` derives from docstatus (1 = Paid, else Scheduled);
 *  `erp_cancelled_at` on docstatus 2. */
async function upsertIncomingPaymentMirror(ctx: ReadModelWriterCtx, canonical: PmoRecord, command: AdapterCommand): Promise<void> {
  const docstatus = canonical.erp_docstatus as number | null | undefined;
  const patch: Record<string, unknown> = {
    ...(canonical.received_amount !== undefined ? { received_amount: canonical.received_amount } : {}),
    ...(canonical.withheld_amount !== undefined ? { withheld_amount: canonical.withheld_amount } : {}),
    ...(canonical.withholding_slip_number !== undefined ? { withholding_slip_number: canonical.withholding_slip_number } : {}),
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
    // Luna SF7 + BLOCK #11: cross-org FK guard — verify each non-null link belongs to ctx.orgId BEFORE
    // the service-role insert (RLS is bypassed). customer_id → companies, sales_invoice_id →
    // sales_invoices. A null link (e.g. an on-account PE with no customer/SI) skips the lookup. A link
    // whose row VANISHED in the TOCTOU window is nulled (the receipt becomes on-account) rather than
    // stranding a real ERP payment entry unmirrored; a CROSS-ORG link still throws.
    const customerId = await resolveLinkOrNull(ctx, 'companies', record.customerId);
    const salesInvoiceId = await resolveLinkOrNull(ctx, 'sales_invoices', record.salesInvoiceId);
    const { error } = await ctx.serviceClient.from('incoming_payments').insert({
      id: canonical.id,
      org_id: ctx.orgId,
      customer_id: customerId,
      sales_invoice_id: salesInvoiceId,
      date: record.date ?? null,
      // A same-key recovery may be retried under a different Finance JWT after Odoo committed. The
      // canonical was stamped from the original actor persisted on the money outbox; prefer that
      // verified witness over the replay caller.
      recorded_by_id: typeof canonical.recorded_by_id === 'string' ? canonical.recorded_by_id : ctx.callerUserId ?? null,
      ...patch,
    });
    if (error) {
      // #1825 (review I1): a REPLAY re-runs the create insert after the payment row already exists —
      // e.g. the first attempt died in the invoice read-back write below, or the outbox retried a
      // committed command. The duplicate key IS the already-applied receipt, so fall through to that
      // write instead of failing the replay forever (the awaiting-Odoo flag would stick: the canonical
      // records the read-back, so the clock fallback is disabled). A 23505 on a DIFFERENT row (or key)
      // is still a fault: the row is read back by (org, id) and only a match is treated as applied.
      if (error.code !== '23505') throw new AppError(error.message, error.code);
      const existing = await ctx.serviceClient.from('incoming_payments').select('id')
        .eq('org_id', ctx.orgId).eq('id', String(canonical.id)).maybeSingle();
      if (existing.error) throw new AppError(existing.error.message, existing.error.code);
      if (existing.data === null) throw new AppError(error.message, error.code);
    }
    await recordReceiptReadBackOnInvoice(ctx, canonical, salesInvoiceId);
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
/** P3a Slice 2 — Revenue writer (FR-SAR-013/121): dispatches by the command's `erp_doc_kind`
 *  (`sales-invoice` / `incoming-payment`) — additive, never touching `procurement` or `companies` entries.
 */
export const revenueWriter: ReadModelWriter = {
  // Keep the existing async wrapper: synchronous writer errors must remain rejected promises.
  // deno-lint-ignore require-await
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
