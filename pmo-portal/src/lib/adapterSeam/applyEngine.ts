/**
 * The shared, tier/domain-parameterized inbound-change apply engine (task 1.12). Hoisted out of the
 * P1 `clickup/{webhookApply,sweep}.ts` (which hardcoded `tier='clickup', domain='tasks'`) so a future
 * tier — ERPNext's modified-poll sweep, slice 8 — reuses the SAME source-mod-guarded upsert/adopt path
 * (FR-CUA-049/FR-ENA-071 "any apply") instead of re-implementing it. `clickup/{webhookApply,sweep}.ts`
 * now re-export thin wrappers that pass `{tier:'clickup',domain:'tasks'}` so every P1 test stays
 * byte-for-byte (this module carries NO ClickUp/ERPNext vocabulary — confinement, NFR-EAS-CONTRACT-001).
 *
 * Pure + Deno-importable (relative imports only); all DB access is via injected deps.
 */
import type { PmoRecord } from './contract.ts';

/** The tier + domain a caller is applying changes for (e.g. `{tier:'clickup',domain:'tasks'}` or
 *  `{tier:'erpnext',domain:'procurement'}`) — threaded into the `external_refs` record on adopt. */
export interface ApplyEngineCtx {
  tier: string;
  domain: string;
}

/** The outcome of one apply — lets a caller return a meaningful result and lets tests assert paths. */
export type ApplyOutcome =
  | { kind: 'upserted'; pmoRecordId: string; adopted: boolean }
  | { kind: 'tombstoned'; pmoRecordId: string }
  | { kind: 'no-op' };

/** The `external_refs` mapping recorded on a pull-adopt (same shape as `dispatch.ts`'s `ExternalRefMapping`
 *  / `refs.ts`'s `ExternalRefRecord` — kept local here to avoid coupling the apply engine to the
 *  dispatch module). */
export interface ExternalRefSeed {
  pmoRecordId: string;
  externalTier: string;
  externalRecordId: string;
  domain: string;
}

/** The narrow dep surface `applyInboundChange` needs — shared by a webhook AND a sweep so both apply
 *  through the SAME source-mod-guarded path ("any apply"). */
export interface ApplyChangeDeps {
  /** Resolve the PMO record id already mapped to an external record id (`null` = unmapped → adopt). */
  resolvePmoRecordId: (externalRecordId: string) => Promise<string | null>;
  /** Read the mirrored row's stored source-modification timestamp (epoch-ms), or `null` if none. */
  readMirrorSourceMod: (pmoRecordId: string) => Promise<number | null>;
  /** Upsert native fields on an existing mirror + stamp `source_updated_at` (epoch-ms provided). */
  updateMirror: (pmoRecordId: string, canonical: PmoRecord, sourceUpdatedAtMs: number) => Promise<void>;
  /** Mint a new mirrored row for an adopted record + stamp `source_updated_at`; return its PMO id. */
  mintMirror: (canonical: PmoRecord, sourceUpdatedAtMs: number) => Promise<string>;
  /** Record the `external_refs` mapping for a newly-minted mirror. */
  recordExternalRef: (mapping: ExternalRefSeed) => Promise<void>;
}

/** The narrow dep surface the monotonic-watermark helper needs (webhook + sweep). */
export interface WatermarkDeps {
  /** Read the org's watermark cursor (epoch-ms string), or `null` if fresh. */
  readWatermark: () => Promise<string | null>;
  /** Advance the org's watermark cursor (the caller guarantees monotonicity — see advanceMonotonic). */
  advanceWatermark: (cursor: string) => Promise<void>;
}

/**
 * Apply one inbound change (an external record → canonical record) through the source-mod-guarded
 * upsert/adopt path. Shared by a webhook and a sweep. The `externalRecordId` is the external system's
 * id for the record; `canonical.id` is overwritten with the resolved PMO id so the enhancement graph
 * (keyed on `pmo_record_id`) stays intact on an update.
 */
export async function applyInboundChange(
  ctx: ApplyEngineCtx,
  externalRecordId: string,
  canonical: PmoRecord,
  sourceUpdatedAtMs: number,
  deps: ApplyChangeDeps,
): Promise<ApplyOutcome> {
  const existingId = await deps.resolvePmoRecordId(externalRecordId);

  if (existingId) {
    const stored = await deps.readMirrorSourceMod(existingId);
    // Per-row source-mod guard: a strictly-older change is a no-op. `>=` (not `>`) is deliberate so
    // re-delivery and an inclusive sweep boundary re-apply the SAME state (idempotent).
    if (stored !== null && sourceUpdatedAtMs < stored) {
      return { kind: 'no-op' };
    }
    const canonicalPinned: PmoRecord = { ...canonical, id: existingId };
    await deps.updateMirror(existingId, canonicalPinned, sourceUpdatedAtMs);
    return { kind: 'upserted', pmoRecordId: existingId, adopted: false };
  }

  // Pull-adopt: mint a new mirror + mapping. A concurrent adopt that races us fails the
  // `unique (org_id, domain, external_record_id)` constraint; the loser reconciles to the existing
  // mapping on re-run.
  const pmoRecordId = await deps.mintMirror(canonical, sourceUpdatedAtMs);
  await deps.recordExternalRef({
    pmoRecordId,
    externalTier: ctx.tier,
    externalRecordId,
    domain: ctx.domain,
  });
  return { kind: 'upserted', pmoRecordId, adopted: true };
}

/**
 * Advance the org watermark to `max(current, candidateMs)` — monotonic, never rewinds. Read-then-write:
 * the candidate is the event's source-modification time (webhook) or the page's max (sweep), both
 * already >= any prior cursor by construction; the max() is the no-rewind guarantee for an
 * out-of-order older event whose apply was a per-row no-op.
 */
export async function advanceWatermarkMonotonic(deps: WatermarkDeps, candidateMs: number): Promise<void> {
  const current = await deps.readWatermark();
  const currentMs = current !== null ? Number(current) : null;
  const advanced = currentMs !== null && currentMs > candidateMs ? currentMs : candidateMs;
  await deps.advanceWatermark(String(advanced));
}

/** One change a sweep applies: a canonical PMO record (id = the external record id) + its source-mod ms. */
export interface SweepChange {
  record: PmoRecord;
  /** The change's source-modification timestamp (epoch-ms) — the per-row guard value. */
  sourceModMs: number;
}

/** The sweep's source read: enumerate changes since the cursor. */
export interface SweepListChangesDeps {
  listChanges: (cursor: string | null) => Promise<{ changes: SweepChange[]; nextCursor: string | null }>;
}

export interface SweepDeps extends ApplyChangeDeps, WatermarkDeps, SweepListChangesDeps {}

export interface SweepResult {
  /** Changes that applied (upsert or adopt) this run. Stale (per-row-guard no-op) changes do not count. */
  applied: number;
  /** The cursor the watermark was advanced to (`null` = not advanced — exhaustion or unreachable). */
  nextCursor: string | null;
}

/**
 * Run one sweep cycle for an employing org, for the given `(tier, domain)`. Reads the watermark,
 * enumerates changes since it, applies each through the source-mod-guarded path, and advances the
 * watermark to `nextCursor` (monotonic). If the adapter is unreachable (`listChanges` throws), the
 * sweep throws WITHOUT advancing the watermark or touching the read-model — the next schedule retries.
 */
export async function runSweep(ctx: ApplyEngineCtx, deps: SweepDeps): Promise<SweepResult> {
  const cursor = await deps.readWatermark();

  // An unreachable adapter throws here — we let it propagate (no advance, no apply).
  const { changes, nextCursor } = await deps.listChanges(cursor);

  let applied = 0;
  for (const change of changes) {
    const outcome = await applyInboundChange(ctx, change.record.id, change.record, change.sourceModMs, deps);
    if (outcome.kind === 'upserted') applied += 1;
  }

  // Advance to nextCursor, monotonically (never rewinds). A null nextCursor (exhaustion) with no
  // applied change leaves the watermark untouched (no rewind of a higher one).
  if (nextCursor !== null) {
    await advanceWatermarkMonotonic(deps, Number(nextCursor));
  }
  return { applied, nextCursor };
}
