/**
 * Cancel/amend lineage (AC-ENA-020/021/022, R2, migration 0095 `external_ref_lineage`). Cancel is a
 * soft-tombstone (OQ-8 — stock REST enforces cancel-only, never delete, on a once-submitted doc):
 * `external_refs` is RETAINED, never repointed. Amend mints a new ERP `name`, so `external_refs`
 * repoints to it for the SAME `pmo_record_id` (no duplicate mirror row) and a lineage row records the
 * supersession. `guardStaleModified` is the per-row `erp_modified >=` no-rewind guard (mirrors
 * `applyEngine.ts`'s ms-based guard, but for ERPNext's raw sortable `modified` datetime STRING) —
 * wired into the actual inbound apply path in slice 8; this module ships the pure logic + unit ACs now.
 */
import { AdapterError } from '../contract.ts';

export interface LineageCtx {
  domain: string;
}

export type LineageReason = 'cancelled' | 'amended';

export interface LineageRow {
  domain: string;
  pmoRecordId: string;
  supersededExternalRecordId: string;
  successorExternalRecordId: string | null;
  reason: LineageReason;
  erpDocstatus: number | null;
}

export interface LineageDeps {
  /** Resolve the PMO record id currently mapped to an external record id, or `null` if unmapped. */
  resolvePmoRecordId: (externalRecordId: string) => Promise<string | null>;
  /** Soft-tombstone the mirror row (`erp_cancelled_at`, `erp_docstatus=2`) — `external_refs` untouched. */
  tombstoneMirror: (pmoRecordId: string, erpModified: string) => Promise<void>;
  /** Repoint `external_refs` to the new (amended) external record id for the SAME `pmo_record_id`.
   *  Guarded by the unique `(org_id, domain, external_record_id)` constraint (0093) so a concurrent
   *  duplicate repoint fails atomically — no duplicate mirror row can ever result. */
  repointExternalRef: (domain: string, pmoRecordId: string, newExternalRecordId: string) => Promise<void>;
  /** Stamp `erp_amended_from` + `erp_modified` on the (already-existing) mirror row. */
  stampAmended: (pmoRecordId: string, amendedFrom: string, erpModified: string) => Promise<void>;
  /** Insert one `external_ref_lineage` row. */
  recordLineage: (row: LineageRow) => Promise<void>;
}

/**
 * Apply a cancel (`docstatus 2`, AC-ENA-020): soft-tombstone the mirror and record a `cancelled`
 * lineage row. A no-op for an external id with no PMO mapping (nothing to cancel).
 */
export async function applyCancel(ctx: LineageCtx, externalRecordId: string, erpModified: string, deps: LineageDeps): Promise<void> {
  const pmoRecordId = await deps.resolvePmoRecordId(externalRecordId);
  if (!pmoRecordId) return;
  await deps.tombstoneMirror(pmoRecordId, erpModified);
  await deps.recordLineage({
    domain: ctx.domain,
    pmoRecordId,
    supersededExternalRecordId: externalRecordId,
    successorExternalRecordId: null,
    reason: 'cancelled',
    erpDocstatus: 2,
  });
}

/**
 * Apply an amend (new ERP `name`, `amended_from` = old, AC-ENA-021): repoint `external_refs` to the
 * new name for the same `pmo_record_id`, stamp `erp_amended_from`, and record an `amended` lineage
 * row — the SAME mirror row is reused (never a second mint). Throws when the superseded (old) name
 * carries no PMO mapping — an amend always implies a prior mapping existed.
 */
export async function applyAmend(
  ctx: LineageCtx,
  oldExternalRecordId: string,
  newExternalRecordId: string,
  erpModified: string,
  deps: LineageDeps,
): Promise<void> {
  const pmoRecordId = await deps.resolvePmoRecordId(oldExternalRecordId);
  if (!pmoRecordId) {
    throw new AdapterError('commit-rejected', `no PMO mapping for amend source "${oldExternalRecordId}"`);
  }
  await deps.repointExternalRef(ctx.domain, pmoRecordId, newExternalRecordId);
  await deps.stampAmended(pmoRecordId, oldExternalRecordId, erpModified);
  await deps.recordLineage({
    domain: ctx.domain,
    pmoRecordId,
    supersededExternalRecordId: oldExternalRecordId,
    successorExternalRecordId: newExternalRecordId,
    reason: 'amended',
    erpDocstatus: null,
  });
}

/**
 * The per-row `erp_modified >=` no-rewind guard (AC-ENA-022): `true` when `candidate` is STRICTLY
 * older than `stored` (a stale re-delivery — never applied). `stored === null` (fresh/unmapped) is
 * never stale. Frappe's `modified` is a sortable `"YYYY-MM-DD HH:MM:SS.ffffff"` string, so a plain
 * lexicographic compare is exact — no datetime parsing needed.
 */
export function guardStaleModified(stored: string | null, candidate: string): boolean {
  if (stored === null) return false;
  return candidate < stored;
}

export interface SupersededNameLookupDeps {
  /** The `external_ref_lineage_lookup_idx` (0095) index lookup: has this name been recorded as a
   *  superseded (cancelled/amended-away) name for this domain? */
  findLineageBySupersededName: (domain: string, erpName: string) => Promise<boolean>;
}

/**
 * `isSupersededName` (AC-ENA-022): used by the (slice-8) apply path to detect a stale event about a
 * name that has since been amended/cancelled away — such an event must never overwrite the live
 * (amended) mirror row, even if its own `erp_modified` looks newer than what the OLD name last saw.
 */
export function isSupersededName(domain: string, erpName: string, deps: SupersededNameLookupDeps): Promise<boolean> {
  return deps.findLineageBySupersededName(domain, erpName);
}
