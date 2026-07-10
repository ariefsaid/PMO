/**
 * The pure webhook apply engine (FR-CUA-042/043/044/049/062, AC-CUA-040..045/070/071).
 *
 * ASSUMES VERIFIED INPUT — the `X-Signature` HMAC gate (FR-CUA-041) is the edge fn's job; this pure
 * function never sees an unverified request. It carries three interacting invariants (the riskiest
 * task of Slice D, per the plan):
 *   1. Per-row source-modification monotonicity `>=` guard (FR-CUA-049): an incoming change applies
 *      only if its `date_updated` >= the mirrored row's stored `source_updated_at`. Independent of the
 *      org watermark — a late-arriving older event is a per-row no-op, never overwriting fresher state.
 *   2. Adopt-under-concurrency (FR-CUA-064): an unmapped ClickUp task mints a mirror + mapping; a
 *      concurrent adopt races and the loser reconciles to the existing mapping on re-run (the A8
 *      `unique (org_id, domain, external_record_id)` is the dedupe authority — this module relies on
 *      the edge fn's `recordExternalRef` surfacing a 23505 there as a recoverable adopt-no-op).
 *   3. Monotonic watermark advance (FR-CUA-043/046): the org `(tasks, clickup)` watermark advances to
 *      `max(current, eventDateUpdated)` on EVERY verified event — orthogonal to the per-row guard, so
 *      a no-op apply still advances the watermark (never rewinds).
 *
 * Pure + Deno-importable (relative imports only); all DB access is via injected service-client deps,
 * so every path is unit-testable with mocked callbacks (no live token). ClickUp vocabulary
 * (ClickUpWebhookPayload, date_updated) is confined to clickup/** + the clickup-webhook fn (FR-CUA-012).
 *
 * `applyInboundChange` is the shared upsert/adopt core — the sweep (sweep.ts) reuses it per change so
 * the webhook and the sweep apply through the SAME source-mod-guarded path (FR-CUA-049 "any apply").
 */
import type { PmoRecord } from '../contract.ts';
import { clickUpTaskToPmoRecord, type ClickUpMaps } from './mapping.ts';
import type { ClickUpStatusMap } from './statusMap.ts';
import type { ClickUpMemberMap } from './memberMap.ts';
import type { ClickUpWebhookPayload } from './types.ts';
import type { ExternalRefSeed } from './onboarding.ts';

const CLICKUP_TIER = 'clickup';
const TASKS_DOMAIN = 'tasks';

/** The outcome of one apply — lets the edge fn return a meaningful 200 and lets tests assert paths. */
export type ApplyOutcome =
  | { kind: 'upserted'; pmoRecordId: string; adopted: boolean }
  | { kind: 'tombstoned'; pmoRecordId: string }
  | { kind: 'no-op' };

/**
 * Injected service-client deps for the apply engine. Every callback is a thin DB read/write the edge
 * fn wires (createClient(serviceRole)); the pure module owns the ordering + the guards. The source-mod
 * values flow as epoch-ms (TZ-safe numeric `>=` compare); the edge fn converts to/from the
 * `source_updated_at` timestamptz column.
 */
export interface WebhookApplyDeps extends ClickUpMaps {
  statusMap: ClickUpStatusMap;
  memberMap: ClickUpMemberMap;
  /** Resolve the PMO record id already mapped to a ClickUp task id (`null` = unmapped → adopt). */
  resolvePmoRecordId: (externalRecordId: string) => Promise<string | null>;
  /** Read the mirrored row's stored source-modification timestamp (epoch-ms), or `null` if none. */
  readMirrorSourceMod: (pmoRecordId: string) => Promise<number | null>;
  /** Upsert native fields on an existing mirror + stamp `source_updated_at` (epoch-ms provided). */
  updateMirror: (pmoRecordId: string, canonical: PmoRecord, sourceUpdatedAtMs: number) => Promise<void>;
  /** Mint a new mirrored row for an adopted task + stamp `source_updated_at`; return its PMO id. */
  mintMirror: (canonical: PmoRecord, sourceUpdatedAtMs: number) => Promise<string>;
  /** Soft-tombstone a mirror (set `tombstoned_at`); dependency/milestone rows are preserved (OD-CUA-2). */
  tombstoneMirror: (pmoRecordId: string) => Promise<void>;
  /** Record the `external_refs` mapping for a newly-minted mirror. */
  recordExternalRef: (mapping: ExternalRefSeed) => Promise<void>;
  /** Surface a deletion (AC-CUA-070 non-silent) — an audit/notice write; optional (P1: structured log). */
  surfaceDeletion?: (pmoRecordId: string, externalRecordId: string) => Promise<void>;
  /** Read the org's `(tasks, clickup)` watermark cursor (epoch-ms string), or `null` if fresh. */
  readWatermark: () => Promise<string | null>;
  /** Advance the org's watermark cursor (the caller guarantees monotonicity — see advanceMonotonic). */
  advanceWatermark: (cursor: string) => Promise<void>;
}

/**
 * Apply one inbound change (a ClickUp task → canonical record) through the source-mod-guarded
 * upsert/adopt path. Shared by the webhook (taskCreated/Updated/StatusUpdated) and the sweep (each
 * listed change). The `externalRecordId` is the ClickUp task id; the canonical.id is overwritten with
 * the resolved PMO id so the enhancement graph (keyed on pmo_record_id) stays intact (AC-CUA-071).
 */
export async function applyInboundChange(
  externalRecordId: string,
  canonical: PmoRecord,
  sourceUpdatedAtMs: number,
  deps: WebhookApplyDeps,
): Promise<ApplyOutcome> {
  const existingId = await deps.resolvePmoRecordId(externalRecordId);

  if (existingId) {
    const stored = await deps.readMirrorSourceMod(existingId);
    // Per-row source-mod guard (FR-CUA-049): a strictly-older change is a no-op. `>=` (not `>`) is
    // deliberate so re-delivery and the inclusive sweep boundary re-apply the SAME state (idempotent).
    if (stored !== null && sourceUpdatedAtMs < stored) {
      return { kind: 'no-op' };
    }
    const canonicalPinned: PmoRecord = { ...canonical, id: existingId };
    await deps.updateMirror(existingId, canonicalPinned, sourceUpdatedAtMs);
    return { kind: 'upserted', pmoRecordId: existingId, adopted: false };
  }

  // Pull-adopt (FR-CUA-062/044): mint a new mirror + mapping. A concurrent adopt that races us
  // fails the A8 unique constraint; the loser reconciles to the existing mapping on re-run.
  const pmoRecordId = await deps.mintMirror(canonical, sourceUpdatedAtMs);
  await deps.recordExternalRef({
    pmoRecordId,
    externalTier: CLICKUP_TIER,
    externalRecordId,
    domain: TASKS_DOMAIN,
  });
  return { kind: 'upserted', pmoRecordId, adopted: true };
}

/**
 * Advance the org watermark to `max(current, candidateMs)` — monotonic, never rewinds
 * (FR-CUA-043/046). Read-then-write: the candidate is the event's date_updated (webhook) or the
 * page's max date_updated (sweep), both already >= any prior cursor by construction; the max() is the
 * no-rewind guarantee for an out-of-order older event whose apply was a per-row no-op.
 */
export async function advanceWatermarkMonotonic(deps: WebhookApplyDeps, candidateMs: number): Promise<void> {
  const current = await deps.readWatermark();
  const currentMs = current !== null ? Number(current) : null;
  const advanced = currentMs !== null && currentMs > candidateMs ? currentMs : candidateMs;
  await deps.advanceWatermark(String(advanced));
}

/**
 * Apply one verified webhook event (FR-CUA-043). Branches on the event verb:
 *   - taskDeleted → tombstone the mirror (AC-CUA-070, OD-CUA-2); unmapped → no-op (nothing to remove).
 *   - taskCreated/taskUpdated/taskStatusUpdated → applyInboundChange (upsert or adopt).
 * The org watermark advances monotonically on EVERY verified event (orthogonal to the per-row guard).
 */
export async function applyWebhookEvent(
  event: ClickUpWebhookPayload,
  deps: WebhookApplyDeps,
): Promise<ApplyOutcome> {
  const externalRecordId = event.task_id;
  const sourceUpdatedAtMs = Number(event.date_updated);
  const maps: ClickUpMaps = { statusMap: deps.statusMap, memberMap: deps.memberMap };

  let outcome: ApplyOutcome;
  if (event.event === 'taskDeleted') {
    const existingId = await deps.resolvePmoRecordId(externalRecordId);
    if (existingId === null) {
      // Nothing to tombstone (the task was never mirrored) — a faithful no-op.
      outcome = { kind: 'no-op' };
    } else {
      // A delete is also a read-model apply (a tombstone) — guard it the same way (FR-CUA-049): a
      // strictly-older delete is a no-op (a fresher state already won). Once applied, tombstoning an
      // already-tombstoned row is itself idempotent.
      const stored = await deps.readMirrorSourceMod(existingId);
      if (stored !== null && sourceUpdatedAtMs < stored) {
        outcome = { kind: 'no-op' };
      } else {
        await deps.tombstoneMirror(existingId);
        await deps.surfaceDeletion?.(existingId, externalRecordId);
        outcome = { kind: 'tombstoned', pmoRecordId: existingId };
      }
    }
  } else {
    if (!event.task) {
      // A created/updated event without a task body is malformed — surface and treat as a no-op
      // rather than crashing the ingress (the sweep is the safety net for the missing change).
      outcome = { kind: 'no-op' };
    } else {
      const canonical = clickUpTaskToPmoRecord(event.task, maps);
      outcome = await applyInboundChange(externalRecordId, canonical, sourceUpdatedAtMs, deps);
    }
  }

  // Monotonic watermark advance on every verified event (FR-CUA-043/049 orthogonality).
  await advanceWatermarkMonotonic(deps, sourceUpdatedAtMs);
  return outcome;
}
