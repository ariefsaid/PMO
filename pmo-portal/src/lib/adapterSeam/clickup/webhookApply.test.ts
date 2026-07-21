/**
 * AC-CUA-040/041/042/045/071 — the pure webhook apply engine (FR-CUA-042/043/044/049/062).
 *
 * The pure `applyWebhookEvent` ASSUMES VERIFIED INPUT — the signature gate is the edge fn's job
 * (AC-CUA-040 signature half is owned by signature.test.ts; the ingress no-side-effect-on-bad-sig
 * wiring is asserted in the D8 edge fn). Here we exercise the apply-side invariants:
 *   - AC-CUA-041 idempotent apply under re-delivery (read-model converges; watermark monotonic).
 *   - AC-CUA-045 per-row source-mod guard (older ⇒ no-op; `>=` ⇒ applies; independent of watermark).
 *   - AC-CUA-042 a webhook for an UNMAPPED task adopts it (mint mirror + mapping), never drops.
 *   - AC-CUA-071 a taskUpdated updates native fields only; the enhancement graph (keyed on the
 *     retained pmo_record_id) stays intact — updateMirror receives ONLY native fields.
 */
import { describe, it, expect, vi } from 'vitest';
import type { PmoRecord } from '../contract.ts';
import { applyWebhookEvent, type WebhookApplyDeps } from './webhookApply.ts';
import type { ClickUpWebhookPayload } from './types.ts';
import type { ClickUpStatusMap } from './statusMap.ts';
import type { ClickUpMemberMap } from './memberMap.ts';
import type { ExternalRefSeed } from './onboarding.ts';

const statusMap: ClickUpStatusMap = {
  pmoToClickUp: { 'To Do': 'to do', Done: 'complete' },
  clickUpToPmo: { 'to do': 'To Do', complete: 'Done' },
  defaultPmoStatus: 'To Do',
};
const memberMap: ClickUpMemberMap = { pmoToClickUp: { 'pmo-a': 101 }, clickUpToPmo: { 101: 'pmo-a' } };

/** A full ClickUp task body (as carried by a taskCreated/taskUpdated webhook). */
function clickUpTask(overrides: Partial<{ id: string; name: string; status: string; assignee: number | null; date_updated: string }> = {}): {
  id: string; name: string; status: { status: string }; assignees: { id: number }[]; start_date: null; due_date: null; date_updated: string;
} {
  const assignee = overrides.assignee ?? null;
  return {
    id: overrides.id ?? 'cu-1',
    name: overrides.name ?? 'Mirrored task',
    status: { status: overrides.status ?? 'to do' },
    assignees: assignee !== null ? [{ id: assignee }] : [],
    start_date: null,
    due_date: null,
    date_updated: overrides.date_updated ?? '1000',
  };
}

function payload(event: ClickUpWebhookPayload['event'], body: Partial<ClickUpWebhookPayload>): ClickUpWebhookPayload {
  return {
    event,
    task_id: body.task_id ?? 'cu-1',
    date_updated: body.date_updated ?? '1000',
    task: body.task,
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
} {
  const updates: Array<{ pmoRecordId: string; canonical: PmoRecord; sourceUpdatedAtMs: number }> = [];
  const mints: Array<{ canonical: PmoRecord; sourceUpdatedAtMs: number }> = [];
  const refs: ExternalRefSeed[] = [];
  const advancedTo: string[] = [];
  const tombstones: string[] = [];
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
    recordExternalRef: vi.fn(async (mapping) => {
      refs.push(mapping);
    }),
    surfaceDeletion: vi.fn(async () => {}),
    readWatermark: vi.fn(async () => config.watermark ?? null),
    advanceWatermark: vi.fn(async (cursor) => {
      advancedTo.push(cursor);
    }),
  };
  return { ...deps, updates, mints, refs, advancedTo, tombstones };
}

describe('AC-CUA-041 idempotent apply under re-delivery', () => {
  it('a taskUpdated applied twice converges to one read-model state and the watermark advances monotonically', async () => {
    const deps = makeDeps({ mappedPmoId: 'pmo-1', storedSourceModMs: null, watermark: null });
    const event = payload('taskUpdated', { task_id: 'cu-1', date_updated: '5000', task: clickUpTask({ id: 'cu-1', name: 'v1' }) });

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
    const event = payload('taskUpdated', { date_updated: '300', task: clickUpTask() });
    await applyWebhookEvent(event, deps);
    await applyWebhookEvent(event, deps);
    expect(deps.refs).toHaveLength(0); // mapping already existed; never re-recorded on update
    expect(deps.mints).toHaveLength(0);
  });
});

describe('AC-CUA-045 per-row source-modification guard (independent of the org watermark)', () => {
  it('an OLDER change (T1 < stored T2) is a no-op: row untouched, watermark STILL advances', async () => {
    const deps = makeDeps({ mappedPmoId: 'pmo-1', storedSourceModMs: 2000, watermark: '2000' });
    const older = payload('taskUpdated', { date_updated: '1000', task: clickUpTask({ name: 'stale' }) });

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
    const equal = payload('taskUpdated', { date_updated: '2000', task: clickUpTask({ name: 'equal' }) });
    const newer = payload('taskUpdated', { date_updated: '3000', task: clickUpTask({ name: 'newer' }) });

    await applyWebhookEvent(equal, deps);
    await applyWebhookEvent(newer, deps);

    expect(deps.updates.map((u) => u.canonical.name)).toEqual(['equal', 'newer']);
    expect(deps.updates.every((u) => u.sourceUpdatedAtMs >= 2000)).toBe(true);
  });
});

describe('AC-CUA-042 a webhook for an UNMAPPED task adopts it (pull-adopt, not drop)', () => {
  it('a taskCreated with no external_refs mapping mints a new mirror + mapping', async () => {
    const deps = makeDeps({ mappedPmoId: null, storedSourceModMs: null });
    const event = payload('taskCreated', { task_id: 'cu-new', date_updated: '7000', task: clickUpTask({ id: 'cu-new', name: 'native' }) });

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
    const event = payload('taskUpdated', {
      date_updated: '9000',
      task: clickUpTask({ id: 'cu-1', name: 'renamed', status: 'complete', assignee: 101 }),
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
      ['assignee_id', 'completed_at', 'end_date', 'id', 'name', 'start_date', 'status'].sort(),
    );
    // The enhancement graph (task_dependencies / milestone grouping) is keyed on pmo_record_id, which
    // is UNCHANGED — so the edges/grouping survive the native-field update byte-for-byte.
    expect(deps.updates[0].pmoRecordId).toBe('pmo-1');
  });
});

describe('OD-INT-10 (round 3): an inbound ClickUp status change never moves a PMO row OUT of a pmo-only status', () => {
  const pmoOnlyStatusMap: ClickUpStatusMap = {
    pmoToClickUp: { 'To Do': 'to do', 'In Progress': 'in progress', Done: 'complete' },
    clickUpToPmo: { 'to do': 'To Do', 'in progress': 'In Progress', complete: 'Done' },
    defaultPmoStatus: 'To Do',
    pmoOnlyStatuses: ['Blocked'],
  };

  it('a mirror currently Blocked (pmo-only) stays Blocked when ClickUp reports "in progress"', async () => {
    const deps = makeDeps({
      mappedPmoId: 'pmo-1',
      statusMap: pmoOnlyStatusMap,
      currentMirrorStatus: 'Blocked',
    });
    const event = payload('taskUpdated', {
      date_updated: '5000',
      task: clickUpTask({ id: 'cu-1', status: 'in progress' }),
    });

    const outcome = await applyWebhookEvent(event, deps);

    expect(outcome.kind).toBe('upserted');
    expect(deps.updates).toHaveLength(1);
    expect(deps.updates[0].canonical.status).toBe('Blocked');
  });

  it('a mirror NOT currently pmo-only still resolves its status normally off the inbound ClickUp status', async () => {
    const deps = makeDeps({
      mappedPmoId: 'pmo-1',
      statusMap: pmoOnlyStatusMap,
      currentMirrorStatus: 'To Do',
    });
    const event = payload('taskUpdated', {
      date_updated: '5000',
      task: clickUpTask({ id: 'cu-1', status: 'in progress' }),
    });

    await applyWebhookEvent(event, deps);

    expect(deps.updates[0].canonical.status).toBe('In Progress');
  });

  it('with no readMirrorStatus dep configured (byte-for-byte back-compat), status resolves off the plain inbound map', async () => {
    const deps = makeDeps({ mappedPmoId: 'pmo-1', statusMap: pmoOnlyStatusMap });
    expect((deps as unknown as { readMirrorStatus?: unknown }).readMirrorStatus).toBeUndefined();
    const event = payload('taskUpdated', {
      date_updated: '5000',
      task: clickUpTask({ id: 'cu-1', status: 'in progress' }),
    });

    await applyWebhookEvent(event, deps);

    expect(deps.updates[0].canonical.status).toBe('In Progress');
  });
});

describe('OD-INT-10 (round 3): an explicitly recorded status collapse never downgrades the more specific PMO status inbound', () => {
  // Blocked and In Progress both explicitly resolve to the SAME ClickUp status ('in progress') — the
  // hand-authored case rule 3 allows (never produced silently by buildClickUpStatusMap).
  const collapsedStatusMap: ClickUpStatusMap = {
    pmoToClickUp: { 'To Do': 'to do', 'In Progress': 'in progress', Blocked: 'in progress', Done: 'complete' },
    clickUpToPmo: { 'to do': 'To Do', 'in progress': 'In Progress', complete: 'Done' },
    defaultPmoStatus: 'To Do',
  };

  it('a mirror currently Blocked stays Blocked when ClickUp reports the SAME shared "in progress" target', async () => {
    const deps = makeDeps({
      mappedPmoId: 'pmo-1',
      statusMap: collapsedStatusMap,
      currentMirrorStatus: 'Blocked',
    });
    const event = payload('taskUpdated', {
      date_updated: '5000',
      task: clickUpTask({ id: 'cu-1', status: 'in progress' }),
    });

    await applyWebhookEvent(event, deps);

    expect(deps.updates[0].canonical.status).toBe('Blocked');
  });

  it('a mirror currently Blocked still transitions when ClickUp reports a genuinely different status', async () => {
    const deps = makeDeps({
      mappedPmoId: 'pmo-1',
      statusMap: collapsedStatusMap,
      currentMirrorStatus: 'Blocked',
    });
    const event = payload('taskUpdated', {
      date_updated: '5000',
      task: clickUpTask({ id: 'cu-1', status: 'complete' }),
    });

    await applyWebhookEvent(event, deps);

    expect(deps.updates[0].canonical.status).toBe('Done');
  });
});
