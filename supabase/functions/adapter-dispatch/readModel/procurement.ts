import { AppError } from '../../../../pmo-portal/src/lib/appError.ts';
import type { AdapterCommand, PmoRecord } from '../../../../pmo-portal/src/lib/adapterSeam/contract.ts';
import { mapErpDocstatus } from '../../../../pmo-portal/src/lib/adapterSeam/erpnext/doctypeRegistry.ts';
import { findPmoRecordId, type ExternalRefsLookupClient } from '../../../../pmo-portal/src/lib/adapterSeam/refs.ts';
import { derivePurchaseOrderStatus, deriveProcurementReceiptStatus } from '../../../../pmo-portal/src/lib/adapterSeam/erpnext/poGrStatus.ts';
import { derivePiStatus } from '../../../../pmo-portal/src/lib/adapterSeam/erpnext/piStatus.ts';
import { recordOutboundLineage, requireOwnOrgLink, resolveLinkOrNull } from './shared.ts';
import type { ReadModelWriter, ReadModelWriterCtx } from './types.ts';

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
    // B10: the FK must belong to THIS org (service-role write — RLS does not check it).
    await requireOwnOrgLink(ctx, 'procurements', procurementId);
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
    // B10: both FKs must belong to THIS org (service-role write — RLS does not check them).
    await requireOwnOrgLink(ctx, 'procurements', record.procurementId);
    await requireOwnOrgLink(ctx, 'companies', record.vendorId);
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
    await requireOwnOrgLink(ctx, 'procurements', record.procurementId);   // B10
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
    await requireOwnOrgLink(ctx, 'procurements', record.procurementId);   // B10
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
/** `procurement_invoices` (Slice 6, task 6.5, FR-ENA-115): `vi_number`/`amount` mirror the ERP-derived
 *  canonical (the header `grand_total` oracle, ADR-0048); `status` derives from
 *  `erp_outstanding_amount` (piStatus.ts's R9 paid-detection — Paid once a referenced PE submit flips
 *  outstanding to 0 server-side). `po_id` is left `null` on create (scope note: the R9-frozen PI body
 *  carries no PO link at all — unlike GR, there is no ERP-side or command-side PO reference to resolve
 *  from at write time; `po_id` stays whatever a later write sets, matching the column's own
 *  nullable/settlement-predecessor design, FR-PR-004b/004d). */
/** #876 slice 2 (OQ-VWH-6): the PPh type an entered-amounts command carries, or null. Only an entered-amount
 *  command — whose type the dispatch validated and persisted in the command record (`taxesFromAmounts`,
 *  resolvePurchaseInvoiceTaxes) — can state it; a template-path bill keeps NULL (the type is the ERPNext payable
 *  account). Never stated when nothing was withheld. Serves the create AND a recovery replay of one. */
function enteredPphType(record: Record<string, unknown>, withheld: string | null | undefined): string | null {
  const entered = record as { taxesFromAmounts?: unknown; pphType?: unknown };
  return entered.taxesFromAmounts === true && (entered.pphType === 'pph23' || entered.pphType === 'pph4_2')
    && Number(withheld ?? 0) !== 0 ? entered.pphType as string : null;
}

async function upsertInvoiceMirror(ctx: ReadModelWriterCtx, canonical: PmoRecord, command: AdapterCommand): Promise<void> {
  const outstanding = (canonical.erp_outstanding_amount as string | null | undefined) ?? null;
  const docstatus = canonical.erp_docstatus as number | null | undefined;
  // DD-EFK-1: efaktur_number/efaktur_date are PMO-owned; intentionally absent from mirror writes.
  const patch: Record<string, unknown> = {
    vi_number: canonical.vi_number ?? null,
    invoice_date: (canonical.invoice_date as string | null | undefined) ?? null,
    reference_number: (canonical.reference_number as string | null | undefined) ?? null,
    amount: canonical.amount ?? null,
    erp_outstanding_amount: outstanding,
    // #505 (0196): `tax_treatment` says whether THIS ROW's `amount` includes `tax_amount`. This
    // writer sets `amount` from ERPNext's `grand_total`, which includes taxes BY DEFINITION — so
    // 'inclusive' here is a FACT about the figure just written, not a guess about how the ERP doc
    // was keyed in. It rides with `amount` deliberately: if a natively-authored 'exclusive' row is
    // ever mirrored, its amount becomes the grand total and the marker must follow it, or the row
    // starts lying. Clause-for-clause the same as upsertSalesInvoiceMirror's (0188 / #478).
    tax_treatment: 'inclusive',
    status: derivePiStatus(outstanding),
    erp_docstatus: docstatus ?? null,
    erp_modified: (canonical.erp_modified as string | null | undefined) ?? null,
    erp_amended_from: (canonical.erp_amended_from as string | null | undefined) ?? null,
    // Slice-6 task 6.10: stamp erp_cancelled_at on a cancel tombstone (docstatus 2). null otherwise
    // (a fresh create, a draft update, or an amended docstatus-1 new doc are not cancelled).
    erp_cancelled_at: docstatus === 2 ? new Date().toISOString() : null,
  };
  // #505: `tax_amount` and `tax_template` are OMITTED rather than written as null when the canonical
  // does not carry them (the same `authorPatch` discipline the SI writer uses). `tax_amount` is a
  // NOT NULL column — writing null would fail the write outright — and nulling a recorded tax
  // template on a status-sync tick would silently erase a fact ERP still holds.
  const piTaxAmount = (canonical.tax_amount as string | null | undefined) ?? null;
  if (piTaxAmount !== null) patch.tax_amount = piTaxAmount;
  const piTaxTemplate = (canonical.tax_template as string | null | undefined) ?? null;
  if (piTaxTemplate !== null) patch.tax_template = piTaxTemplate;
  // #876: the bill's own currency (piFromDoc reads it off the ERP doc). Omitted when absent — NOT NULL, and the
  // stamp trigger's org-default fill is the PMO-native fallback, never a fact about this bill.
  const piCurrency = (canonical.currency as string | null | undefined) ?? null;
  if (piCurrency !== null) patch.currency = piCurrency;
  // #876 (0266, DD-VWH-1/7): the money header is all-or-nothing, the rule erpnextFeedDeps.ts' purchaseInvoiceFieldPatch
  // applies. piFromDoc emits `withheld_amount` only when the ERP header was complete; without it `amount` may be the NET
  // payable, so recording it as the gross (or pairing it with a stale withholding) is refused: a create throws, an update
  // writes none of amount / tax_amount / tax_treatment / withheld_amount.
  const piWithheld = (canonical.withheld_amount as string | null | undefined) ?? null;
  if (piWithheld !== null) {
    patch.withheld_amount = piWithheld;
  } else {
    delete patch.amount;
    delete patch.tax_amount;
    delete patch.tax_treatment;
  }
  // A canonical that does not carry the outstanding amount at all (an Odoo bill whose money header was withheld, #1505 FR-OPP-043)
  // writes neither it nor the status derived from it. A key that is present, null included, is written as before.
  if (!('erp_outstanding_amount' in canonical)) {
    delete patch.erp_outstanding_amount;
    delete patch.status;
  }
  if (command.operation === 'create') {
    const record = command.record as { procurementId?: string };
    if (!record.procurementId) throw new AppError('procurementId is required to mirror a created purchase invoice', 'BAD_REQUEST');
    await requireOwnOrgLink(ctx, 'procurements', record.procurementId);   // B10
    if (piWithheld === null) {
      throw new AppError('the purchase invoice read-back carried no withholding total; its money cannot be mirrored', 'BAD_REQUEST');
    }
    // #876 slice 2 (OQ-VWH-6): the PPh type is stored on every bill that withholds. ERPNext's header does not carry it,
    // so only an entered-amount create can state it (see enteredPphType).
    const pphType = enteredPphType(command.record as Record<string, unknown>, piWithheld);
    const { error } = await ctx.serviceClient.from('procurement_invoices').insert({
      id: canonical.id, org_id: ctx.orgId, procurement_id: record.procurementId,
      ...patch,
      ...(pphType ? { withheld_pph_type: pphType } : {}),
      // NOT NULL with no DB default (0196), so the create branch must always state it. ERPNext
      // returns `total_taxes_and_charges` on every Purchase Invoice (0 when the doc carries no
      // taxes), and PI_FROM_DOC_FIELDS requests it — '0.00' is the untaxed-document case, never
      // "unknown".
      tax_amount: piTaxAmount ?? '0.00',
    });
    if (error) throw new AppError(error.message, error.code);
    return;
  }
  // #876 slice 2 (OQ-VWH-6): a recovery replay of an entered-amounts create can arrive as an update against the
  // same command record — the type rides the marker exactly as on the create, and never without the money header
  // (the all-or-nothing rule above).
  const replayPphType = piWithheld !== null ? enteredPphType(command.record as Record<string, unknown>, piWithheld) : null;
  if (replayPphType !== null) patch.withheld_pph_type = replayPphType;
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
    // B10: the case FK is required (throws when cross-org/absent); the invoice link is OPTIONAL — a
    // cross-org one throws, and one that vanished in the TOCTOU window is nulled (same tolerance the
    // revenue writers apply: the ERP money already exists, so it must not become invisible).
    await requireOwnOrgLink(ctx, 'procurements', record.procurementId);
    const invoiceId = await resolveLinkOrNull(ctx, 'procurement_invoices', record.invoiceId);
    const { error } = await ctx.serviceClient.from('payments').insert({
      id: canonical.id,
      org_id: ctx.orgId,
      procurement_id: record.procurementId,
      invoice_id: invoiceId,
      date: record.date ?? null,
      // #910 (DD-VPAY-9, FR-VPAY-009): the pay artifact names its payer — the verified dispatch
      // caller. Undefined on a machine write (sweep finalize/replay) → null; and only HERE: the
      // update path below never writes the column, so a finalize retry/cancel tombstone can never
      // overwrite the original attribution.
      recorded_by_id: ctx.callerUserId ?? null,
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
/** P2 ERPNext `procurement` writer (task 4.5): dispatches by the command's `erp_doc_kind` — the SAME
 *  PMO-side discriminator `erpnext/doctypeRegistry.ts` uses (confinement, FR-ENA-013). Slice 4 wired
 *  the first 3 non-money sub-doctypes; slice 5 (task 5.4) appends `purchase-order`/`goods-receipt`;
 *  slice 6 appends `purchase-invoice`/`payment`, additively — this switch is the SHARED registration
 *  point. */
export const procurementWriter: ReadModelWriter = {
  // Keep the existing async wrapper: synchronous writer errors must remain rejected promises.
  // deno-lint-ignore require-await
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
