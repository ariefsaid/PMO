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

/**
 * OPTIONAL atomic-adopt strategy (Luna BLOCK 7). The DEFAULT adopt path mints the mirror row first and
 * records `external_refs` second — so when two writers (webhook + sweep) adopt the SAME external record
 * concurrently, the `unique (org_id, domain, external_record_id)` constraint (0093) makes one of them
 * lose the ref write AFTER it has already inserted its randomly-keyed mirror row: a duplicate, forever
 * unmapped read-model row (for revenue: a duplicate visible invoice/payment).
 *
 * A tier that supplies this strategy inverts the order — the ref CLAIM is the adoption lock, taken for
 * a caller-generated PMO id BEFORE any mirror row exists, so a losing racer writes nothing at all. The
 * inverse window (ref claimed, process died before the mint) is closed by `mirrorExists`: an already-
 * mapped id whose mirror row is absent is re-minted with the SAME id on the next apply.
 *
 * Optional so P0/P1 (ClickUp) keep the legacy path byte-for-byte.
 */
export interface AtomicAdoptStrategy {
  /** Generate the PMO id the ref is claimed for (the mirror is later minted with exactly this id). */
  newPmoRecordId: () => string;
  /** Claim the `external_refs` mapping. MUST reject (23505) when another writer already claimed it. */
  claimExternalRef: (mapping: ExternalRefSeed) => Promise<void>;
  /** Mint the mirror row with the pre-claimed PMO id (never generates its own id). */
  mintWithId: (canonical: PmoRecord, sourceUpdatedAtMs: number, pmoRecordId: string) => Promise<void>;
  /** Does the mirror row for this PMO id exist? `false` ⇒ a claimed-but-unminted ref to repair. */
  mirrorExists: (pmoRecordId: string) => Promise<boolean>;
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
  /** OPTIONAL claim-then-mint adopt (Luna BLOCK 7). Absent ⇒ the legacy mint-then-ref path. */
  adoptAtomically?: AtomicAdoptStrategy;
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
    // Luna BLOCK 7 repair: the ref was claimed but the mirror never landed (the process died between
    // the two writes). Re-mint with the SAME pre-claimed id so the mapping stays intact — otherwise the
    // record is mapped to a row that does not exist and every later update silently patches 0 rows.
    if (deps.adoptAtomically && !(await deps.adoptAtomically.mirrorExists(existingId))) {
      const repaired: PmoRecord = { ...canonical, id: existingId };
      await deps.adoptAtomically.mintWithId(repaired, sourceUpdatedAtMs, existingId);
      return { kind: 'upserted', pmoRecordId: existingId, adopted: true };
    }
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

  // Pull-adopt. With the atomic strategy (Luna BLOCK 7) the `external_refs` CLAIM is taken FIRST, for a
  // caller-generated id: a concurrent adopt that races us fails the
  // `unique (org_id, domain, external_record_id)` constraint BEFORE any mirror row exists, so the loser
  // leaves no orphan (it reconciles to the winner's mapping on re-run).
  if (deps.adoptAtomically) {
    const claimedId = deps.adoptAtomically.newPmoRecordId();
    await deps.adoptAtomically.claimExternalRef({
      pmoRecordId: claimedId,
      externalTier: ctx.tier,
      externalRecordId,
      domain: ctx.domain,
    });
    await deps.adoptAtomically.mintWithId({ ...canonical, id: claimedId }, sourceUpdatedAtMs, claimedId);
    return { kind: 'upserted', pmoRecordId: claimedId, adopted: true };
  }

  // Legacy (P0/P1) path: mint a new mirror + mapping. The loser of a race reconciles on re-run.
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

/** An OPTIONAL override of the per-change apply strategy. Defaults to `applyInboundChange` (the
 *  source-mod-guarded upsert/adopt core) — P0/P1 never set it, so their sweep is byte-for-byte.
 *  A tier whose inbound events need richer routing (ERPNext: a `docstatus:2` → cancel, an
 *  `amended_from` → amend, a stale superseded name → no-op, FR-ENA-052/053) injects its lineage-aware
 *  apply here so `runSweep` applies each change through THAT path instead of the plain upsert. */
export type SweepApplyChange = (
  ctx: ApplyEngineCtx,
  externalRecordId: string,
  canonical: PmoRecord,
  sourceUpdatedAtMs: number,
  deps: ApplyChangeDeps,
) => Promise<ApplyOutcome>;

export interface SweepDeps extends ApplyChangeDeps, WatermarkDeps, SweepListChangesDeps {
  /** Optional lineage-aware apply override (slice 8 wires ERPNext's cancel/amend feed here). */
  applyChange?: SweepApplyChange;
}

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
    // Default: the source-mod-guarded upsert/adopt core. A tier with richer per-event routing
    // (ERPNext cancel/amend) injects `deps.applyChange` — byte-for-byte for P0/P1 (absent ⇒ default).
    const applyFn = deps.applyChange ?? applyInboundChange;
    const outcome = await applyFn(ctx, change.record.id, change.record, change.sourceModMs, deps);
    if (outcome.kind === 'upserted') applied += 1;
  }

  // Advance to nextCursor, monotonically (never rewinds). A null nextCursor (exhaustion) with no
  // applied change leaves the watermark untouched (no rewind of a higher one).
  if (nextCursor !== null) {
    await advanceWatermarkMonotonic(deps, Number(nextCursor));
  }
  return { applied, nextCursor };
}
