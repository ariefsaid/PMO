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

// Both P2 ERPNext domains are wired: `companies` (task 3.6, supplier/customer parties) and
// `procurement` (task 4.5/5.4, the per-erp_doc_kind money-doc switch above) — one registry entry per
// domain, never a per-slice edit to another domain's entry (confinement, FR-ENA-013/090).
export const READ_MODEL_WRITERS: Record<string, ReadModelWriter> = {
  reference: referenceWriter,
  tasks: tasksWriter,
  companies: companiesWriter,
  procurement: procurementWriter,
};

/** The single lookup point — an unknown domain throws (no silent skip). */
export function getReadModelWriter(domain: string): ReadModelWriter {
  const writer = READ_MODEL_WRITERS[domain];
  if (!writer) throw new AppError(`no read-model writer registered for domain "${domain}"`, 'UNSUPPORTED_DOMAIN');
  return writer;
}
