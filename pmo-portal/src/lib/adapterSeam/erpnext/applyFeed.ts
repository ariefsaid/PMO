/**
 * erpnext/applyFeed.ts (task 8.5, AC-ENA-052/053) — the lineage-aware inbound apply path BOTH the
 * webhook (8.2) and the modified-poll sweep (8.6) route every ERP change through. This is the lineage
 * module (slice 2.11) WIRED into the feed: it reads the routing fields the sweepCursor stamps on the
 * canonical record (`erp_docstatus`, `erp_amended_from`) and dispatches to:
 *   • a stale superseded name        → `isSupersededName` no-op (never clobbers the live amended row);
 *   • `docstatus:2`                  → `applyCancel` (soft-tombstone + cancelled lineage; external_refs retained);
 *   • `amended_from` set (new name)  → `applyAmend` (repoint + stamp + amended lineage — no duplicate mirror)
 *                                       FOLLOWED BY the successor's money/status convergence; an already-
 *                                       repointed successor keeps applying through the guarded upsert, and a
 *                                       native amend of an unmapped old doc falls back to a fresh adopt;
 *   • otherwise                      → `applyInboundChange` (the shared source-mod-guarded upsert/adopt).
 *
 * Pure + Deno-importable (relative imports only); all DB access via injected deps. Reuses the hoisted
 * `applyEngine.applyInboundChange` (the "any apply" upsert/adopt core, FR-ENA-073/083) + the pure
 * `lineage.ts` cancel/amend/superseded helpers. Frappe vocabulary (docstatus, amended_from) is read
 * off the canonical HERE, confined to erpnext/** — never crosses the adapter contract.
 *
 * This function is the `applyChange` the ERP sweep injects into `applyEngine.runSweep` (slice 1.12's
 * optional override) so the sweep applies each change through cancel/amend routing, while ClickUp/P0/P1
 * stay byte-for-byte (they don't set `applyChange`).
 */
import type { ApplyEngineCtx, ApplyChangeDeps, ApplyOutcome } from '../applyEngine.ts';
import { applyInboundChange } from '../applyEngine.ts';
import type { PmoRecord } from '../contract.ts';
import { applyAmend, applyCancel, isSupersededName, type LineageDeps, type SupersededNameLookupDeps } from './lineage.ts';

/** The combined deps the ERP feed apply needs: the shared apply deps + the lineage deps + the
 *  superseded-name lookup. Constructed by the webhook/sweep edge fns from the per-domain mirror
 *  table writers (apply) + a lineage DB writer (cancel/amend/superseded). */
export type ErpFeedDeps = ApplyChangeDeps & LineageDeps & SupersededNameLookupDeps;

/** Read the ERP routing fields the sweepCursor stamps on the canonical record. Absent ⇒ a normal
 *  upsert/adopt (a webhook event the ingress decoded without routing fields is treated as an update). */
function docstatusOf(canonical: PmoRecord): number | null {
  const v = (canonical as { erp_docstatus?: unknown }).erp_docstatus;
  return typeof v === 'number' ? v : v !== null && v !== undefined && v !== '' ? Number(v) : null;
}
function amendedFromOf(canonical: PmoRecord): string | null {
  const v = (canonical as { erp_amended_from?: unknown }).erp_amended_from;
  return v === null || v === undefined || v === '' ? null : String(v);
}

/**
 * Apply one inbound ERP change through the lineage-aware path. `externalRecordId` is the ERP `name`;
 * `canonical.id` is overwritten with the resolved PMO id on the upsert/adopt branch (applyInboundChange
 * does this) so the enhancement graph stays keyed on pmo_record_id. `sourceModMs` is the row's
 * `modified` (epoch-ms) — converted to the ISO string the lineage tombstone/stampAmended writers carry.
 */
export async function applyErpFeedEvent(
  ctx: ApplyEngineCtx,
  externalRecordId: string,
  canonical: PmoRecord,
  sourceModMs: number,
  deps: ErpFeedDeps,
): Promise<ApplyOutcome> {
  // 1. A stale event for a name that has since been amended/cancelled away is a guarded no-op — it
  //    must NEVER overwrite the live (amended) mirror row, even if its own modified looks newer than
  //    the OLD name's last-seen value (AC-ENA-053, FR-ENA-053).
  const superseded = await isSupersededName(ctx.domain, externalRecordId, deps);
  if (superseded) return { kind: 'no-op' };

  const docstatus = docstatusOf(canonical);
  const amendedFrom = amendedFromOf(canonical);
  const erpModifiedIso = new Date(sourceModMs).toISOString();

  // 2. A cancel (docstatus 2) → soft-tombstone + cancelled lineage row. external_refs is RETAINED
  //    (stock REST is cancel-only on a once-submitted doc — OQ-8). A no-op for an unmapped name
  //    (applyCancel itself short-circuits).
  if (docstatus === 2) {
    const pmoRecordId = await deps.resolvePmoRecordId(externalRecordId);
    if (!pmoRecordId) return { kind: 'no-op' };
    await applyCancel({ domain: ctx.domain }, externalRecordId, erpModifiedIso, deps);
    return { kind: 'tombstoned', pmoRecordId };
  }

  // 3. An amend (the NEW name carries `amended_from` = the old name) → repoint external_refs to the
  //    new name for the SAME pmo_record_id (no duplicate mirror row), stamp erp_amended_from, record
  //    the amended lineage row. If the NEW name is already mapped (idempotent re-delivery) it's a
  //    no-op; if the OLD name was never mapped (a native ERP amend of a doc PMO never tracked) fall
  //    back to a fresh adopt of the new name.
  if (amendedFrom !== null) {
    const newMapped = await deps.resolvePmoRecordId(externalRecordId);
    if (newMapped) {
      // Already repointed. The LINEAGE work is done (never repeat it — that is this guard's real
      // purpose), but `amended_from` stays on the successor document FOREVER, so every later change to
      // it re-enters this branch. Returning a flat no-op here froze the mirror on whatever figures it
      // held at the repoint: a part-payment, a settle, a re-cancel of the successor never landed
      // (round-5 cross-family finding 6). Route the event through the shared source-mod-guarded
      // upsert instead — a genuinely stale re-delivery is still a no-op, by the per-row guard.
      return applyInboundChange(ctx, externalRecordId, canonical, sourceModMs, deps);
    }
    const oldMapped = await deps.resolvePmoRecordId(amendedFrom);
    if (oldMapped) {
      // applyAmend repoints external_refs to the new name for the SAME pmo_record_id (no duplicate
      // mirror), stamps erp_amended_from, and records the amended lineage row.
      await applyAmend({ domain: ctx.domain }, amendedFrom, externalRecordId, erpModifiedIso, deps);
      // …then CONVERGE the mirror on the successor's own money + lifecycle. Repointing alone left the
      // row carrying the PREDECESSOR's amount/outstanding/status — so a natively-amended invoice kept
      // counting its cancelled figures toward project revenue and open AR indefinitely, and the
      // successor's real (possibly very different) amount never landed. `updateMirror` owns the
      // canonical status derivations + the putIfPresent discipline: an event that does not carry the
      // status oracle leaves `status` alone for the next sweep tick to repair rather than guessing.
      await deps.updateMirror(oldMapped, { ...canonical, id: oldMapped }, sourceModMs);
      return { kind: 'upserted', pmoRecordId: oldMapped, adopted: false };
    }
    // The old name was never mapped (a native ERP amend of a doc PMO never tracked) — fall through to
    // a fresh adopt of the new name via the shared upsert/adopt path.
  }

  // 4. Normal event → the shared source-mod-guarded upsert/adopt (FR-ENA-073/083 "any apply").
  return applyInboundChange(ctx, externalRecordId, canonical, sourceModMs, deps);
}
