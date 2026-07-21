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
import { AdapterError } from '../../../pmo-portal/src/lib/adapterSeam/contract.ts';
import { findPmoRecordId, recordExternalRef } from '../../../pmo-portal/src/lib/adapterSeam/refs.ts';
import { ERPNEXT_TIER } from '../../../pmo-portal/src/lib/adapterSeam/erpnext/adapter.ts';
import { KIND_DOMAIN, KIND_MIRROR_TABLE, type ErpDocKind } from '../../../pmo-portal/src/lib/adapterSeam/erpnext/feedKinds.ts';
import { deriveSiStatus } from '../../../pmo-portal/src/lib/adapterSeam/erpnext/siStatus.ts';
import { escapeLikePattern } from '../../../pmo-portal/src/lib/adapterSeam/erpnext/client.ts';
import { reconcileSiCancelAutoUnlink } from '../../../pmo-portal/src/lib/adapterSeam/erpnext/transitionPolicy.ts';
import type { ErpFeedDeps } from '../../../pmo-portal/src/lib/adapterSeam/erpnext/applyFeed.ts';
import type { LineageRow } from '../../../pmo-portal/src/lib/adapterSeam/erpnext/lineage.ts';
import type { PmoRecord } from '../../../pmo-portal/src/lib/adapterSeam/contract.ts';

export { ERPNEXT_TIER };

/**
 * The mirror table's own lookup column keyed to `pmoRecordId`.
 *
 * Every P0/P1/P2/P3a mirror is minted with `table.id === pmoRecordId` (`mintMirrorRow`/`mintWithId`
 * pass the PMO id in as the row's OWN primary key), so `.eq('id', pmoRecordId)` is correct for them.
 *
 * ⚑ Both Posture-B SIDE mirrors (ADR-0059 §6) are the exception, and for the SAME reason: they are
 * keyed by their OWN generated `id` (`default gen_random_uuid()`) with the PMO record living in a
 * SEPARATE FK column, because the outbound push writer (`readModelWriters.ts`) upserts on that FK
 * column's own unique constraint, never sets `id` explicitly, and (for `budget`) the grain genuinely
 * isn't 1:1 with a single PMO id at all (`(budget_version_id × fiscal_year)` — forward-compat for
 * OQ-BUD-3(c), more than one row CAN exist per version):
 *   • `timesheet` → `timesheet_erp_mirror.timesheet_id` (migration 0136; unique 1:1 with `timesheets.id`,
 *     upserted `onConflict:'timesheet_id'` — `readModelWriters.ts`'s `timesheetsWriter`).
 *   • `budget` → `budget_version_erp_mirror.budget_version_id` (migration 0137; NOT unique alone —
 *     `unique(org_id, budget_version_id, fiscal_year)` — upserted on that composite).
 * Querying `.eq('id', pmoRecordId)` for either would match NO row — a Postgres 0-row match is not an
 * error, so `updateMirror`/`tombstoneMirror`/`readMirrorSourceMod`/`mirrorExists` would all silently
 * no-op: a Desk-cancelled Timesheet/Budget would never reach `failed`/`held` (the mirror stays
 * `pushed` forever, and `readMirrorSourceMod` always returns `null`, disabling the staleness guard
 * too). This is exactly the class of bug the FR-BUD-102 "never trusts itself" invariant exists to
 * catch downstream — but it must be caught HERE, at the query, not papered over by the caller.
 */
function pmoRecordLookupColumn(kind: ErpDocKind): string {
  if (kind === 'timesheet') return 'timesheet_id';
  if (kind === 'budget') return 'budget_version_id';
  return 'id';
}

/** Build the inbound feed apply deps for one (org, kind). `kind` decides the mirror table + domain. */
export function createErpFeedDeps(serviceClient: SupabaseClient, orgId: string, kind: ErpDocKind): ErpFeedDeps {
  const domain = KIND_DOMAIN[kind];
  const table = KIND_MIRROR_TABLE[kind];
  const lookupColumn = pmoRecordLookupColumn(kind);

  return {
    // ── ApplyChangeDeps ──
    resolvePmoRecordId: (externalRecordId) => findPmoRecordId(serviceClient as never, orgId, domain, externalRecordId),
    readMirrorSourceMod: async (pmoRecordId) => {
      const { data, error } = await serviceClient.from(table).select('erp_modified').eq('org_id', orgId).eq(lookupColumn, pmoRecordId).maybeSingle();
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
        ...(await employeeFieldPatch(serviceClient, orgId, kind, pmoRecordId, canonical)),
      };
      const { error } = await (serviceClient.from(table).update(patch).eq('org_id', orgId).eq(lookupColumn, pmoRecordId) as unknown as Promise<{
        error: { message: string; code?: string } | null;
      }>);
      if (error) throw new AppError(error.message, error.code);
    },
    // Luna BLOCK 7: adopt CLAIM-FIRST. `applyInboundChange` takes the `external_refs` claim for
    // `newPmoRecordId()` BEFORE `mintWithId` runs, so a concurrent webhook/sweep adopt that loses the
    // unique(org_id,domain,external_record_id) race (0093) never inserts a mirror row at all — no orphan
    // duplicate money row. `mirrorExists` closes the inverse window (claimed, then the process died
    // before the mint): the next apply re-mints with the SAME pre-claimed id.
    //
    // P3b FR-TSP-082/task 6.2 — `timesheet` gets NO atomic-adopt strategy at all. The claim-first order
    // is exactly wrong for a kind that must NEVER adopt: `claimExternalRef` would run and insert a
    // permanent `external_refs` row for a native ERP Timesheet BEFORE `mintWithId` (mintMirrorRow) ever
    // gets a chance to throw — orphaning a claimed PMO id nothing is ever minted for, and (worse)
    // making every LATER event for that same ERP name look "already mapped" to `resolvePmoRecordId`,
    // permanently wedging it. Omitting `adoptAtomically` here falls the engine back to the LEGACY
    // mint-then-ref path (`mintMirror` below), where the throw fires BEFORE any external_refs write —
    // truly no side effect, matching FR-TSP-082's intent. `employee` KEEPS the claim-first strategy: it
    // legitimately adopts, so the race-safety property is wanted there.
    //
    // P3c FR-BUD-140 — `budget` gets the IDENTICAL exclusion, for the identical reason: PMO is the SoT
    // for the budget figure (OD-BUDGET-1), so a Desk-created ERP Budget must NEVER be adopted. See
    // `mintMirrorRow`'s `domain === 'budget'` branch below for the throw.
    ...(kind === 'timesheet' || kind === 'budget' ? {} : {
      adoptAtomically: {
        newPmoRecordId: () => crypto.randomUUID(),
        claimExternalRef: (mapping) => recordExternalRef(serviceClient as never, { orgId, ...mapping }),
        mintWithId: (canonical, sourceModMs, pmoRecordId) => mintMirrorRow(serviceClient, orgId, kind, canonical, sourceModMs, pmoRecordId),
        mirrorExists: async (pmoRecordId) => {
          const { data, error } = await serviceClient.from(table).select(lookupColumn).eq('org_id', orgId).eq(lookupColumn, pmoRecordId).maybeSingle();
          if (error) throw new AppError(error.message, error.code);
          return data !== null;
        },
      },
    }),
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
      }).eq('org_id', orgId).eq(lookupColumn, pmoRecordId) as unknown as Promise<{ error: { message: string; code?: string } | null }>);
      if (error) throw new AppError(error.message, error.code);
      // P3b FR-TSP-084 — the desk-cancel action-required surface (task 6.3). The push_state='failed'
      // reopen above is silent by itself; an operator needs a prompt that a human cancelled the ERP
      // Timesheet a PMO sheet was already pushed to.
      if (kind === 'timesheet') {
        await surfaceActionRequired(serviceClient, orgId, 'timesheet-desk-cancelled', { pmoRecordId });
      }
      // P3c FR-BUD-142 (never fight the operator) — the SAME desk-cancel action-required surface, for
      // the SAME reason: the push_state='failed' reopen above (cancelStatusPatch) is silent by itself,
      // and PMO's version stays exactly as it is (this writer never touches budget_versions).
      if (kind === 'budget') {
        await surfaceActionRequired(serviceClient, orgId, 'budget-desk-cancelled', { pmoRecordId });
      }
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
  // P3b — the Timesheets domain (ADR-0059 Posture B). Two SIBLING kinds, opposite adopt rules:
  //   • `employee` — a MASTER (ADR-0059 §5's exception): adopts exactly like Supplier/Customer above —
  //     the SAME shipped party-adopt path, no new adopt function, no new engine.
  //   • `timesheet` — a PROCESS document (FR-TSP-082): the DELIBERATE INVERSE of P3a's Sales Invoice
  //     adopt. PMO is SoT for entry AND approval here, so minting a PMO row from a natively-created ERP
  //     Timesheet would import HOURS THAT NEVER PASSED PMO APPROVAL — exactly what the owner's ruling
  //     forbids. So: mint NOTHING (no `timesheets` row, no `timesheet_entries`, no
  //     `timesheet_erp_mirror` row — this function returns before any insert), surface
  //     action-required, and throw a classified error so the caller (webhook/sweep) neither silently
  //     drops nor treats this as a landed adopt. (This also removes the Luna BLOCK-7 "inbound adoption
  //     loses links" class by deleting the adopt path entirely for this kind.)
  if (domain === 'timesheets') {
    if (kind === 'employee') {
      // Mint the FULL canonical + the erp_modified stamp — never a half-empty name-only row (the exact
      // party-adopt bug found live 2026-07-14: a half-empty adopted row never engages the per-row
      // staleness guard because erp_modified was NULL). link_state is NEVER auto-confirmed (FR-TSP-092)
      // — only a Human `confirm_erp_employee_link` (0140) authorizes a push.
      const { error } = await serviceClient.from('erp_employees').insert({
        id,
        org_id: orgId,
        employee_number: (canonical.employee_number as string | null | undefined) ?? canonical.id,
        employee_name: (canonical.employee_name as string | null | undefined) ?? null,
        work_email: (canonical.work_email as string | null | undefined) ?? null,
        erp_user_id: (canonical.erp_user_id as string | null | undefined) ?? null,
        erp_status: (canonical.erp_status as string | null | undefined) ?? null,
        link_state: 'unlinked',
        erp_docstatus: (canonical.erp_docstatus as number | null | undefined) ?? null,
        erp_modified: new Date(sourceModMs).toISOString(),
      });
      if (error) throw new AppError(error.message, error.code);
      // OQ-TSP-10(C): PROPOSE only, on a unique exact case-insensitive work-email match. Zero/multiple
      // hits stay 'unlinked' + surface action-required (the party-adopt ambiguous-match precedent:
      // SURFACE, never auto-resolve). A proposal does NOT authorize a push — only a confirm does.
      await proposeEmployeeLink(serviceClient, orgId, id, (canonical.work_email as string | null | undefined) ?? null);
      return;
    }
    if (kind === 'timesheet') {
      await surfaceActionRequired(serviceClient, orgId, 'timesheet-native-not-adopted', {
        erpName: String(canonical.id ?? ''),
      });
      throw new AdapterError('commit-rejected', 'native-timesheet-not-adopted');
    }
  }
  // P3c FR-BUD-140 (⚑ never adopt — ADR-0059 §5) — a `Budget` doc with no `external_refs` mapping was
  // created directly in the Desk. PMO is the SoT for the budget figure (OD-BUDGET-1): adopting it would
  // mint a version that never passed PMO's activation authority — the DELIBERATE INVERSE of P3a's
  // revenue adopt rule (FR-SAR-085), not a variant of it. Mint NOTHING (no `budget_versions` row, no
  // `budget_line_items` row, no `budget_version_erp_mirror` row — this function returns before any
  // insert), surface action-required, and throw a classified error so the caller (webhook/sweep)
  // neither silently drops the event nor treats it as a landed adopt.
  if (domain === 'budget') {
    await surfaceActionRequired(serviceClient, orgId, 'budget-native-not-adopted', {
      erpName: String(canonical.id ?? ''),
    });
    throw new AdapterError('commit-rejected', 'native-budget-not-adopted');
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
  // P3b FR-TSP-084 — desk cancel REOPENS the push state to 'failed' + action-required (surfaced by the
  // caller, `tombstoneMirror`, right after this patch lands). Do NOT re-push here: the sweep backstop
  // would instantly re-create what a human just cancelled — an infinite fight between the backstop and
  // the accountant. `erp_cancelled_at` (set by the caller alongside this patch) is ALSO the sweep's
  // candidate-query exclusion (task 6.4). The PMO `timesheets` row itself is UNTOUCHED here — still
  // Approved; PMO's approval is not ERP's to revoke (FR-TSP-004(ii)). Resolution is the OQ-TSP-6
  // correction path (OPEN).
  if (kind === 'timesheet') return { push_state: 'failed' };
  // P3c FR-BUD-142 (⚑ never fight the operator) — the SAME reopen, for the SAME reason: a re-push here
  // would instantly re-create the ERP object a human just cancelled. `budget_versions` is UNTOUCHED —
  // PMO's version stays Active; PMO's budget is not ERP's to revoke. `erp_cancelled_at` (set by the
  // caller alongside this patch) is ALSO `reconcileOrgBudgetPushes`'s candidate-query exclusion.
  if (kind === 'budget') return { push_state: 'failed' };
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
 * P3b — the Employee mirror columns an inbound update repairs (FR-TSP-090/092.4). Only `employee`-kind
 * changes touch this; every other kind is untouched (`{}`).
 *
 * ⚑ FR-TSP-092.4 (the confirmed-link guard): `profile_id`/`link_state`/`linked_by`/`linked_at` are
 * NEVER part of this patch — those columns are written EXCLUSIVELY by `confirm_erp_employee_link`
 * (migration 0140). This function only mirrors the Employee master's OWN fields. When the row's
 * CURRENT `link_state` is `'confirmed'` and the incoming `work_email` differs from what is stored, an
 * ERP-side email edit on a confirmed link surfaces `employee-link-email-changed` — the confirmed link
 * itself STANDS (never re-pointed here); the mirrored `work_email` column still updates for display
 * accuracy (ERP-side email is Desk-editable and the mirror should reflect current reality — only the
 * PMO-user LINK is the security-sensitive part, and this function structurally cannot touch it).
 */
async function employeeFieldPatch(
  serviceClient: SupabaseClient,
  orgId: string,
  kind: ErpDocKind,
  pmoRecordId: string,
  canonical: PmoRecord,
): Promise<Record<string, unknown>> {
  if (kind !== 'employee') return {};
  const patch: Record<string, unknown> = {};
  putIfPresent(patch, 'employee_name', (canonical as { employee_name?: unknown }).employee_name);
  putIfPresent(patch, 'erp_user_id', (canonical as { erp_user_id?: unknown }).erp_user_id);
  putIfPresent(patch, 'erp_status', (canonical as { erp_status?: unknown }).erp_status);

  const newWorkEmail = (canonical as { work_email?: string | null | undefined }).work_email;
  if (newWorkEmail !== undefined) {
    const { data, error } = await serviceClient.from('erp_employees').select('work_email, link_state')
      .eq('org_id', orgId).eq('id', pmoRecordId).maybeSingle();
    if (error) throw new AppError(error.message, error.code);
    const row = data as { work_email?: string | null; link_state?: string } | null;
    if (row && row.link_state === 'confirmed' && (row.work_email ?? null) !== (newWorkEmail ?? null)) {
      await surfaceActionRequired(serviceClient, orgId, 'employee-link-email-changed', { erpEmployeeId: pmoRecordId });
    }
    patch.work_email = newWorkEmail;
  }
  return patch;
}

/**
 * OQ-TSP-10(C) FR-TSP-092: PROPOSE, never confirm. On adopt, an Employee's `work_email` is probed
 * against `profiles.email` for a UNIQUE, exact, case-insensitive match. Zero or multiple hits leave the
 * row `link_state='unlinked'` + surface action-required (the party-adopt ambiguous-match precedent:
 * SURFACE, never auto-resolve) — only a Human `confirm_erp_employee_link` (0140) authorizes a push.
 * The update is scoped to `link_state='unlinked'` so it never re-proposes over an already-
 * proposed/confirmed/rejected row (FR-TSP-092.4 stays intact even on a re-apply).
 */
async function proposeEmployeeLink(
  serviceClient: SupabaseClient,
  orgId: string,
  erpEmployeeId: string,
  workEmail: string | null,
): Promise<void> {
  if (!workEmail) {
    await surfaceActionRequired(serviceClient, orgId, 'employee-link-no-email', { erpEmployeeId });
    return;
  }
  // ⚑ `work_email` is DESK-EDITABLE — it is the exact untrusted input 0140's human-confirm step exists
  // to contain, so it must never reach a pattern operator unescaped. `.ilike()` treats `%`/`_` as
  // wildcards: a Desk user setting `work_email` to `finance.lead%` yields a UNIQUE match against
  // `finance.lead@corp.com` and gets auto-proposed with `link_proposed_reason:
  // 'work-email-exact-match'` — a claim that is simply FALSE, shown to the Admin who then confirms it,
  // after which that user's hours post against the attacker's Employee costing rate. Escaped, `.ilike`
  // with no live wildcards IS the case-insensitive exact match this intends. Same helper, same reason,
  // as the P3a anchor-search fix (`client.ts:escapeLikePattern`).
  const { data, error } = await serviceClient.from('profiles').select('id')
    .eq('org_id', orgId).ilike('email', escapeLikePattern(workEmail));
  if (error) throw new AppError(error.message, error.code);
  const rows = (data as Array<{ id: string }> | null) ?? [];
  if (rows.length !== 1) {
    await surfaceActionRequired(
      serviceClient,
      orgId,
      rows.length === 0 ? 'employee-link-no-match' : 'employee-link-ambiguous',
      { erpEmployeeId, workEmail },
    );
    return; // stays link_state='unlinked', profile_id=null — NEVER auto-resolve
  }
  const { error: updateError } = await serviceClient.from('erp_employees')
    .update({ link_state: 'proposed', profile_id: rows[0].id, link_proposed_reason: 'work-email-exact-match' })
    .eq('org_id', orgId).eq('id', erpEmployeeId).eq('link_state', 'unlinked');
  if (updateError) throw new AppError(updateError.message, updateError.code);
}

/**
 * P3b — the generic action-required surface (task 6.2/3.6). Writes to the EXISTING `notifications`
 * surface (0048), matching `notifyFinanceUnassignedInvoice`'s established pattern, generalized across
 * every P3b action-required reason (never-adopted Timesheet, desk-cancel, unresolved/ambiguous Employee
 * link, a confirmed link's email changing). Best-effort: a notification failure is logged, never
 * propagated — the caller's own write (the mint/update/tombstone) must never be lost to it.
 *
 * Exported (P3c slice 5): `erpnext-sweep/index.ts`'s `reconcileOrgBudgetPushesLive` surfaces its own
 * `'budget-push-no-outbox-candidate'` reason through this SAME surface, rather than a second one.
 */
export async function surfaceActionRequired(
  serviceClient: SupabaseClient,
  orgId: string,
  actionRequired: string,
  detail: Record<string, unknown>,
): Promise<void> {
  try {
    const { data, error } = await serviceClient.from('profiles').select('id')
      .eq('org_id', orgId).eq('status', 'active').in('role', ['Admin', 'Finance']);
    if (error) throw new AppError(error.message, error.code);
    const recipients = (data as Array<{ id: string }> | null) ?? [];
    if (recipients.length === 0) {
      console.error(`[erpnextFeedDeps] no active Admin/Finance recipient in org ${orgId} — ${actionRequired} is unsurfaced`);
      return;
    }
    const { error: insertError } = await serviceClient.from('notifications').insert(
      recipients.map((r) => ({
        org_id: orgId,
        owner_id: r.id,
        severity: 'warning',
        title: 'Action required',
        body: describeActionRequired(actionRequired, detail),
        metadata: { action_required: actionRequired, ...detail },
      })),
    );
    if (insertError) throw new AppError(insertError.message, insertError.code);
  } catch (err) {
    console.error(`[erpnextFeedDeps] surfaceActionRequired(${actionRequired}) for org ${orgId} failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/** Human-readable body text per action-required reason — kept out of the caller sites so a new reason
 *  is a one-line addition here, never a copy-pasted notification insert. */
function describeActionRequired(actionRequired: string, detail: Record<string, unknown>): string {
  switch (actionRequired) {
    case 'employee-link-no-email':
      return `Adopted Employee ${detail.erpEmployeeId ?? ''} has no work email on record — link it to a PMO user manually.`;
    case 'employee-link-no-match':
      return `No PMO user matches work email ${detail.workEmail ?? ''} for the adopted Employee ${detail.erpEmployeeId ?? ''} — link it manually.`;
    case 'employee-link-ambiguous':
      return `Multiple PMO users match work email ${detail.workEmail ?? ''} for the adopted Employee ${detail.erpEmployeeId ?? ''} — confirm the correct link manually.`;
    case 'employee-link-email-changed':
      return `The linked Employee's work email changed in ERPNext — the CONFIRMED link was NOT re-pointed (a security property, not a bug).`;
    case 'timesheet-native-not-adopted':
      return `A Timesheet created directly in ERPNext (${detail.erpName ?? ''}) was NOT imported — PMO is the source of truth for hours; enter it in PMO instead.`;
    case 'timesheet-desk-cancelled':
      return `A Timesheet was cancelled directly in ERPNext after PMO pushed it — the push is marked failed for review.`;
    case 'budget-native-not-adopted':
      return `A Budget created directly in ERPNext (${detail.erpName ?? ''}) was NOT imported — PMO is the source of truth for the budget figure; author it in PMO instead.`;
    case 'budget-desk-cancelled':
      return `A Budget was cancelled directly in ERPNext after PMO pushed it — the push is marked failed for review. PMO's budget version is unchanged.`;
    case 'budget-push-no-outbox-candidate':
      return `An activated budget's automatic push to ERPNext never reached the queue — retry from the budget's version history, or contact support.`;
    case 'budget-push-failed':
      return `PMO could not push the activated budget to ERPNext (${detail.reason ?? 'unknown error'}) — ERPNext is still enforcing the previous budget (or none) for this project.`;
    default:
      return `Action required: ${actionRequired}`;
  }
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
