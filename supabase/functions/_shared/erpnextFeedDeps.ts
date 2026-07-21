/**
 * erpnextFeedDeps — SHARED edge-fn wiring for the ERPNext inbound feed apply deps (task 8.2/8.6).
 * Builds the `ErpFeedDeps` (ApplyChangeDeps + LineageDeps + SupersededNameLookupDeps) that
 * `erpnext/applyFeed.applyErpFeedEvent` consumes, for ONE (org, kind) pair. The webhook (8.2) and the
 * sweep (8.6) both call this after decoding an event's kind.
 *
 * EDGE-FN WIRING (depends on the real supabase-js client + does DB writes), NOT pure logic — lives in
 * `_shared/`, not the pure `erpnext/**` lib (confinement: this file carries no Frappe doctype/field
 * vocabulary, only PMO-shaped records + the `erp_*` mirror columns). Deno-only (imported by edge fns);
 * relative imports resolve via each fn's deno.json import map.
 *
 * Luna re-audit (money path). Four corrections live here:
 *   • BLOCK 8 — every inbound lifecycle change (cancel included) derives the mirror's `status` through
 *     the CANONICAL `deriveSiStatus` / the single `deriveIpStatus` below; revenue rollups key on
 *     `status <> 'Cancelled'`, so stamping only `erp_*` left a cancelled invoice counted as live money.
 *   • BLOCK 6 — an update REPAIRS the revenue financial/link columns (amount, outstanding, dates,
 *     customer, and a late-resolving `sales_invoice_id`), not just the `erp_*` ones. Only fields the
 *     change carries are written; PMO-owned columns (project_id) are never touched.
 *   • BLOCK 7 — adoption is CLAIM-FIRST (`adoptAtomically`): the `external_refs` claim precedes the
 *     mirror insert, so a losing concurrent adopt leaves no orphan money row.
 *   • BLOCK 13 — a project-less inbound SI raises a real Finance notification (0048's surface).
 *
 * Scope (slice 8 — the change-feed infrastructure): the feed's PRIMARY job is the lifecycle routing —
 * cancel (docstatus 2 → erp_cancelled_at + erp_docstatus=2), amend (repoint external_refs + stamp
 * erp_amended_from), superseded-name no-op, and status/erp_modified sync. These are written to the
 * per-kind mirror table's `erp_*` columns directly here. The full per-kind native-field re-sync from a
 * field-level desk edit (grand_total, outstanding, …) is owned by the dispatch read-model writers
 * (slices 3-6, `adapter-dispatch/readModelWriters.ts`) on the OUTBOUND commit; the inbound feed stamps
 * the lifecycle/status columns this slice. Inbound ADOPT (mint) is wired for parties (`companies` —
 * commonly created natively in ERP, OQ-4); procurement inbound adopt requires the PMO procurement-case
 * link the dispatch path owns, so it throws a classified error the fn logs + ack's (lossy hint,
 * FR-ENA-083) — the modified-poll sweep re-surfaces the row on the next tick.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { AppError } from '../../../pmo-portal/src/lib/appError.ts';
import { findPmoRecordId, recordExternalRef } from '../../../pmo-portal/src/lib/adapterSeam/refs.ts';
import { ERPNEXT_TIER } from '../../../pmo-portal/src/lib/adapterSeam/erpnext/adapter.ts';
import { KIND_DOMAIN, KIND_MIRROR_TABLE, type ErpDocKind } from '../../../pmo-portal/src/lib/adapterSeam/erpnext/feedKinds.ts';
import { deriveSiStatus } from '../../../pmo-portal/src/lib/adapterSeam/erpnext/siStatus.ts';
import { reconcileSiCancelAutoUnlink } from '../../../pmo-portal/src/lib/adapterSeam/erpnext/transitionPolicy.ts';
import type { ErpFeedDeps } from '../../../pmo-portal/src/lib/adapterSeam/erpnext/applyFeed.ts';
import type { LineageRow } from '../../../pmo-portal/src/lib/adapterSeam/erpnext/lineage.ts';
import type { PmoRecord } from '../../../pmo-portal/src/lib/adapterSeam/contract.ts';

export { ERPNEXT_TIER };

/** Build the inbound feed apply deps for one (org, kind). `kind` decides the mirror table + domain. */
export function createErpFeedDeps(serviceClient: SupabaseClient, orgId: string, kind: ErpDocKind): ErpFeedDeps {
  const domain = KIND_DOMAIN[kind];
  const table = KIND_MIRROR_TABLE[kind];

  return {
    // ── ApplyChangeDeps ──
    resolvePmoRecordId: (externalRecordId) => findPmoRecordId(serviceClient as never, orgId, domain, externalRecordId),
    readMirrorSourceMod: async (pmoRecordId) => {
      const { data, error } = await serviceClient.from(table).select('erp_modified').eq('org_id', orgId).eq('id', pmoRecordId).maybeSingle();
      if (error) throw new AppError(error.message, error.code);
      const modified = (data as { erp_modified?: string | null } | null)?.erp_modified ?? null;
      return modified ? Date.parse(modified) : null;
    },
    updateMirror: async (pmoRecordId, canonical, sourceModMs) => {
      // Stamp the lifecycle `erp_*` columns the feed owns, PLUS — for the revenue kinds — the DERIVED
      // status and the financial/link columns (Luna BLOCKs 6+8). Before this, an existing row only ever
      // had its `erp_*` fields patched: an SI cancelled in ERP stayed `Unpaid` in PMO (and kept
      // contributing to project revenue + open AR), and a payment adopted before its invoice could never
      // repair its `sales_invoice_id`.
      const patch = {
        ...mirrorStatusPatch(canonical, sourceModMs),
        ...(await revenueFieldPatch(serviceClient, orgId, kind, canonical)),
      };
      const { error } = await (serviceClient.from(table).update(patch).eq('org_id', orgId).eq('id', pmoRecordId) as unknown as Promise<{
        error: { message: string; code?: string } | null;
      }>);
      if (error) throw new AppError(error.message, error.code);
    },
    // Luna BLOCK 7: adopt CLAIM-FIRST. `applyInboundChange` takes the `external_refs` claim for
    // `newPmoRecordId()` BEFORE `mintWithId` runs, so a concurrent webhook/sweep adopt that loses the
    // unique(org_id,domain,external_record_id) race (0093) never inserts a mirror row at all — no orphan
    // duplicate money row. `mirrorExists` closes the inverse window (claimed, then the process died
    // before the mint): the next apply re-mints with the SAME pre-claimed id.
    adoptAtomically: {
      newPmoRecordId: () => crypto.randomUUID(),
      claimExternalRef: (mapping) => recordExternalRef(serviceClient as never, { orgId, ...mapping }),
      mintWithId: (canonical, sourceModMs, pmoRecordId) => mintMirrorRow(serviceClient, orgId, kind, canonical, sourceModMs, pmoRecordId),
      mirrorExists: async (pmoRecordId) => {
        const { data, error } = await serviceClient.from(table).select('id').eq('org_id', orgId).eq('id', pmoRecordId).maybeSingle();
        if (error) throw new AppError(error.message, error.code);
        return data !== null;
      },
    },
    // Retained for the ApplyChangeDeps contract (the engine uses `adoptAtomically` above); delegates to
    // the SAME mint so there is exactly one insert implementation per kind.
    mintMirror: async (canonical, sourceModMs) => {
      const id = crypto.randomUUID();
      await mintMirrorRow(serviceClient, orgId, kind, canonical, sourceModMs, id);
      return id;
    },
    recordExternalRef: (mapping) => recordExternalRef(serviceClient as never, { orgId, ...mapping }),

    // ── LineageDeps ──
    tombstoneMirror: async (pmoRecordId, erpModified) => {
      const { error } = await (serviceClient.from(table).update({
        erp_cancelled_at: new Date().toISOString(),
        erp_docstatus: 2,
        erp_modified: erpModified,
        // Luna BLOCK 8: the DERIVED status must follow the cancel too. Revenue rollups exclude only
        // `status='Cancelled'` (db/revenue.ts) — a cancelled SI left `Unpaid` keeps contributing its
        // amount to project revenue and its outstanding to open AR (a wrong money figure on screen).
        ...cancelStatusPatch(kind),
      }).eq('org_id', orgId).eq('id', pmoRecordId) as unknown as Promise<{ error: { message: string; code?: string } | null }>);
      if (error) throw new AppError(error.message, error.code);
      // Luna BLOCK A4 (feed side): ERPNext auto-unlinks a Receive Payment Entry's `references` when the
      // Sales Invoice it cites cancels (AC-SAR-022) — PMO's `incoming_payments.sales_invoice_id` is
      // otherwise left stale. Reconcile via the EXISTING pure helper (never duplicate its logic); the
      // outbound/dispatch-side wiring is owned by the other agent.
      if (kind === 'sales-invoice') {
        const { data: referencing, error: refErr } = await serviceClient.from('incoming_payments')
          .select('id').eq('org_id', orgId).eq('sales_invoice_id', pmoRecordId);
        if (refErr) throw new AppError(refErr.message, refErr.code);
        for (const row of (referencing as Array<{ id: string }> | null) ?? []) {
          const { peReceivePatch } = reconcileSiCancelAutoUnlink(row.id, erpModified);
          if (!peReceivePatch) continue;
          const { error: unlinkErr } = await (serviceClient.from('incoming_payments').update(peReceivePatch)
            .eq('org_id', orgId).eq('id', row.id) as unknown as Promise<{ error: { message: string; code?: string } | null }>);
          if (unlinkErr) throw new AppError(unlinkErr.message, unlinkErr.code);
        }
      }
    },
    repointExternalRef: async (_domain, pmoRecordId, newExternalRecordId) => {
      // Guarded by `unique(org_id,domain,external_record_id)` (0093) — a concurrent duplicate repoint
      // fails atomically; the loser reconciles on re-run. external_refs is RETAINED on a plain cancel
      // (never repointed there — only an amend repoints).
      const { error } = await (serviceClient.from('external_refs').update({ external_record_id: newExternalRecordId })
        .eq('org_id', orgId).eq('domain', domain).eq('pmo_record_id', pmoRecordId) as unknown as Promise<{
          error: { message: string; code?: string } | null;
        }>);
      if (error) throw new AppError(error.message, error.code);
    },
    stampAmended: async (pmoRecordId, amendedFrom, erpModified) => {
      const { error } = await (serviceClient.from(table).update({
        erp_amended_from: amendedFrom,
        erp_modified: erpModified,
      }).eq('org_id', orgId).eq('id', pmoRecordId) as unknown as Promise<{ error: { message: string; code?: string } | null }>);
      if (error) throw new AppError(error.message, error.code);
    },
    recordLineage: async (row: LineageRow) => {
      const { error } = await serviceClient.from('external_ref_lineage').insert({
        org_id: orgId,
        domain: row.domain,
        pmo_record_id: row.pmoRecordId,
        superseded_external_record_id: row.supersededExternalRecordId,
        successor_external_record_id: row.successorExternalRecordId,
        reason: row.reason,
        erp_docstatus: row.erpDocstatus,
      });
      if (error) throw new AppError(error.message, error.code);
    },

    // ── SupersededNameLookupDeps ──
    findLineageBySupersededName: async (_domain, erpName) => {
      const { data, error } = await serviceClient.from('external_ref_lineage')
        .select('id').eq('org_id', orgId).eq('domain', domain).eq('superseded_external_record_id', erpName).limit(1);
      if (error) throw new AppError(error.message, error.code);
      return Array.isArray(data) && data.length > 0;
    },
  };
}

/** Mint ONE mirror row for an adopted ERP doc, with a CALLER-SUPPLIED PMO id (Luna BLOCK 7: the id is
 *  claimed in `external_refs` before this runs, so a losing racer never reaches here). */
async function mintMirrorRow(
  serviceClient: SupabaseClient,
  orgId: string,
  kind: ErpDocKind,
  canonical: PmoRecord,
  sourceModMs: number,
  id: string,
): Promise<void> {
  const domain = KIND_DOMAIN[kind];
  if (domain === 'companies') {
    // Party adopt (Supplier/Customer created natively in ERP — OQ-4): mint the FULL companies
    // mirror row + the source-mod stamp. Writing only name/type here (the original slice-8 cut)
    // silently dropped the party canonical (erp_supplier_name/tax_id/…) and left erp_modified
    // NULL — so the adopted row was half-empty and the per-row staleness guard never engaged
    // (found live arming the demo feed, 2026-07-14).
    const { error } = await serviceClient.from('companies').insert({
      id,
      org_id: orgId,
      name: canonical.name ?? canonical.erp_supplier_name ?? null,
      type: canonical.type ?? (kind === 'supplier' ? 'Vendor' : 'Client'),
      erp_party_type: (canonical.erp_party_type as string | null | undefined) ?? null,
      erp_supplier_name: (canonical.erp_supplier_name as string | null | undefined) ?? null,
      erp_customer_name: (canonical.erp_customer_name as string | null | undefined) ?? null,
      erp_tax_id: (canonical.erp_tax_id as string | null | undefined) ?? null,
      erp_payment_terms_days: (canonical.erp_payment_terms_days as number | null | undefined) ?? null,
      erp_docstatus: (canonical.erp_docstatus as number | null | undefined) ?? null,
      erp_modified: new Date(sourceModMs).toISOString(),
    });
    if (error) throw new AppError(error.message, error.code);
    return;
  }
  // Revenue domain inbound adopt (sales-invoice / incoming-payment) — mint the FULL canonical
  // row + erp_modified stamp (the 0103 lesson: NOT just name/status). Resolve customer_id from
  // external_refs (companies domain). For incoming-payment, also resolve sales_invoice_id.
  // A project-less inbound SI mints with project_id=null (the 'Unassigned' bucket) AND raises the
  // Finance action-required notification (Luna BLOCK 13, FR-SAR-085 — no new table).
  if (domain === 'revenue') {
    const erpModifiedIso = new Date(sourceModMs).toISOString();
    // Keep an absent docstatus as NULL rather than defaulting to 0: a payload that never stated the
    // lifecycle must not have a "draft" claim invented for it. Defaulting to 0 minted a FALSE mirror
    // (erp_docstatus=0 for an invoice ERP has actually submitted) and, with the revenue allow-list,
    // permanently excluded that invoice's money. NULL is honest — the sweep repairs it on a tick
    // carrying the real docstatus.
    const docstatus = (canonical.erp_docstatus as number | null | undefined) ?? null;
    const erpOutstanding = (canonical as { erp_outstanding_amount?: string | number | null }).erp_outstanding_amount;
    const customerId = await resolveCustomerId(serviceClient, orgId, canonical);
    if (kind === 'sales-invoice') {
      // Project-less SI → project_id = null (Unassigned bucket; Finance notification via existing path)
      const { error } = await serviceClient.from('sales_invoices').insert({
        id,
        org_id: orgId,
        project_id: null,
        customer_id: customerId,
        si_number: canonical.si_number ?? canonical.id,
        reference_number: (canonical as { reference_number?: string | null }).reference_number ?? null,
        invoice_date: (canonical as { invoice_date?: string | null }).invoice_date ?? null,
        amount: (canonical as { amount?: string | number | null }).amount ?? null,
        erp_outstanding_amount: erpOutstanding ?? null,
        status: deriveSiStatus(erpOutstanding == null ? null : String(erpOutstanding), docstatus),
        erp_docstatus: docstatus,
        erp_modified: erpModifiedIso,
        erp_amended_from: (canonical.erp_amended_from as string | null | undefined) ?? null,
        erp_cancelled_at: docstatus === 2 ? new Date().toISOString() : null,
      });
      if (error) throw new AppError(error.message, error.code);
      // Luna BLOCK 13: an inbound SI PMO could not attribute to a project lands in the 'Unassigned'
      // revenue bucket. Without an explicit prompt nobody is ever asked to assign it — so raise the
      // action-required notification on the EXISTING `notifications` surface (0048). Best-effort:
      // the invoice itself is already adopted and must never be lost to a notification failure.
      await notifyFinanceUnassignedInvoice(serviceClient, orgId, {
        salesInvoiceId: id,
        siNumber: String(canonical.si_number ?? canonical.id ?? ''),
        amount: (canonical as { amount?: string | number | null }).amount ?? null,
      });
      return;
    }
    if (kind === 'incoming-payment') {
      const salesInvoiceId = await resolveSalesInvoiceId(serviceClient, orgId, canonical);
      const { error } = await serviceClient.from('incoming_payments').insert({
        id,
        org_id: orgId,
        customer_id: customerId,
        sales_invoice_id: salesInvoiceId, // nullable (on-account receipt)
        ip_number: canonical.ip_number ?? canonical.id,
        reference_number: (canonical as { reference_number?: string | null }).reference_number ?? null,
        date: (canonical as { date?: string | null }).date ?? null,
        amount: (canonical as { amount?: string | number | null }).amount ?? null,
        status: deriveIpStatus(docstatus), // ONE derivation, shared with the update/cancel paths
        erp_docstatus: docstatus,
        erp_modified: erpModifiedIso,
        erp_amended_from: (canonical.erp_amended_from as string | null | undefined) ?? null,
        erp_cancelled_at: docstatus === 2 ? new Date().toISOString() : null,
      });
      if (error) throw new AppError(error.message, error.code);
      return;
    }
  }
  // Procurement inbound adopt requires the PMO procurement-case link the dispatch path owns — the
  // ERP doc does not carry it. Surface a classified error; the fn logs + ack's (lossy hint).
  throw new AppError(
    `procurement inbound adopt of "${canonical.id}" requires a PMO case link — dispatch-owned (the sweep re-surfaces it)`,
    'procurement-inbound-adopt-no-case-link',
  );
}

/** The `erp_*` lifecycle/status columns the inbound feed stamps on a normal upsert (the per-row
 *  source-mod guard already gated the write). Native ERP-derived fields synced by the dispatch
 *  read-model writer on the outbound commit are left untouched here. */
function mirrorStatusPatch(canonical: PmoRecord, sourceModMs: number): Record<string, unknown> {
  const docstatus = (canonical.erp_docstatus as number | null | undefined) ?? null;
  // erp_modified always advances. The lifecycle columns follow putIfPresent discipline: a partial
  // webhook that omits docstatus must not clear a real erp_docstatus, nor wipe a genuine
  // erp_cancelled_at stamp back to null. Only a payload that actually carries docstatus writes them,
  // and only docstatus===2 stamps the cancellation time.
  const patch: Record<string, unknown> = { erp_modified: new Date(sourceModMs).toISOString() };
  putIfPresent(patch, 'erp_amended_from', (canonical.erp_amended_from as string | null | undefined));
  if (docstatus != null) {
    patch.erp_docstatus = docstatus;
    // Round-5 finding 6: docstatus 2 is TERMINAL in ERPNext (a cancelled doc is never un-cancelled —
    // it is amended into a NEW document instead). So a change that authoritatively states a non-2
    // docstatus describes a live document, and any `erp_cancelled_at` on that row belongs to a
    // superseded predecessor: on a native amend the successor is repointed onto the SAME mirror row
    // the predecessor's cancel had already tombstoned. Clear it so the row's lifecycle matches the
    // document it now mirrors. Absent docstatus ⇒ untouched (the putIfPresent discipline).
    patch.erp_cancelled_at = docstatus === 2 ? new Date().toISOString() : null;
  }
  return patch;
}

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

/** The derived-status columns a CANCEL (docstatus 2) must also write, per kind (Luna BLOCK 8). Revenue
 *  rollups key on `status <> 'Cancelled'` (db/revenue.ts) — stamping only `erp_*` left a cancelled
 *  invoice counted in project revenue and open AR. Non-revenue kinds keep their existing behavior. */
function cancelStatusPatch(kind: ErpDocKind): Record<string, unknown> {
  if (kind === 'sales-invoice') return { status: deriveSiStatus(null, 2) };
  if (kind === 'incoming-payment') return { status: deriveIpStatus(2) };
  return {};
}

/** Add `key: value` only when the inbound change actually carries the value — an absent field must
 *  never be written as NULL over live data (the update is a repair, not a wholesale overwrite). */
function putIfPresent(patch: Record<string, unknown>, key: string, value: unknown): void {
  if (value !== undefined && value !== null) patch[key] = value;
}

/**
 * The DERIVED-status + financial/link columns an inbound revenue change must repair on an EXISTING row
 * (Luna BLOCKs 6+8). Before this, `updateMirror` patched only `erp_*`, so: (a) a cancel/settle in ERP
 * never moved the PMO `status`, and (b) a row adopted with NULL money (or a payment adopted before its
 * invoice) could never be repaired — the sweep saw the row as "already mapped" forever.
 * Only fields the change CARRIES are written; PMO-owned columns (project_id) are never touched.
 */
async function revenueFieldPatch(
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
  // The late-link repair: a Receive PE adopted BEFORE the Sales Invoice it cites kept
  // sales_invoice_id = NULL forever. An unresolvable reference leaves the column UNTOUCHED — a
  // repair pass must never un-link a payment that is already correctly linked.
  putIfPresent(patch, 'sales_invoice_id', await resolveSalesInvoiceId(serviceClient, orgId, canonical));
  // The IP twin of the SI status guard above: `status` carries an oracle only when the payload states
  // the lifecycle. A partial webhook that omits `docstatus` must NOT flip a Paid payment back to
  // Scheduled (deriveIpStatus(null) === 'Scheduled'). A cancel (docstatus 2) always writes.
  if (docstatus != null) patch.status = deriveIpStatus(docstatus);
  return patch;
}

/** Resolve the PMO `customer_id` from the canonical's ERP customer name via `external_refs`
 *  (`Customer:<name>` in the companies domain). `null` when unmapped/absent. */
async function resolveCustomerId(serviceClient: SupabaseClient, orgId: string, canonical: PmoRecord): Promise<string | null> {
  const customerErpName = (canonical as { customer?: string | null }).customer;
  if (!customerErpName) return null;
  const { data } = await serviceClient.from('external_refs').select('pmo_record_id')
    .eq('org_id', orgId).eq('domain', 'companies').eq('external_record_id', `Customer:${customerErpName}`).maybeSingle();
  return (data as { pmo_record_id?: string } | null)?.pmo_record_id ?? null;
}

/** Resolve the PMO `sales_invoice_id` a Receive PE's first `references` row cites. `null` when the
 *  cited invoice is not (yet) mapped — the caller must then leave the column alone. */
async function resolveSalesInvoiceId(serviceClient: SupabaseClient, orgId: string, canonical: PmoRecord): Promise<string | null> {
  const references = (canonical as { references?: Array<{ reference_name?: string | null }> }).references;
  const siErpName = Array.isArray(references) ? references[0]?.reference_name : null;
  if (!siErpName) return null;
  const { data } = await serviceClient.from('external_refs').select('pmo_record_id')
    .eq('org_id', orgId).eq('domain', 'revenue').eq('external_record_id', siErpName).maybeSingle();
  return (data as { pmo_record_id?: string } | null)?.pmo_record_id ?? null;
}

/**
 * Luna BLOCK 13 — the action-required surfacing for a project-less inbound Sales Invoice (FR-SAR-085).
 * Writes to the EXISTING `notifications` surface (0048: the in-app inbox + unread badge) for the org's
 * active Finance/Admin profiles, so the 'Unassigned' revenue bucket actually prompts somebody instead
 * of silently accumulating native invoices.
 *
 * Best-effort by design: the invoice is ALREADY adopted when this runs, and re-running the adopt is not
 * possible (the ref is claimed) — so a notification failure is logged, never propagated, rather than
 * losing the money row itself.
 */
async function notifyFinanceUnassignedInvoice(
  serviceClient: SupabaseClient,
  orgId: string,
  invoice: { salesInvoiceId: string; siNumber: string; amount: string | number | null },
): Promise<void> {
  try {
    const { data, error } = await serviceClient.from('profiles').select('id')
      .eq('org_id', orgId).eq('status', 'active').in('role', ['Finance', 'Admin']);
    if (error) throw new AppError(error.message, error.code);
    const recipients = (data as Array<{ id: string }> | null) ?? [];
    if (recipients.length === 0) {
      console.error(`[erpnextFeedDeps] no active Finance/Admin recipient in org ${orgId} — unassigned invoice ${invoice.siNumber} is unsurfaced`);
      return;
    }
    const { error: insertError } = await serviceClient.from('notifications').insert(
      recipients.map((r) => ({
        org_id: orgId,
        owner_id: r.id,
        severity: 'warning',
        title: 'Invoice needs a project',
        body: `Sales Invoice ${invoice.siNumber}${invoice.amount != null ? ` (${invoice.amount})` : ''} arrived from ERPNext without a project and is in the Unassigned bucket. Assign it to a project.`,
        metadata: { sales_invoice_id: invoice.salesInvoiceId, si_number: invoice.siNumber, action_required: 'assign-project' },
      })),
    );
    if (insertError) throw new AppError(insertError.message, insertError.code);
  } catch (err) {
    console.error(`[erpnextFeedDeps] Finance notification for unassigned invoice ${invoice.siNumber} (org ${orgId}) failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}
