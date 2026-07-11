/**
 * The reconciliation sweep (FR-CUA-045/046/047, AC-CUA-043/044). The safety net that catches webhook
 * gaps (ADR-0055 §3: webhooks for latency, sweep for truth): per employing org, read the
 * `(tasks, clickup)` watermark → enumerate changes since it → apply each through the SAME
 * source-mod-guarded path as the webhook (FR-CUA-049 "any apply", via the shared `applyInboundChange`)
 * → advance the watermark to `nextCursor` (monotonic, never rewinds).
 *
 * Pure + Deno-importable (relative imports only); all DB + ClickUp access is via injected deps, so
 * every path is unit-testable with mocked callbacks (no live token). Bulk lane throughout
 * (NFR-CUA-PERF-003). ClickUp vocabulary is confined to clickup/** + the clickup-sweep fn (FR-CUA-012).
 */
import type { PmoRecord } from '../contract.ts';
import { applyInboundChange, advanceWatermarkMonotonic, type ApplyChangeDeps, type WatermarkDeps } from './webhookApply.ts';
import type { ClickUpMaps } from './mapping.ts';
import type { ClickUpStatusMap } from './statusMap.ts';
import type { ClickUpMemberMap } from './memberMap.ts';

/** One change the sweep applies: a canonical PMO record (id = ClickUp task id) + its source-mod ms. */
export interface SweepChange {
  record: PmoRecord;
  /** The change's source-modification timestamp (epoch-ms) — the per-row guard value (FR-CUA-049). */
  sourceModMs: number;
}

/** The sweep's source read: enumerate changes since the cursor (the edge fn wires this to the raw
 *  ClickUp list read so each change carries its `date_updated` for the per-row guard). */
export interface SweepListChangesDeps {
  listChanges: (cursor: string | null) => Promise<{ changes: SweepChange[]; nextCursor: string | null }>;
}

export interface SweepDeps extends ApplyChangeDeps, WatermarkDeps, SweepListChangesDeps, ClickUpMaps {
  statusMap: ClickUpStatusMap;
  memberMap: ClickUpMemberMap;
}

export interface SweepResult {
  /** Changes that applied (upsert or adopt) this run. Stale (per-row-guard no-op) changes do not count. */
  applied: number;
  /** The cursor the watermark was advanced to (`null` = not advanced — exhaustion or unreachable). */
  nextCursor: string | null;
}

/**
 * Run one sweep cycle for an employing org (AC-CUA-043/044). Reads the watermark, enumerates changes
 * since it, applies each through the source-mod-guarded path, and advances the watermark to
 * `nextCursor` (monotonic). If the adapter is unreachable (`listChanges` throws), the sweep throws
 * WITHOUT advancing the watermark or touching the read-model (AC-CUA-044) — the next schedule retries.
 */
export async function runSweep(deps: SweepDeps): Promise<SweepResult> {
  const cursor = await deps.readWatermark();

  // AC-CUA-044: an unreachable adapter throws here — we let it propagate (no advance, no apply).
  const { changes, nextCursor } = await deps.listChanges(cursor);

  let applied = 0;
  for (const change of changes) {
    const outcome = await applyInboundChange(change.record.id, change.record, change.sourceModMs, deps);
    if (outcome.kind === 'upserted') applied += 1;
  }

  // AC-CUA-043/046: advance to nextCursor, monotonically (never rewinds). A null nextCursor
  // (exhaustion) with no applied change leaves the watermark untouched (no rewind of a higher one).
  if (nextCursor !== null) {
    await advanceWatermarkMonotonic(deps, Number(nextCursor));
  }
  return { applied, nextCursor };
}
