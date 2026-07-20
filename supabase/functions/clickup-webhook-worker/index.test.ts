// OD-INT-11 [Deno unit] — clickup-webhook-worker/index.ts: `processInboxRow` (re-GET -> resolve
// binding -> apply) and `runWorkerBatch` (claim -> process -> mark-done/failed). Proves:
//   - a mapped taskUpdated re-GETs, applies, and the mirror is updated (via the injected apply deps);
//   - the binding is resolved from the re-GET'd task.list.id, NEVER a payload field (there is none) —
//     an UNMAPPED task whose List IS bound gets ADOPTED (the tier that was unreachable dead code
//     before this fix);
//   - a taskDeleted tombstones WITHOUT any re-GET call (getTask is never invoked for that verb);
//   - a re-GET 404 (task no longer exists) collapses to the same tombstone-if-mapped path;
//   - runWorkerBatch marks a row done on success, failed (with the detail) on a thrown error, and a
//     23505 concurrent-adopt is treated as recoverable (done, not failed) — one row's failure never
//     blocks the rest of the batch.
//
// Deno-native test (plain assertions). `globalThis.fetch` is never touched here — `getTask` is an
// injected mock (matches the codebase's existing `fetchImpl`-injection convention for the ClickUp
// client, `client.ts`'s `ClickUpClientDeps`), not a monkeypatch.
//
// Verify: cd supabase/functions/clickup-webhook-worker && deno test index.test.ts

(Deno as unknown as { serve: (...a: unknown[]) => unknown }).serve = () => ({ finished: Promise.resolve() });
const { processInboxRow, runWorkerBatch } = await import('./index.ts');
type ProcessRowDeps = Parameters<typeof processInboxRow>[1];
type WorkerBatchDeps = Parameters<typeof runWorkerBatch>[0];
type InboxRow = Parameters<typeof processInboxRow>[0];
type ResolvedBinding = Awaited<ReturnType<ProcessRowDeps['resolveBinding']>>;

import type { WebhookApplyDeps } from '../../../pmo-portal/src/lib/adapterSeam/clickup/webhookApply.ts';
import type { ClickUpStatusMap } from '../../../pmo-portal/src/lib/adapterSeam/clickup/statusMap.ts';
import type { ClickUpMemberMap } from '../../../pmo-portal/src/lib/adapterSeam/clickup/memberMap.ts';
import type { ClickUpTask } from '../../../pmo-portal/src/lib/adapterSeam/clickup/types.ts';

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}

const statusMap: ClickUpStatusMap = {
  pmoToClickUp: { 'To Do': 'to do', Done: 'complete' },
  clickUpToPmo: { 'to do': 'To Do', complete: 'Done' },
  defaultPmoStatus: 'To Do',
};
const memberMap: ClickUpMemberMap = { pmoToClickUp: {}, clickUpToPmo: {} };

function task(overrides: Partial<ClickUpTask> = {}): ClickUpTask {
  return {
    id: overrides.id ?? 'cu-1',
    name: overrides.name ?? 'Mirrored task',
    status: overrides.status ?? { status: 'to do' },
    assignees: overrides.assignees ?? [],
    start_date: null,
    due_date: null,
    date_updated: overrides.date_updated ?? '5000',
    list: overrides.list,
    archived: overrides.archived,
  };
}

/** A recording WebhookApplyDeps bag (mirrors webhookApply.test.ts's makeDeps, minimally). */
function makeApplyDeps(config: { mappedPmoId?: string | null; storedSourceModMs?: number | null } = {}) {
  const updates: unknown[] = [];
  const mints: unknown[] = [];
  const tombstones: string[] = [];
  const deps: WebhookApplyDeps = {
    statusMap,
    memberMap,
    resolvePmoRecordId: async () => config.mappedPmoId ?? null,
    readMirrorSourceMod: async () => config.storedSourceModMs ?? null,
    updateMirror: async (pmoRecordId, canonical, sourceUpdatedAtMs) => {
      updates.push({ pmoRecordId, canonical, sourceUpdatedAtMs });
    },
    mintMirror: async (canonical, sourceUpdatedAtMs) => {
      const id = `pmo-minted-${mints.length + 1}`;
      mints.push({ canonical, sourceUpdatedAtMs });
      return id;
    },
    tombstoneMirror: async (pmoRecordId) => {
      tombstones.push(pmoRecordId);
    },
    archiveMirror: async () => {},
    recordExternalRef: async () => {},
    readWatermark: async () => null,
    advanceWatermark: async () => {},
  };
  return { deps, updates, mints, tombstones };
}

function row(overrides: Partial<InboxRow> = {}): InboxRow {
  return {
    id: overrides.id ?? 'row-1',
    event: overrides.event ?? 'taskUpdated',
    task_id: overrides.task_id ?? 'cu-1',
    history_items: overrides.history_items ?? [],
  };
}

Deno.test('OD-INT-11: a MAPPED taskUpdated re-GETs, applies, and the mirror is updated', async () => {
  const applyDeps = makeApplyDeps({ mappedPmoId: 'pmo-1' });
  let getTaskCalls = 0;
  const binding: ResolvedBinding = { orgId: 'org-1', projectId: 'proj-1', statusMap, memberMap };
  const deps: ProcessRowDeps = {
    getTask: async (taskId) => {
      getTaskCalls += 1;
      assert(taskId === 'cu-1', 'getTask must be called with the row task_id');
      return task({ id: 'cu-1', date_updated: '9000' });
    },
    resolveBinding: async () => binding,
    buildApplyDeps: () => applyDeps.deps,
  };

  const outcome = await processInboxRow(row(), deps);

  assert(getTaskCalls === 1, 'getTask must be called exactly once for a taskUpdated');
  assert(outcome.kind === 'upserted', `expected upserted, got ${outcome.kind}`);
  assert(applyDeps.updates.length === 1, 'the mirror must be updated');
});

Deno.test('OD-INT-11: binding is resolved from the re-GETd task.list.id — an UNMAPPED task whose List IS bound gets ADOPTED', async () => {
  const applyDeps = makeApplyDeps({ mappedPmoId: null }); // unmapped
  let resolvedListId: string | null | undefined;
  const binding: ResolvedBinding = { orgId: 'org-1', projectId: 'proj-1', statusMap, memberMap };
  const deps: ProcessRowDeps = {
    getTask: async () => task({ id: 'cu-new', date_updated: '9000', list: { id: 'list-9' } }),
    resolveBinding: async (taskId, listId) => {
      resolvedListId = listId;
      assert(taskId === 'cu-new', 'resolveBinding must receive the task id');
      return listId === 'list-9' ? binding : null;
    },
    buildApplyDeps: () => applyDeps.deps,
  };

  const outcome = await processInboxRow(row({ task_id: 'cu-new', event: 'taskCreated' }), deps);

  assert(resolvedListId === 'list-9', 'resolveBinding must be called with the RE-GETd task.list.id, never a payload field');
  assert(outcome.kind === 'upserted', `expected upserted, got ${outcome.kind}`);
  if (outcome.kind === 'upserted') assert(outcome.adopted === true, 'the unmapped task must be ADOPTED (the dead-before-this-fix path)');
  assert(applyDeps.mints.length === 1, 'a mirror must be minted for the adopted task');
});

Deno.test('OD-INT-11: a taskDeleted tombstones WITHOUT any re-GET call', async () => {
  const applyDeps = makeApplyDeps({ mappedPmoId: 'pmo-1' });
  let getTaskCalls = 0;
  const binding: ResolvedBinding = { orgId: 'org-1', projectId: 'proj-1', statusMap, memberMap };
  const deps: ProcessRowDeps = {
    getTask: async () => {
      getTaskCalls += 1;
      throw new Error('getTask must NEVER be called for a taskDeleted — there is nothing to re-GET');
    },
    resolveBinding: async () => binding,
    buildApplyDeps: () => applyDeps.deps,
  };

  const outcome = await processInboxRow(row({ event: 'taskDeleted' }), deps);

  assert(getTaskCalls === 0, 'getTask must not be invoked for taskDeleted');
  assert(outcome.kind === 'tombstoned', `expected tombstoned, got ${outcome.kind}`);
  assert(applyDeps.tombstones.length === 1, 'the mirror must be tombstoned');
});

Deno.test('OD-INT-11: a re-GET 404 (task no longer exists) collapses to the same tombstone-if-mapped path', async () => {
  const applyDeps = makeApplyDeps({ mappedPmoId: 'pmo-1' });
  const binding: ResolvedBinding = { orgId: 'org-1', projectId: 'proj-1', statusMap, memberMap };
  const deps: ProcessRowDeps = {
    getTask: async () => null, // 404
    resolveBinding: async (_taskId, listId) => {
      assert(listId === null, 'a re-GET-404 has no list.id — must resolve via the mapped path only');
      return binding;
    },
    buildApplyDeps: () => applyDeps.deps,
  };

  const outcome = await processInboxRow(row({ event: 'taskUpdated' }), deps);

  assert(outcome.kind === 'tombstoned', `expected tombstoned on a 404, got ${outcome.kind}`);
  assert(applyDeps.tombstones.length === 1, 'expected exactly one tombstone');
});

Deno.test('OD-INT-11: an unresolvable binding is a faithful ack-and-skip (no-op) — the sweep is the safety net', async () => {
  const deps: ProcessRowDeps = {
    getTask: async () => task({ list: { id: 'list-unbound' } }),
    resolveBinding: async () => null,
    buildApplyDeps: () => {
      throw new Error('buildApplyDeps must not be called when no binding resolves');
    },
  };
  const outcome = await processInboxRow(row(), deps);
  assert(outcome.kind === 'no-op', `expected no-op, got ${outcome.kind}`);
});

// ── runWorkerBatch — claim/process/mark bookkeeping. ────────────────────────────────────────────

function batchDeps(rows: InboxRow[], processRow: WorkerBatchDeps['processRow']): WorkerBatchDeps & {
  done: string[];
  failed: Array<{ id: string; error: string }>;
} {
  const done: string[] = [];
  const failed: Array<{ id: string; error: string }> = [];
  return {
    claimPending: async () => rows,
    markDone: async (id) => {
      done.push(id);
    },
    markFailed: async (id, error) => {
      failed.push({ id, error });
    },
    processRow,
    done,
    failed,
  };
}

Deno.test('runWorkerBatch: a successful row is marked done', async () => {
  const d = batchDeps([row({ id: 'r1' })], async () => ({ kind: 'upserted', pmoRecordId: 'pmo-1', adopted: false }));
  const result = await runWorkerBatch(d);
  assert(result.processed === 1 && result.failed === 0, `expected 1 processed / 0 failed, got ${JSON.stringify(result)}`);
  assert(d.done.includes('r1'), 'row r1 must be marked done');
});

Deno.test('runWorkerBatch: a thrown error marks the row failed WITHOUT aborting the rest of the batch', async () => {
  const d = batchDeps(
    [row({ id: 'r1' }), row({ id: 'r2' })],
    async (r) => {
      if (r.id === 'r1') throw new Error('boom');
      return { kind: 'upserted', pmoRecordId: 'pmo-2', adopted: false };
    },
  );
  const result = await runWorkerBatch(d);
  assert(result.processed === 1 && result.failed === 1, `expected 1/1, got ${JSON.stringify(result)}`);
  assert(d.failed.some((f) => f.id === 'r1' && f.error.includes('boom')), 'r1 must be marked failed with the detail');
  assert(d.done.includes('r2'), 'r2 must still be processed and marked done — one failure does not block the batch');
});

Deno.test('runWorkerBatch: a 23505 concurrent-adopt is RECOVERABLE (marked done, not failed)', async () => {
  const d = batchDeps([row({ id: 'r1' })], async () => {
    const e = new Error('duplicate key') as Error & { code?: string };
    e.code = '23505';
    throw e;
  });
  const result = await runWorkerBatch(d);
  assert(result.processed === 1 && result.failed === 0, `expected the 23505 to be recoverable, got ${JSON.stringify(result)}`);
  assert(d.done.includes('r1'), 'a concurrent-adopt row must be marked done (the loser reconciles next tick)');
});

Deno.test('runWorkerBatch: an empty claim is a no-op batch (claimed:0, no processRow calls)', async () => {
  let calls = 0;
  const d = batchDeps([], async () => {
    calls += 1;
    return { kind: 'no-op' };
  });
  const result = await runWorkerBatch(d);
  assert(result.claimed === 0 && result.processed === 0 && result.failed === 0, `expected an empty result, got ${JSON.stringify(result)}`);
  assert(calls === 0, 'processRow must not be called when nothing is claimed');
});

// ── The archived_at dependency (2026-07-20): coded against tasks.archived_at, which ships on migration
// 0123 (origin/feat/task-model-fields, OD-INT-9) — NOT yet on this branch's `dev` base. The pure apply
// logic + this worker's archiveMirror wiring are exercised above/in webhookApply.test.ts with a MOCKED
// archiveMirror (proves the callback is invoked with the right pmoRecordId/archivedAtIso). This ONE
// test would assert the REAL DB write persists archived_at against a live `tasks` row — it needs the
// migration merged (or the column cherry-picked) first; unskip once that lands on this branch. ──────
Deno.test({
  name: 'SKIPPED (deps on migration 0123 task_model_fields / tasks.archived_at, origin/feat/task-model-fields, not on dev): archiveMirror persists archived_at to a real tasks row',
  ignore: true,
  fn: async () => {
    // Intentionally left unimplemented — see the docstring above. Unskip + implement against a live
    // `supabase test db` / seeded org+project+task fixture once 0123 (tasks.archived_at) is on this
    // branch's base.
  },
});
