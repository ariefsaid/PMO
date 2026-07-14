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
import {
  applyInboundChange as applyInboundChangeGeneric,
  advanceWatermarkMonotonic,
  type ApplyOutcome,
  type ApplyChangeDeps,
  type WatermarkDeps,
} from '../applyEngine.ts';

const CLICKUP_TIER = 'clickup';
const TASKS_DOMAIN = 'tasks';
const CLICKUP_TASKS_CTX = { tier: CLICKUP_TIER, domain: TASKS_DOMAIN };

// Re-exported for byte-for-byte back-compat (task 1.12 hoists the implementation to
// `../applyEngine.ts`; this module's exported names/shapes are unchanged for every existing
// consumer — `sweep.ts`, and any future direct import of these types).
export type { ApplyOutcome, ApplyChangeDeps, WatermarkDeps, ExternalRefSeed };
export { advanceWatermarkMonotonic };

export interface WebhookApplyDeps extends ApplyChangeDeps, WatermarkDeps, ClickUpMaps {
  statusMap: ClickUpStatusMap;
  memberMap: ClickUpMemberMap;
  /** Soft-tombstone a mirror (set `tombstoned_at`); dependency/milestone rows are preserved (OD-CUA-2). */
  tombstoneMirror: (pmoRecordId: string) => Promise<void>;
  /** Surface a deletion (AC-CUA-070 non-silent) — an audit/notice write; optional (P1: structured log). */
  surfaceDeletion?: (pmoRecordId: string, externalRecordId: string) => Promise<void>;
}

/**
 * Apply one inbound change (a ClickUp task → canonical record) through the source-mod-guarded
 * upsert/adopt path. Shared by the webhook (taskCreated/Updated/StatusUpdated) and the sweep (each
 * listed change). The `externalRecordId` is the ClickUp task id; the canonical.id is overwritten with
 * the resolved PMO id so the enhancement graph (keyed on pmo_record_id) stays intact (AC-CUA-071).
 *
 * Task 1.12: delegates to the hoisted, tier/domain-parameterized `applyEngine.ts` with
 * `{tier:'clickup',domain:'tasks'}` baked in — byte-for-byte identical behavior to the pre-1.12
 * ClickUp-only implementation.
 */
export async function applyInboundChange(
  externalRecordId: string,
  canonical: PmoRecord,
  sourceUpdatedAtMs: number,
  deps: ApplyChangeDeps,
): Promise<ApplyOutcome> {
  return applyInboundChangeGeneric(CLICKUP_TASKS_CTX, externalRecordId, canonical, sourceUpdatedAtMs, deps);
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
