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
import { findPmoRecordId, insertExternalRef, recordExternalRef } from '../../../pmo-portal/src/lib/adapterSeam/refs.ts';
import { ERPNEXT_TIER } from '../../../pmo-portal/src/lib/adapterSeam/erpnext/adapter.ts';
import { KIND_DOMAIN, type ErpDocKind } from '../../../pmo-portal/src/lib/adapterSeam/erpnext/feedKinds.ts';
import { reconcileSiCancelAutoUnlink } from '../../../pmo-portal/src/lib/adapterSeam/erpnext/transitionPolicy.ts';
import type { ErpFeedDeps } from '../../../pmo-portal/src/lib/adapterSeam/erpnext/applyFeed.ts';
import type { LineageRow } from '../../../pmo-portal/src/lib/adapterSeam/erpnext/lineage.ts';
import type { PmoRecord } from '../../../pmo-portal/src/lib/adapterSeam/contract.ts';
import { pickCandidate, reviewReasonOf, type PartyDoctype } from '../../../pmo-portal/src/lib/adapterSeam/erpnext/partyAdopt.ts';
import { findCompanyCandidates } from './companyCandidates.ts';
import { recordPartyReview } from './recordPartyReview.ts';
import { resolveInvoiceProject } from './projectInvoiceAttribution.ts';
import { pmoRecordLookupColumn, mirrorTable, scopeMirrorQuery } from './erpFeedMirrorScope.ts';
import { surfaceActionRequired, surfaceExpenseDeskCancelUnlessOurs } from './erpFeedNotifications.ts';
import { purchaseInvoiceFieldPatch, revenueFieldPatch } from './erpFeedRevenue.ts';
import { employeeFieldPatch } from './erpFeedEmployee.ts';
import { mintMirrorRow, mirrorStatusPatch, cancelStatusPatch } from './erpFeedMirrorWrites.ts';

export { ERPNEXT_TIER, surfaceActionRequired };
export { deriveIpStatus } from './erpFeedRevenue.ts';

/** Build the inbound feed apply deps for one (org, kind). `kind` decides the mirror table + domain. */
export function createErpFeedDeps(serviceClient: SupabaseClient, orgId: string, kind: ErpDocKind): ErpFeedDeps {
  const domain = KIND_DOMAIN[kind];
  const lookupColumn = pmoRecordLookupColumn(kind);
  const tableFor = (pmoRecordId: string) => mirrorTable(kind, pmoRecordId);

  return {
    // ── ApplyChangeDeps ──
    resolvePmoRecordId: (externalRecordId) => findPmoRecordId(serviceClient as never, orgId, domain, externalRecordId),
    readMirrorSourceMod: async (pmoRecordId) => {
      const { data, error } = await scopeMirrorQuery(serviceClient.from(tableFor(pmoRecordId)).select('erp_modified'), kind, lookupColumn, orgId, pmoRecordId).maybeSingle();
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
        ...mirrorStatusPatch(kind, canonical, sourceModMs),
        ...(await revenueFieldPatch(serviceClient, orgId, kind, canonical)),
        ...purchaseInvoiceFieldPatch(kind, canonical),
        ...(await employeeFieldPatch(serviceClient, orgId, kind, pmoRecordId, canonical)),
      };
      const { error } = await (scopeMirrorQuery(serviceClient.from(tableFor(pmoRecordId)).update(patch), kind, lookupColumn, orgId, pmoRecordId) as unknown as Promise<{
        error: { message: string; code?: string } | null;
      }>);
      if (error) throw new AppError(error.message, error.code);
      if (kind === 'sales-invoice' && typeof canonical.erp_project === 'string') {
        const projectId = await resolveInvoiceProject(serviceClient, orgId, canonical.erp_project);
        if (projectId) {
          const { error: fillError } = await serviceClient.rpc('fill_sales_invoice_project', {
            p_org_id: orgId, p_si_id: pmoRecordId, p_project_id: projectId, p_erp_project: canonical.erp_project,
          });
          if (fillError) throw new AppError(fillError.message, fillError.code);
        }
      }
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
    // #775 phase B — the expense kinds take the IDENTICAL exclusion (never adopt, FR-EXP-113).
    // 0378 — and so do the procurement kinds: their mint always refuses (the PMO purchase link is dispatch-owned, see
    // `mintMirrorRow`'s last throw), so a claim-first adopt left a procurement reference to a PMO id nothing was ever
    // minted for, and that dangling reference made a native ERP bill or payment look recorded by PMO.
    ...(kind === 'timesheet' || kind === 'budget' || KIND_DOMAIN[kind] === 'expenses' || KIND_DOMAIN[kind] === 'procurement' ? {} : {
      adoptAtomically: {
        newPmoRecordId: () => crypto.randomUUID(),
        // Insert-only: the claim is a first link, so it must refuse (23505) rather than re-point a record
        // that is already linked to another ERP record (#1600).
        claimExternalRef: (mapping) => insertExternalRef(serviceClient as never, { orgId, ...mapping }),
        // #1600 — an unmapped ERP Supplier/Customer that is already a PMO company links to it; only a
        // no-match mints. Same matcher as the setup step (partyAdopt.pickCandidate); unclear ⇒ throws.
        ...(kind === 'supplier' || kind === 'customer' ? {
          matchExisting: async (canonical: PmoRecord, externalRecordId: string) => {
            const doctype: PartyDoctype = kind === 'supplier' ? 'Supplier' : 'Customer';
            const name = (canonical.name ?? canonical.erp_supplier_name ?? canonical.erp_customer_name) as string | null | undefined;
            if (!name) return null;
            const taxId = (canonical.erp_tax_id as string | null | undefined) ?? null;
            const candidates = await findCompanyCandidates(serviceClient, orgId, doctype, name, taxId);
            try {
              return pickCandidate({ doctype, id: name, name, taxId }, candidates)?.pmoRecordId ?? null;
            } catch (err) {
              if (!(err instanceof AppError) || err.code !== 'action-required') throw err;
              // Unclear match: tell an admin and skip THIS party (a terminal reason, feedErrorPolicy.ts) so
              // one unclear party never halts the poll behind it.
              await surfaceActionRequired(serviceClient, orgId, 'party-match-unclear', { erpName: name });
              // the review row names the ERP party by its document id (never its display name), beside the notification
              await recordPartyReview(serviceClient, orgId, { pmoIds: candidates.map((c) => c.pmoRecordId).sort(), externalId: externalRecordId, reason: reviewReasonOf(err) });
              throw new AppError(err.message, 'party-match-unclear');
            }
          },
        } : {}),
        mintWithId: (canonical, sourceModMs, pmoRecordId) => mintMirrorRow(serviceClient, orgId, kind, canonical, sourceModMs, pmoRecordId),
        mirrorExists: async (pmoRecordId) => {
          const { data, error } = await scopeMirrorQuery(serviceClient.from(tableFor(pmoRecordId)).select(lookupColumn), kind, lookupColumn, orgId, pmoRecordId).maybeSingle();
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
      if (kind === 'budget' && mirrorTable(kind, pmoRecordId) === 'budget_version_account_erp_mirror') {
        const { data, error } = await scopeMirrorQuery(
          serviceClient.from(tableFor(pmoRecordId)).select('budget_intent,push_state,erp_docstatus'),
          kind, lookupColumn, orgId, pmoRecordId,
        ).maybeSingle();
        if (error) throw new AppError(error.message, error.code);
        const current = data as { budget_intent?: string; push_state?: string; erp_docstatus?: number | null } | null;
        if (current?.budget_intent === 'remove' && current.push_state === 'pushed' && current.erp_docstatus === 2) return;
      }
      // #1462 — the LEGACY twin. An archive cancellation of an older year-grained document is OUR write,
      // recorded by the archive finalizer as tombstone + docstatus 2 with the row still `pushed`. Without
      // this branch the feed would treat PMO's own cancellation as a human Desk cancel and raise a false
      // "someone cancelled this budget" alarm on every archive. A genuine Desk cancel reaches here with
      // `erp_cancelled_at` still NULL (or after this same path set `failed`), so it stays surfaced.
      if (kind === 'budget' && mirrorTable(kind, pmoRecordId) === 'budget_version_erp_mirror') {
        const { data, error } = await scopeMirrorQuery(
          serviceClient.from(tableFor(pmoRecordId)).select('push_state,erp_docstatus,erp_cancelled_at'),
          kind, lookupColumn, orgId, pmoRecordId,
        ).maybeSingle();
        if (error) throw new AppError(error.message, error.code);
        const current = data as { push_state?: string; erp_docstatus?: number | null; erp_cancelled_at?: string | null } | null;
        if (current?.erp_cancelled_at != null && current.push_state === 'pushed' && current.erp_docstatus === 2) return;
      }
      const tombstoneUpdate = serviceClient.from(tableFor(pmoRecordId)).update({
        erp_cancelled_at: new Date().toISOString(),
        erp_docstatus: 2,
        erp_modified: erpModified,
        // Luna BLOCK 8: the DERIVED status must follow the cancel too. Revenue rollups exclude only
        // `status='Cancelled'` (db/revenue.ts) — a cancelled SI left `Unpaid` keeps contributing its
        // amount to project revenue and its outstanding to open AR (a wrong money figure on screen).
        ...cancelStatusPatch(kind),
      });
      const { error } = await (scopeMirrorQuery(tombstoneUpdate, kind, lookupColumn, orgId, pmoRecordId) as unknown as Promise<{ error: { message: string; code?: string } | null }>);
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
      // #775 phase B (FR-EXP-113) — a posted expense document cancelled in ERPNext. PMO's own approval-cancel is
      // expected and silent; anything else is a human acting in a headless ERP and must be surfaced.
      // A site float transfer (#1515) is also in the `expenses` domain but is never PMO-cancelled: always surface it, in its own words.
      if (kind === 'imprest-transfer') {
        await surfaceActionRequired(serviceClient, orgId, 'imprest-posting-desk-cancelled', { postingIdentity: pmoRecordId });
      } else if (domain === 'expenses') {
        await surfaceExpenseDeskCancelUnlessOurs(serviceClient, orgId, pmoRecordId);
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
      // ⚑ L-1 (Luna audit round 3) — the LAST query in this module that still used `.eq('id', …)`.
      // For the two Posture-B side mirrors that matches ZERO rows (their `id` is their own
      // `gen_random_uuid()`; the PMO record lives in `timesheet_id` / `budget_version_id`), and a
      // 0-row Postgres update is a silent no-op, not an error. Today the amend branch calls
      // `updateMirror` immediately after this and re-writes `erp_amended_from` through the correct
      // column, so nothing is observably lost — but a writer that only works because a DIFFERENT
      // writer repairs it is not a writer, it is a latent trap. Keyed like every sibling.
      const amendUpdate = serviceClient.from(tableFor(pmoRecordId)).update({
        erp_amended_from: amendedFrom,
        erp_modified: erpModified,
      });
      const { error } = await (scopeMirrorQuery(amendUpdate, kind, lookupColumn, orgId, pmoRecordId) as unknown as Promise<{ error: { message: string; code?: string } | null }>);
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

