/**
 * AC-CUA-070 — a ClickUp deletion tombstones the mirror and preserves the enhancement graph (OD-CUA-2).
 *
 * The owning test for the `taskDeleted` branch (AC-CUA-071's update-preserves-enhancements half is
 * owned by webhookApply.test.ts). Proves:
 *   - the mirrored row is TOMBSTONED (tombstoned_at set), NOT hard-removed;
 *   - its dependency edges + milestone grouping are PRESERVED (keyed on the retained pmo_record_id —
 *     the external_refs mapping is kept, never deleted; tombstoneMirror touches tombstoned_at only);
 *   - the deletion is SURFACED (surfaceDeletion invoked — non-silent, AC-CUA-070).
 *
 * 2026-07-20 (OD-INT-11 fix): a real ClickUp `taskDeleted` delivery carries `history_items: []` — NO
 * timestamp at all (live-verified). The old "a STALE delete is a no-op" case tested against a
 * `date_updated` field that does not exist on a real delete payload; it is intentionally DROPPED here
 * (see webhookApply.ts's `applyWebhookEvent` doc comment) — a genuine `taskDeleted` always tombstones a
 * mapped task (idempotently — tombstoning an already-tombstoned row is a no-op write).
 * `event.task === null` also covers a re-GET 404 for a non-delete verb (owned by webhookApply.test.ts).
 */
import { describe, it, expect, vi } from 'vitest';
import { applyWebhookEvent, type WebhookApplyDeps, type WebhookWorkerEvent } from './webhookApply.ts';
import type { ClickUpStatusMap } from './statusMap.ts';
import type { ClickUpMemberMap } from './memberMap.ts';

const statusMap: ClickUpStatusMap = {
  pmoToClickUp: { 'To Do': 'to do', Done: 'complete' },
  clickUpToPmo: { 'to do': 'To Do', complete: 'Done' },
  defaultPmoStatus: 'To Do',
};
const memberMap: ClickUpMemberMap = { pmoToClickUp: {}, clickUpToPmo: {} };

function deletionDeps(config: { mappedPmoId?: string | null; storedSourceModMs?: number | null; watermark?: string | null } = {}) {
  const tombstones: string[] = [];
  const surfaced: Array<{ pmoRecordId: string; externalRecordId: string }> = [];
  const refsDeleted: string[] = [];
  const deps: WebhookApplyDeps = {
    statusMap,
    memberMap,
    resolvePmoRecordId: vi.fn(async () => config.mappedPmoId ?? null),
    readMirrorSourceMod: vi.fn(async () => config.storedSourceModMs ?? null),
    updateMirror: vi.fn(async () => {}),
    mintMirror: vi.fn(async () => 'pmo-minted'),
    tombstoneMirror: vi.fn(async (pmoRecordId) => {
      tombstones.push(pmoRecordId);
    }),
    archiveMirror: vi.fn(async () => {}),
    recordExternalRef: vi.fn(async () => {}),
    surfaceDeletion: vi.fn(async (pmoRecordId, externalRecordId) => {
      surfaced.push({ pmoRecordId, externalRecordId });
    }),
    readWatermark: vi.fn(async () => config.watermark ?? null),
    advanceWatermark: vi.fn(async () => {}),
  };
  return { deps, tombstones, surfaced, refsDeleted };
}

function deletedEvent(taskId: string): WebhookWorkerEvent {
  return { event: 'taskDeleted', taskId, historyItems: [], task: null };
}

describe('AC-CUA-070 a taskDeleted tombstones the mirror and preserves the enhancement graph (non-silent)', () => {
  it('tombstones the mirrored row (NOT removed), keeps the mapping, preserves edges/milestone, surfaces the deletion', async () => {
    const { deps, tombstones, surfaced } = deletionDeps({ mappedPmoId: 'pmo-1', storedSourceModMs: 1000 });

    const outcome = await applyWebhookEvent(deletedEvent('cu-1'), deps);

    expect(outcome).toEqual({ kind: 'tombstoned', pmoRecordId: 'pmo-1' });
    // The row is tombstoned (tombstoned_at set), NOT hard-removed.
    expect(tombstones).toEqual(['pmo-1']);
    // The deletion is surfaced (AC-CUA-070 non-silent).
    expect(surfaced).toEqual([{ pmoRecordId: 'pmo-1', externalRecordId: 'cu-1' }]);
    // The external_refs mapping is KEPT (never deleted — there is no removeMapping dep; the mapping
    // is what preserves the pmo_record_id ↔ ClickUp id link so a future re-create reconciles).
    expect(deps.recordExternalRef).not.toHaveBeenCalled();
    // tombstoneMirror touches tombstoned_at ONLY — there is no edge/milestone removal dep on the
    // engine, so task_dependencies + milestone grouping (keyed on the retained pmo_record_id) survive.
    expect(deps.tombstoneMirror).toHaveBeenCalledTimes(1);
    // A real ClickUp delete carries no timestamp at all — the watermark is intentionally NOT advanced
    // on this branch (the periodic sweep is the convergence authority for this edge).
    expect(deps.advanceWatermark).not.toHaveBeenCalled();
  });

  it('a taskDeleted for an UNMAPPED task is a faithful no-op (nothing to tombstone)', async () => {
    const { deps, tombstones, surfaced } = deletionDeps({ mappedPmoId: null });
    const outcome = await applyWebhookEvent(deletedEvent('cu-ghost'), deps);
    expect(outcome.kind).toBe('no-op');
    expect(tombstones).toHaveLength(0);
    expect(surfaced).toHaveLength(0);
  });

  it('re-delivering the SAME taskDeleted twice is idempotent (already-tombstoned re-tombstones harmlessly)', async () => {
    const { deps, tombstones } = deletionDeps({ mappedPmoId: 'pmo-1' });
    await applyWebhookEvent(deletedEvent('cu-1'), deps);
    await applyWebhookEvent(deletedEvent('cu-1'), deps);
    expect(tombstones).toEqual(['pmo-1', 'pmo-1']);
  });
});
