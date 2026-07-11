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
 * Plus the faithful no-op edges: a delete for an unmapped task (nothing to tombstone) and a stale
 * delete (older than the stored source-mod) are both no-ops.
 */
import { describe, it, expect, vi } from 'vitest';
import { applyWebhookEvent, type WebhookApplyDeps } from './webhookApply.ts';
import type { ClickUpWebhookPayload } from './types.ts';
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
    recordExternalRef: vi.fn(async () => {}),
    surfaceDeletion: vi.fn(async (pmoRecordId, externalRecordId) => {
      surfaced.push({ pmoRecordId, externalRecordId });
    }),
    readWatermark: vi.fn(async () => config.watermark ?? null),
    advanceWatermark: vi.fn(async () => {}),
  };
  return { deps, tombstones, surfaced, refsDeleted };
}

describe('AC-CUA-070 a taskDeleted tombstones the mirror and preserves the enhancement graph (non-silent)', () => {
  it('tombstones the mirrored row (NOT removed), keeps the mapping, preserves edges/milestone, surfaces the deletion', async () => {
    const { deps, tombstones, surfaced } = deletionDeps({ mappedPmoId: 'pmo-1', storedSourceModMs: 1000 });
    const event: ClickUpWebhookPayload = {
      event: 'taskDeleted',
      task_id: 'cu-1',
      date_updated: '2000',
    };

    const outcome = await applyWebhookEvent(event, deps);

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
    // Watermark still advanced monotonically (orthogonal to the per-row apply).
    expect(deps.advanceWatermark).toHaveBeenCalledWith('2000');
  });

  it('a taskDeleted for an UNMAPPED task is a faithful no-op (nothing to tombstone)', async () => {
    const { deps, tombstones, surfaced } = deletionDeps({ mappedPmoId: null });
    const outcome = await applyWebhookEvent(
      { event: 'taskDeleted', task_id: 'cu-ghost', date_updated: '3000' },
      deps,
    );
    expect(outcome.kind).toBe('no-op');
    expect(tombstones).toHaveLength(0);
    expect(surfaced).toHaveLength(0);
  });

  it('a STALE taskDeleted (older than the stored source-mod) is a per-row no-op (FR-CUA-049)', async () => {
    const { deps, tombstones, surfaced } = deletionDeps({ mappedPmoId: 'pmo-1', storedSourceModMs: 5000 });
    const outcome = await applyWebhookEvent(
      { event: 'taskDeleted', task_id: 'cu-1', date_updated: '1000' },
      deps,
    );
    expect(outcome.kind).toBe('no-op');
    expect(tombstones).toHaveLength(0);
    expect(surfaced).toHaveLength(0);
  });
});
