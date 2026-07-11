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
import { findPmoRecordId, type ExternalRefsLookupClient } from '../../../pmo-portal/src/lib/adapterSeam/refs.ts';
import { derivePurchaseOrderStatus, deriveProcurementReceiptStatus } from '../../../pmo-portal/src/lib/adapterSeam/erpnext/poGrStatus.ts';

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

/** A registered-but-not-yet-wired writer (task 1.6): fails loud rather than a silent `()=>{}`
 *  no-op — a silent no-op would swallow a real write if a flip ever landed early. */
const notWired = (domain: string): ReadModelWriter => ({
  upsert(): never {
    throw new Error(`erpnext read-model writer for '${domain}' is wired in slices 3–6`);
  },
});

/**
 * ERPNext `procurement` domain (task 5.4): ONE PMO domain spans SEVEN doctype-shaped mirror tables,
 * discriminated internally by `record.erp_doc_kind` (never a Frappe doctype name above this file —
 * confinement, FR-ENA-013). `PROCUREMENT_KIND_WRITERS` is the single, ADDITIVE per-kind dispatch
 * table — each slice registers only the kinds it owns; an un-owned/absent kind still throws (task
 * 1.6's byte-for-byte "loud, never silent" contract).
 */
type ProcurementKindWriter = (ctx: ReadModelWriterCtx, canonical: PmoRecord, command: AdapterCommand) => Promise<void>;
const PROCUREMENT_KIND_WRITERS: Partial<Record<string, ProcurementKindWriter>> = {};

/** `purchase_orders` (FR-ENA-113): `po_number`/`amount` mirror the ERP-derived canonical; `status`
 *  derives from `erp_docstatus` (poGrStatus.ts); `reference_number`/`date` are the ORIGINAL
 *  create-time PMO values (ERPNext's Purchase Order doctype has no equivalent field to re-derive them
 *  from on a later mirror refresh, unlike the invoice/receipt `bill_no`/`delivery_note` mirrors) —
 *  stamped once on create, left alone on a later update-mirror call. */
PROCUREMENT_KIND_WRITERS['purchase-order'] = async (ctx, canonical, command) => {
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
};

/** `procurement_receipts` (FR-ENA-114): `gr_number` mirrors ERP `name`; `po_id` is the RESOLVED
 *  `purchase_orders.id` (never the raw ERP PO name `grFromDoc.po_id` carries — resolved through
 *  `external_refs`, FR-ENA-103's "never a raw external name" clause) — `null` when the PO has no
 *  mapping yet (a standalone/unlinked GR, R9 §4). `status` derives from `erp_docstatus`
 *  (poGrStatus.ts). `receipt_date` is the ORIGINAL create-time PMO value (same reasoning as PO's
 *  `date`/`reference_number` — no ERP source to re-derive it from later). */
PROCUREMENT_KIND_WRITERS['goods-receipt'] = async (ctx, canonical, command) => {
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
};

/** The `procurement` domain writer: routes by `record.erp_doc_kind` to the owning kind-writer above.
 *  An absent/un-owned kind throws (task 1.6's contract) — never a silent no-op. */
const procurementWriter: ReadModelWriter = {
  async upsert(ctx, canonical, command) {
    const kind = (command.record as { erp_doc_kind?: string }).erp_doc_kind;
    const handler = kind ? PROCUREMENT_KIND_WRITERS[kind] : undefined;
    if (!handler) throw new Error(`erpnext procurement read-model writer for kind '${kind}' is wired in slices 4-6`);
    return handler(ctx, canonical, command);
  },
};

export const READ_MODEL_WRITERS: Record<string, ReadModelWriter> = {
  reference: referenceWriter,
  tasks: tasksWriter,
  companies: notWired('companies'),
  procurement: procurementWriter,
};

/** The single lookup point — an unknown domain throws (no silent skip). */
export function getReadModelWriter(domain: string): ReadModelWriter {
  const writer = READ_MODEL_WRITERS[domain];
  if (!writer) throw new AppError(`no read-model writer registered for domain "${domain}"`, 'UNSUPPORTED_DOMAIN');
  return writer;
}
