/**
 * AC-CUA-096 [Vitest, mocked] — OD-INT-9 parent<->parent_task_id reconciliation.
 *
 * The self-healing case that makes an OUT-OF-ORDER sweep page safe: a ClickUp subtask whose parent
 * is not yet mirrored arrives FIRST (so the inbound `parent` cannot be resolved to a PMO task id yet,
 * and `parent_task_id` is left null on the first apply); the parent is then mirrored by a later page;
 * on a SECOND apply of the SAME child, the parent now resolves and `parent_task_id` IS set.
 *
 * Reuses the mocked-deps style established by webhookApply.test.ts / mapping.test.ts: every DB edge is
 * an injected `vi.fn`, so no live token is needed and the apply engine's pure paths are exercised
 * directly. `applyWebhookEvent` is the shared webhook+sweep apply entry point (FR-CUA-049 "any apply").
 */
import { describe, it, expect, vi } from 'vitest';
import type { PmoRecord } from '../contract.ts';
import { applyWebhookEvent, type WebhookApplyDeps, type WebhookWorkerEvent } from './webhookApply.ts';
import type { ClickUpTask } from './types.ts';
import type { ClickUpStatusMap } from './statusMap.ts';
import type { ClickUpMemberMap } from './memberMap.ts';

const statusMap: ClickUpStatusMap = {
  pmoToClickUp: { 'To Do': 'to do', Done: 'complete' },
  clickUpToPmo: { 'to do': 'To Do', complete: 'Done' },
  defaultPmoStatus: 'To Do',
};
const memberMap: ClickUpMemberMap = { pmoToClickUp: { 'pmo-a': 101 }, clickUpToPmo: { 101: 'pmo-a' } };

/** A recording dep bag — mirrors webhookApply.test.ts's makeDeps, trimmed to the fields this path
 *  exercises (updateMirror captures the canonical records the assertions inspect). */
function makeDeps(mappedPmoId: string): WebhookApplyDeps & {
  updates: Array<{ pmoRecordId: string; canonical: PmoRecord; sourceUpdatedAtMs: number }>;
} {
  const updates: Array<{ pmoRecordId: string; canonical: PmoRecord; sourceUpdatedAtMs: number }> = [];
  const deps: WebhookApplyDeps = {
    statusMap,
    memberMap,
    resolvePmoRecordId: vi.fn(async () => mappedPmoId),
    readMirrorSourceMod: vi.fn(async () => null), // never stale — re-apply always goes through
    updateMirror: vi.fn(async (pmoRecordId, canonical, sourceUpdatedAtMs) => {
      updates.push({ pmoRecordId, canonical, sourceUpdatedAtMs });
    }),
    mintMirror: vi.fn(async () => mappedPmoId),
    tombstoneMirror: vi.fn(async () => {}),
    archiveMirror: vi.fn(async () => {}),
    recordExternalRef: vi.fn(async () => {}),
    readWatermark: vi.fn(async () => null),
    advanceWatermark: vi.fn(async () => {}),
  };
  return { ...deps, updates };
}

/** A ClickUp subtask whose `parent` points at a task that may or may not be mirrored yet. */
function childTask(dateUpdated: string, parent: string): ClickUpTask {
  return {
    id: 'cu-child',
    name: 'Subtask whose parent lands later',
    status: { status: 'to do' },
    assignees: [],
    start_date: null,
    due_date: null,
    date_updated: dateUpdated,
    parent,
  };
}

describe('AC-CUA-096 OD-INT-9 parent reconciliation — an out-of-order sweep page is self-healing', () => {
  it('a subtask applied BEFORE its parent is mirrored lands flat (parent_task_id null); a SECOND apply of the same child, after the parent exists, sets parent_task_id', async () => {
    // `resolveParentPmoId` returns null on the FIRST call (parent 'cu-parent' not yet mirrored) and
    // the resolved PMO id on the SECOND call (a later sweep page mirrored the parent in between).
    const resolveParentPmoId = vi
      .fn<(parentId: string) => Promise<string | null>>()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce('pmo-parent');

    const deps = makeDeps('pmo-child');
    // The SAME event, re-applied — exactly what an out-of-order sweep (or a webhook re-delivery) does.
    const event: WebhookWorkerEvent = {
      event: 'taskUpdated',
      taskId: 'cu-child',
      historyItems: [],
      task: childTask('5000', 'cu-parent'),
    };

    // ── First apply: the parent is NOT yet mirrored → the child flows through as a FLAT task. ──
    const first = await applyWebhookEvent(event, { ...deps, resolveParentPmoId });
    expect(first.kind).toBe('upserted');
    expect(deps.updates).toHaveLength(1);
    // parent_task_id is explicitly null (the row is NOT dropped — it is created, just unlinked yet).
    expect(deps.updates[0].canonical.parent_task_id).toBeNull();

    // ── Second apply of the SAME child: the parent now resolves → the link IS set. ──
    const second = await applyWebhookEvent(event, { ...deps, resolveParentPmoId });
    expect(second.kind).toBe('upserted');
    expect(deps.updates).toHaveLength(2);
    expect(deps.updates[1].canonical.parent_task_id).toBe('pmo-parent');

    // The resolver was consulted BOTH times (idempotent re-apply re-attempts resolution — the
    // mechanism that makes a later sweep page converge without a manual re-ordering pass).
    expect(resolveParentPmoId).toHaveBeenCalledTimes(2);
    expect(resolveParentPmoId).toHaveBeenNthCalledWith(1, 'cu-parent');
    expect(resolveParentPmoId).toHaveBeenNthCalledWith(2, 'cu-parent');

    // Both applies targeted the SAME retained PMO id (the enhancement graph key is stable across the
    // reconciliation — only parent_task_id changed, nothing was re-minted).
    expect(deps.updates[0].pmoRecordId).toBe('pmo-child');
    expect(deps.updates[1].pmoRecordId).toBe('pmo-child');
    expect(deps.mintMirror).not.toHaveBeenCalled();
  });
});
