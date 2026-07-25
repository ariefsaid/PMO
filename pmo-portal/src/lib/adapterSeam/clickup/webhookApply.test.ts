/**
 * AC-CUA-040/041/042/045/071 — the pure webhook apply engine (FR-CUA-042/043/044/049/062).
 *
 * 2026-07-20 (OD-INT-11 fix): the real ClickUp webhook envelope carries NO task body and NO
 * `date_updated` (live-verified, 7/7 real deliveries) — `applyWebhookEvent` now takes the WORKER's
 * re-GET'd task (`task: ClickUpTask | null`) instead of reading either off the payload. The signature
 * gate is the edge fn's job (AC-CUA-040 owned by signature.test.ts). Here we exercise the apply-side
 * invariants:
 *   - AC-CUA-041 idempotent apply under re-delivery (read-model converges; watermark monotonic).
 *   - AC-CUA-045 per-row source-mod guard (older ⇒ no-op; `>=` ⇒ applies; independent of watermark).
 *   - AC-CUA-042 a webhook for an UNMAPPED task adopts it (mint mirror + mapping), never drops.
 *   - AC-CUA-071 a taskUpdated updates native fields only; the enhancement graph (keyed on the
 *     retained pmo_record_id) stays intact — updateMirror receives ONLY native fields.
 *   - archived: a `history_items[].field === 'archived'` transition sets/clears `archived_at` via
 *     `archiveMirror` — never through `tombstoneMirror` (an archive is never a delete).
 */
import { describe, it, expect, vi } from 'vitest';
import type { PmoRecord } from '../contract.ts';
import { applyWebhookEvent, type WebhookApplyDeps, type WebhookWorkerEvent } from './webhookApply.ts';
import type { ClickUpHistoryItem, ClickUpTask } from './types.ts';
import type { ClickUpStatusMap } from './statusMap.ts';
import type { ClickUpMemberMap } from './memberMap.ts';
import type { ExternalRefSeed } from './onboarding.ts';

const statusMap: ClickUpStatusMap = {
  pmoToClickUp: { 'To Do': 'to do', Done: 'complete' },
  clickUpToPmo: { 'to do': 'To Do', complete: 'Done' },
  defaultPmoStatus: 'To Do',
};
const memberMap: ClickUpMemberMap = { pmoToClickUp: { 'pmo-a': 101 }, clickUpToPmo: { 101: 'pmo-a' } };

/** A full ClickUp task body — as the WORKER's re-GET (`GET /task/{id}`) returns it. */
function clickUpTask(overrides: Partial<{ id: string; name: string; status: string; assignee: number | null; date_updated: string; archived: boolean }> = {}): ClickUpTask {
  const assignee = overrides.assignee ?? null;
  return {
    id: overrides.id ?? 'cu-1',
    name: overrides.name ?? 'Mirrored task',
    status: { status: overrides.status ?? 'to do' },
    assignees: assignee !== null ? [{ id: assignee }] : [],
    start_date: null,
    due_date: null,
    date_updated: overrides.date_updated ?? '1000',
    archived: overrides.archived,
  };
}

function workerEvent(
  event: WebhookWorkerEvent['event'],
  overrides: Partial<WebhookWorkerEvent> = {},
): WebhookWorkerEvent {
  return {
    event,
    taskId: overrides.taskId ?? 'cu-1',
    historyItems: overrides.historyItems ?? [],
    task: 'task' in overrides ? overrides.task! : clickUpTask(),
  };
}

/** A recording dep bag. `config` tunes the resolved mapping + stored source-mod + watermark. */
function makeDeps(config: {
  mappedPmoId?: string | null;
  storedSourceModMs?: number | null;
  watermark?: string | null;
  /** The mirror's CURRENT PMO status (OD-INT-10, round 3 stickiness) — absent = no `readMirrorStatus`
   *  dep at all (byte-for-byte back-compat with every test that predates this parameter). */
  currentMirrorStatus?: string;
  statusMap?: ClickUpStatusMap;
} = {}): WebhookApplyDeps & {
  updates: Array<{ pmoRecordId: string; canonical: PmoRecord; sourceUpdatedAtMs: number }>;
  mints: Array<{ canonical: PmoRecord; sourceUpdatedAtMs: number }>;
  refs: ExternalRefSeed[];
  advancedTo: string[];
  tombstones: string[];
  archives: Array<{ pmoRecordId: string; archivedAtIso: string | null }>;
} {
  const updates: Array<{ pmoRecordId: string; canonical: PmoRecord; sourceUpdatedAtMs: number }> = [];
  const mints: Array<{ canonical: PmoRecord; sourceUpdatedAtMs: number }> = [];
  const refs: ExternalRefSeed[] = [];
  const advancedTo: string[] = [];
  const tombstones: string[] = [];
  const archives: Array<{ pmoRecordId: string; archivedAtIso: string | null }> = [];
  const deps: WebhookApplyDeps = {
    statusMap: config.statusMap ?? statusMap,
    memberMap,
    resolvePmoRecordId: vi.fn(async () => config.mappedPmoId ?? null),
    readMirrorSourceMod: vi.fn(async () => config.storedSourceModMs ?? null),
    ...(config.currentMirrorStatus !== undefined
      ? { readMirrorStatus: vi.fn(async () => config.currentMirrorStatus ?? null) }
      : {}),
    updateMirror: vi.fn(async (pmoRecordId, canonical, sourceUpdatedAtMs) => {
      updates.push({ pmoRecordId, canonical, sourceUpdatedAtMs });
    }),
    mintMirror: vi.fn(async (canonical, sourceUpdatedAtMs) => {
      const id = `pmo-minted-${mints.length + 1}`;
      mints.push({ canonical, sourceUpdatedAtMs });
      return id;
    }),
    tombstoneMirror: vi.fn(async (pmoRecordId) => {
      tombstones.push(pmoRecordId);
    }),
    archiveMirror: vi.fn(async (pmoRecordId, archivedAtIso) => {
      archives.push({ pmoRecordId, archivedAtIso });
    }),
    recordExternalRef: vi.fn(async (mapping) => {
      refs.push(mapping);
    }),
    surfaceDeletion: vi.fn(async () => {}),
    readWatermark: vi.fn(async () => config.watermark ?? null),
    advanceWatermark: vi.fn(async (cursor) => {
      advancedTo.push(cursor);
    }),
  };
  return { ...deps, updates, mints, refs, advancedTo, tombstones, archives };
}

describe('AC-CUA-041 idempotent apply under re-delivery', () => {
  it('a taskUpdated applied twice converges to one read-model state and the watermark advances monotonically', async () => {
    const deps = makeDeps({ mappedPmoId: 'pmo-1', storedSourceModMs: null, watermark: null });
    const event = workerEvent('taskUpdated', { taskId: 'cu-1', task: clickUpTask({ id: 'cu-1', name: 'v1', date_updated: '5000' }) });

    const first = await applyWebhookEvent(event, deps);
    const second = await applyWebhookEvent(event, deps);

    expect(first.kind).toBe('upserted');
    expect(second.kind).toBe('upserted');
    // Converges to ONE state: updateMirror was called twice (idempotent re-apply of the same state)
    // with the SAME pmoRecordId + sourceUpdatedAtMs — never a duplicate mint.
    expect(deps.updates).toHaveLength(2);
    expect(deps.updates[0]).toEqual(deps.updates[1]);
    expect(deps.updates[0].pmoRecordId).toBe('pmo-1');
    expect(deps.updates[0].sourceUpdatedAtMs).toBe(5000);
    expect(deps.mints).toHaveLength(0);
    // Watermark advanced monotonically to 5000 both times (never rewound).
    expect(deps.advancedTo).toEqual(['5000', '5000']);
  });

  it('a re-delivered event does not mint a second mirror (no duplicate mapping)', async () => {
    const deps = makeDeps({ mappedPmoId: 'pmo-1', storedSourceModMs: null });
    const event = workerEvent('taskUpdated', { task: clickUpTask({ date_updated: '300' }) });
    await applyWebhookEvent(event, deps);
    await applyWebhookEvent(event, deps);
    expect(deps.refs).toHaveLength(0); // mapping already existed; never re-recorded on update
    expect(deps.mints).toHaveLength(0);
  });
});

describe('AC-CUA-045 per-row source-modification guard (independent of the org watermark)', () => {
  it('an OLDER change (T1 < stored T2) is a no-op: row untouched, watermark STILL advances', async () => {
    const deps = makeDeps({ mappedPmoId: 'pmo-1', storedSourceModMs: 2000, watermark: '2000' });
    const older = workerEvent('taskUpdated', { task: clickUpTask({ name: 'stale', date_updated: '1000' }) });

    const outcome = await applyWebhookEvent(older, deps);

    expect(outcome.kind).toBe('no-op');
    expect(deps.updates).toHaveLength(0); // row untouched — fresher T2 state preserved
    expect(deps.mints).toHaveLength(0);
    // Watermark is ORTHOGONAL to the per-row guard (FR-CUA-049): it advances anyway, monotonically
    // (max(2000, 1000) = 2000 — never rewound by the stale event).
    expect(deps.advancedTo).toEqual(['2000']);
  });

  it('a change with timestamp >= stored applies (inclusive — re-delivery/boundary re-applies)', async () => {
    const deps = makeDeps({ mappedPmoId: 'pmo-1', storedSourceModMs: 2000 });
    const equal = workerEvent('taskUpdated', { task: clickUpTask({ name: 'equal', date_updated: '2000' }) });
    const newer = workerEvent('taskUpdated', { task: clickUpTask({ name: 'newer', date_updated: '3000' }) });

    await applyWebhookEvent(equal, deps);
    await applyWebhookEvent(newer, deps);

    expect(deps.updates.map((u) => u.canonical.name)).toEqual(['equal', 'newer']);
    expect(deps.updates.every((u) => u.sourceUpdatedAtMs >= 2000)).toBe(true);
  });
});

describe('AC-CUA-042 a webhook for an UNMAPPED task adopts it (pull-adopt, not drop)', () => {
  it('a taskCreated with no external_refs mapping mints a new mirror + mapping', async () => {
    const deps = makeDeps({ mappedPmoId: null, storedSourceModMs: null });
    const event = workerEvent('taskCreated', { taskId: 'cu-new', task: clickUpTask({ id: 'cu-new', name: 'native', date_updated: '7000' }) });

    const outcome = await applyWebhookEvent(event, deps);

    expect(outcome.kind).toBe('upserted');
    if (outcome.kind === 'upserted') {
      expect(outcome.adopted).toBe(true);
      expect(outcome.pmoRecordId).toBe('pmo-minted-1');
    }
    expect(deps.mints).toHaveLength(1);
    expect(deps.mints[0].sourceUpdatedAtMs).toBe(7000);
    expect(deps.refs).toHaveLength(1);
    expect(deps.refs[0]).toEqual({
      pmoRecordId: 'pmo-minted-1',
      externalTier: 'clickup',
      externalRecordId: 'cu-new',
      domain: 'tasks',
    });
    expect(deps.advancedTo).toEqual(['7000']);
  });
});

describe('AC-CUA-071 a taskUpdated updates native fields and leaves the enhancement graph intact', () => {
  it('updateMirror receives ONLY native fields (id/name/status/assignee/dates); milestone_id/dependencies are never on the canonical', async () => {
    const deps = makeDeps({ mappedPmoId: 'pmo-1' });
    const event = workerEvent('taskUpdated', {
      task: clickUpTask({ id: 'cu-1', name: 'renamed', status: 'complete', assignee: 101, date_updated: '9000' }),
    });

    await applyWebhookEvent(event, deps);

    expect(deps.updates).toHaveLength(1);
    const canonical = deps.updates[0].canonical;
    // Native mapping-set fields only (FR-CUA-010) — no enhancement vocabulary ever crosses.
    expect(canonical.id).toBe('pmo-1'); // pinned to the retained pmo_record_id (enhancement graph key)
    expect(canonical.name).toBe('renamed');
    expect(canonical.status).toBe('Done'); // mapped via the status map
    expect(canonical.assignee_id).toBe('pmo-a'); // mapped via the member map
    expect(Object.keys(canonical).sort()).toEqual(
      // OD-INT-9: description + priority are NATIVE ClickUp-owned fields (migration 0140), so they
      // join the native mapping set here — unconditionally present (null when unset on ClickUp).
      // The assertion's intent is unchanged: NO enhancement vocabulary (milestone_id, dependencies)
      // ever crosses the mapping boundary.
      ['assignee_id', 'completed_at', 'description', 'end_date', 'id', 'name', 'priority', 'start_date', 'status'].sort(),
    );
    // The enhancement graph (task_dependencies / milestone grouping) is keyed on pmo_record_id, which
    // is UNCHANGED — so the edges/grouping survive the native-field update byte-for-byte.
    expect(deps.updates[0].pmoRecordId).toBe('pmo-1');
  });
});

describe('archive/unarchive via history_items (never a tombstone)', () => {
  const archivedItem = (after: 'true' | 'false', date = '9999'): ClickUpHistoryItem => ({
    field: 'archived',
    before: after === 'true' ? 'false' : 'true',
    after,
    date,
  });

  it('a taskUpdated with field:"archived" after:"true" sets archived_at via archiveMirror, NOT tombstoneMirror', async () => {
    const deps = makeDeps({ mappedPmoId: 'pmo-1' });
    const event = workerEvent('taskUpdated', {
      task: clickUpTask({ id: 'cu-1', date_updated: '9999' }),
      historyItems: [archivedItem('true', '9999')],
    });

    const outcome = await applyWebhookEvent(event, deps);

    expect(outcome.kind).toBe('upserted');
    expect(deps.tombstones).toHaveLength(0);
    expect(deps.archives).toEqual([{ pmoRecordId: 'pmo-1', archivedAtIso: new Date(9999).toISOString() }]);
    // The native fields ALSO synced (full current state), same as any other update.
    expect(deps.updates).toHaveLength(1);
  });

  it('a taskUpdated with field:"archived" after:"false" UN-archives (archivedAtIso: null)', async () => {
    const deps = makeDeps({ mappedPmoId: 'pmo-1' });
    const event = workerEvent('taskUpdated', {
      task: clickUpTask({ id: 'cu-1', date_updated: '5000' }),
      historyItems: [archivedItem('false', '5000')],
    });

    await applyWebhookEvent(event, deps);

    expect(deps.archives).toEqual([{ pmoRecordId: 'pmo-1', archivedAtIso: null }]);
    expect(deps.tombstones).toHaveLength(0);
  });

  it('a taskUpdated with NO archived history item never calls archiveMirror', async () => {
    const deps = makeDeps({ mappedPmoId: 'pmo-1' });
    const event = workerEvent('taskUpdated', { task: clickUpTask({ id: 'cu-1', date_updated: '1000' }), historyItems: [{ field: 'name' }] });
    await applyWebhookEvent(event, deps);
    expect(deps.archives).toHaveLength(0);
  });

  it('a STALE archive event (guard rejects it) never calls archiveMirror either', async () => {
    const deps = makeDeps({ mappedPmoId: 'pmo-1', storedSourceModMs: 5000 });
    const event = workerEvent('taskUpdated', {
      task: clickUpTask({ id: 'cu-1', date_updated: '1000' }),
      historyItems: [archivedItem('true', '1000')],
    });
    const outcome = await applyWebhookEvent(event, deps);
    expect(outcome.kind).toBe('no-op');
    expect(deps.archives).toHaveLength(0);
  });
});

describe('a re-GET 404 (task === null on a non-delete verb) collapses to the same tombstone-if-mapped path', () => {
  it('tombstones a mapped task whose re-GET 404d', async () => {
    const deps = makeDeps({ mappedPmoId: 'pmo-1' });
    const event = workerEvent('taskUpdated', { task: null });
    const outcome = await applyWebhookEvent(event, deps);
    expect(outcome).toEqual({ kind: 'tombstoned', pmoRecordId: 'pmo-1' });
    expect(deps.tombstones).toEqual(['pmo-1']);
  });

  it('is a faithful no-op for an unmapped task whose re-GET 404d', async () => {
    const deps = makeDeps({ mappedPmoId: null });
    const event = workerEvent('taskUpdated', { task: null });
    const outcome = await applyWebhookEvent(event, deps);
    expect(outcome.kind).toBe('no-op');
    expect(deps.tombstones).toHaveLength(0);
  });
});

// ── OD-INT-10 round 3 × OD-INT-11: pmo-only status stickiness, re-expressed on the WORKER event ──
// These assertions came from the round-3 status-map branch, where the engine still read a task off
// the webhook payload. That shape no longer exists (the live capture proved the payload carries no
// task), so they are restated here against WebhookWorkerEvent. The BEHAVIOUR asserted is unchanged:
// an inbound sync must never drag a PMO row out of a status the operator marked `pmo-only`.
describe('OD-INT-10 (round 3): an inbound ClickUp status change never moves a PMO row OUT of a pmo-only status', () => {
  const pmoOnlyStatusMap: ClickUpStatusMap = {
    pmoToClickUp: { 'To Do': 'to do', 'In Progress': 'in progress', Done: 'complete' },
    clickUpToPmo: { 'to do': 'To Do', 'in progress': 'In Progress', complete: 'Done' },
    defaultPmoStatus: 'To Do',
    pmoOnlyStatuses: ['Blocked'],
  };

  it('a mirror currently Blocked (pmo-only) stays Blocked when ClickUp reports "in progress"', async () => {
    const deps = makeDeps({ mappedPmoId: 'pmo-1', statusMap: pmoOnlyStatusMap, currentMirrorStatus: 'Blocked' });
    const event = workerEvent('taskUpdated', {
      task: clickUpTask({ id: 'cu-1', status: 'in progress', date_updated: '5000' }),
    });

    const outcome = await applyWebhookEvent(event, deps);

    expect(outcome.kind).toBe('upserted');
    expect(deps.updates).toHaveLength(1);
    expect(deps.updates[0].canonical.status).toBe('Blocked');
  });

  it('a mirror NOT currently pmo-only resolves its status normally off the inbound ClickUp status', async () => {
    const deps = makeDeps({ mappedPmoId: 'pmo-1', statusMap: pmoOnlyStatusMap, currentMirrorStatus: 'To Do' });
    const event = workerEvent('taskUpdated', {
      task: clickUpTask({ id: 'cu-1', status: 'in progress', date_updated: '5000' }),
    });

    await applyWebhookEvent(event, deps);

    expect(deps.updates[0].canonical.status).toBe('In Progress');
  });

  it('with no readMirrorStatus dep configured (back-compat), status resolves off the plain inbound map', async () => {
    const deps = makeDeps({ mappedPmoId: 'pmo-1', statusMap: pmoOnlyStatusMap });
    expect((deps as unknown as { readMirrorStatus?: unknown }).readMirrorStatus).toBeUndefined();
    const event = workerEvent('taskUpdated', {
      task: clickUpTask({ id: 'cu-1', status: 'in progress', date_updated: '5000' }),
    });

    await applyWebhookEvent(event, deps);

    expect(deps.updates[0].canonical.status).toBe('In Progress');
  });
});
