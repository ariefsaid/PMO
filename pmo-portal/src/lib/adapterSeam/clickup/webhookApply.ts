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
import type { ClickUpHistoryItem, ClickUpTask, ClickUpWebhookEvent } from './types.ts';
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
<<<<<<< HEAD
  /** Set/clear the mirror's archived state (`tasks.archived_at`) — `null` un-archives. Archiving fires
   *  `taskUpdated` with a `history_items[].field === 'archived'` entry, NEVER `taskDeleted`; this is
   *  wired SEPARATELY from `tombstoneMirror` so an archive is never mistaken for a delete. */
  archiveMirror: (pmoRecordId: string, archivedAtIso: string | null) => Promise<void>;
}

/**
 * One event the WORKER applies (2026-07-20 fix, OD-INT-11): the real ClickUp webhook envelope carries
 * NO task body and NO timestamp (verified live, 7/7 real deliveries), so `applyWebhookEvent` no longer
 * reads either off the payload. Instead the worker re-GETs the task (`GET /task/{id}`) and passes the
 * result here — `task` is `null` for a genuine `taskDeleted`, OR when the re-GET 404s (the task no
 * longer exists, whatever verb triggered the check) — both collapse to the SAME tombstone-if-mapped
 * path. `historyItems` is the webhook's own per-change detail (used only to detect an archive/unarchive
 * transition — the re-GET'd task is otherwise the sole source of native-field truth, OD-INT-11 "apply
 * full current state").
 */
export interface WebhookWorkerEvent {
  event: ClickUpWebhookEvent;
  taskId: string;
  historyItems: ClickUpHistoryItem[];
  task: ClickUpTask | null;
}

/** Find the `history_items[]` entry (if any) recording an archive/unarchive transition. ClickUp
 *  stringifies the boolean (`after: 'true'|'false'`) — `String(...)` normalizes a real boolean too. */
function findArchivedTransition(historyItems: ClickUpHistoryItem[]): { after: boolean; atMs: number | null } | null {
  const item = historyItems.find((h) => h.field === 'archived');
  if (!item) return null;
  return { after: String(item.after) === 'true', atMs: item.date ? Number(item.date) : null };
=======
  /** Read the mirror's CURRENT PMO status (OD-INT-10, round 3) — feeds `fromClickUpStatus`'s
   *  stickiness so an inbound sync never moves a row OUT of a `pmo-only` status, and never downgrades
   *  the more specific PMO status of an explicitly recorded collapse. OPTIONAL: absent (the P1
   *  default) preserves byte-for-byte pre-round-3 behavior — status resolves off the plain inbound
   *  map with no "current status" awareness. */
  readMirrorStatus?: (pmoRecordId: string) => Promise<string | null>;
>>>>>>> origin/dev
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
 * Apply one WORKER-resolved webhook event (FR-CUA-043, OD-INT-11 2026-07-20 fix). `event.task === null`
 * covers BOTH a genuine `taskDeleted` and a re-GET that 404'd (the task no longer exists regardless of
 * which verb triggered the check) — both tombstone the mirror if mapped (AC-CUA-070, OD-CUA-2), else a
 * faithful no-op. ClickUp's delete carries NO timestamp at all (`history_items` is empty on a real
 * `taskDeleted`), so there is no comparable source-mod value to guard against staleness here — the
 * watermark is intentionally left untouched on this branch (the periodic sweep, ADR-0055 §3, remains the
 * convergence authority for this edge); tombstoning an already-tombstoned row is itself idempotent.
 *
 * `event.task !== null` (created/updated/status-updated, all re-GET'd): applies the FULL current state
 * through the source-mod-guarded upsert/adopt path, keyed on the re-GET's own `date_updated` (the
 * webhook payload carries none). If `history_items` records an archive/unarchive transition
 * (`field === 'archived'`), `archiveMirror` sets/clears `tasks.archived_at` — SEPARATE from the tombstone
 * path (an archive is never a delete) — skipped when the apply itself was a stale no-op (a fresher state
 * already won, so a stale archive signal must not apply either).
 *
 * The org watermark advances monotonically whenever a real ClickUp timestamp is available (orthogonal
 * to the per-row guard, FR-CUA-049).
 */
export async function applyWebhookEvent(
  event: WebhookWorkerEvent,
  deps: WebhookApplyDeps,
): Promise<ApplyOutcome> {
  const maps: ClickUpMaps = { statusMap: deps.statusMap, memberMap: deps.memberMap };

  if (event.task === null) {
    const existingId = await deps.resolvePmoRecordId(event.taskId);
    if (existingId === null) {
<<<<<<< HEAD
      return { kind: 'no-op' };
=======
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
      // OD-INT-10, round 3: resolve the mirror's CURRENT PMO status (when the caller supplies
      // `readMirrorStatus`) so `fromClickUpStatus`'s stickiness applies — a `pmo-only` status is never
      // moved out of by this sync, and an explicit collapse never downgrades the more specific status.
      let currentPmoStatus: string | undefined;
      if (deps.readMirrorStatus) {
        const existingId = await deps.resolvePmoRecordId(externalRecordId);
        if (existingId !== null) {
          currentPmoStatus = (await deps.readMirrorStatus(existingId)) ?? undefined;
        }
      }
      const canonical = clickUpTaskToPmoRecord(event.task, maps, currentPmoStatus);
      outcome = await applyInboundChange(externalRecordId, canonical, sourceUpdatedAtMs, deps);
>>>>>>> origin/dev
    }
    await deps.tombstoneMirror(existingId);
    await deps.surfaceDeletion?.(existingId, event.taskId);
    return { kind: 'tombstoned', pmoRecordId: existingId };
  }

  const sourceUpdatedAtMs = Number(event.task.date_updated);
  const canonical = clickUpTaskToPmoRecord(event.task, maps);
  const outcome = await applyInboundChange(event.taskId, canonical, sourceUpdatedAtMs, deps);

  const archived = findArchivedTransition(event.historyItems);
  if (archived && outcome.kind !== 'no-op') {
    const archivedAtIso = archived.after ? new Date(archived.atMs ?? sourceUpdatedAtMs).toISOString() : null;
    await deps.archiveMirror(outcome.pmoRecordId, archivedAtIso);
  }

  // Monotonic watermark advance — only when a real ClickUp `date_updated` is available.
  await advanceWatermarkMonotonic(deps, sourceUpdatedAtMs);
  return outcome;
}
