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
//     blocks the rest of the batch;
//   - an archive event persists `tasks.archived_at` through the SHIPPED `buildApplyDepsLive` wiring
//     and a later plain sync neither clears nor resurrects it (OD-INT-9, #1883) — exercised against
//     an in-memory supabase-js-shaped client, never a copied deps bag.
//
// Deno-native test (plain assertions). `globalThis.fetch` is never touched here — `getTask` is an
// injected mock (matches the codebase's existing `fetchImpl`-injection convention for the ClickUp
// client, `client.ts`'s `ClickUpClientDeps`), not a monkeypatch.
//
// Verify: cd supabase/functions/clickup-webhook-worker && deno test index.test.ts

(Deno as unknown as { serve: (...a: unknown[]) => unknown }).serve = () => ({ finished: Promise.resolve() });
const {
  processInboxRow,
  resolveBindingLive,
  resolveOrgForTeam,
  runWorkerBatch,
  buildApplyDepsLive,
  claimPendingLive,
  markFailedLive,
  jobHandler,
  MAX_INBOX_ATTEMPTS,
} = await import('./index.ts');
type ProcessRowDeps = Parameters<typeof processInboxRow>[1];
type WorkerBatchDeps = Parameters<typeof runWorkerBatch>[0];
type InboxRow = Parameters<typeof processInboxRow>[0];
type ResolvedBinding = Awaited<ReturnType<ProcessRowDeps['resolveBinding']>>;

import { clickUpGetTaskRaw } from '../../../pmo-portal/src/lib/adapterSeam/clickup/reads.ts';
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
    team_id: overrides.team_id ?? 'team-1',
    history_items: overrides.history_items ?? [],
  };
}

Deno.test('worker resolves the org from team_id before fetching the task', async () => {
  const order: string[] = [];
  const binding: ResolvedBinding = { orgId: 'org-1', projectId: 'proj-1', statusMap, memberMap };
  const deps: ProcessRowDeps = {
    resolveOrg: async (teamId) => {
      order.push(`resolve-org:${teamId}`);
      return { orgId: 'org-1', token: 'per-org-token' };
    },
    getTask: async (_taskId, token) => {
      order.push(`get-task:${token}`);
      return task({ list: { id: 'list-9' } });
    },
    resolveBinding: async () => binding,
    buildApplyDeps: () => makeApplyDeps({ mappedPmoId: 'pmo-1' }).deps,
  };
  await processInboxRow(row(), deps);
  assert(order.join('|') === 'resolve-org:team-1|get-task:per-org-token', 'org and Vault token must resolve before ClickUp HTTP');
});

Deno.test('worker does not fetch when team_id has no org binding', async () => {
  let fetches = 0;
  const deps: ProcessRowDeps = {
    resolveOrg: async () => null,
    getTask: async () => { fetches += 1; return task(); },
    resolveBinding: async () => { throw new Error('must not resolve project binding'); },
    buildApplyDeps: () => { throw new Error('must not apply'); },
  };
  const outcome = await processInboxRow(row(), deps);
  assert(outcome.kind === 'no-op' && fetches === 0, 'unresolved team must fail closed without HTTP');
});

Deno.test('worker task re-GET sends the per-org token through the shipped ClickUp read client', async () => {
  let authorization = '';
  const fetchImpl = (async (_input: unknown, init?: RequestInit) => {
    authorization = new Headers(init?.headers).get('Authorization') ?? '';
    return new Response(JSON.stringify({ id: 'cu-1', name: 'Task', status: { status: 'to do' }, assignees: [], list: { id: 'list-9' }, date_updated: '1' }), { status: 200 });
  }) as typeof fetch;
  await clickUpGetTaskRaw('cu-1', { fetchImpl, token: 'per-org-token' });
  assert(authorization === 'per-org-token', 're-GET must use the per-org Vault token');
});

Deno.test('OD-INT-11: a MAPPED taskUpdated re-GETs, applies, and the mirror is updated', async () => {
  const applyDeps = makeApplyDeps({ mappedPmoId: 'pmo-1' });
  let getTaskCalls = 0;
  const binding: ResolvedBinding = { orgId: 'org-1', projectId: 'proj-1', statusMap, memberMap };
  const deps: ProcessRowDeps = {
    resolveOrg: async () => ({ orgId: 'org-1', token: 'test-token' }),
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
    resolveOrg: async () => ({ orgId: 'org-1', token: 'test-token' }),
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
    resolveOrg: async () => ({ orgId: 'org-1', token: 'test-token' }),
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
    resolveOrg: async () => ({ orgId: 'org-1', token: 'test-token' }),
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

function fakeBindingResolverClient(opts: { mapped?: boolean } = {}) {
  return {
    from(table: string) {
      const filters: Record<string, string> = {};
      type Query = {
        select: () => Query;
        eq: (column: string, value: string) => Query;
        is: (column: string, value: null) => Query;
        maybeSingle: () => Promise<{ data: unknown }>;
        then: (resolve: (value: unknown) => unknown) => unknown;
      };
      const query: Query = {
        select: () => query,
        eq: (column: string, value: string) => { filters[column] = value; return query; },
        is: (column: string, value: null) => { filters[column] = String(value); return query; },
        maybeSingle: async () => {
          if (table === 'external_refs') return { data: opts.mapped ? { org_id: 'org-1', pmo_record_id: 'task-1' } : null };
          if (table === 'tasks') return { data: { project_id: 'project-only-bound' } };
          if (table === 'external_project_bindings') {
            return filters.external_container_id === 'list-unbound' || filters.disconnected_at !== 'null'
              ? { data: null }
              : { data: { org_id: 'org-1', project_id: 'project-only-bound', config: {} } };
          }
          return { data: null };
        },
        // The ownership query is the only multi-row read in the resolver.
        then: (resolve: (value: unknown) => unknown) => table === 'external_domain_ownership'
          ? resolve({ data: [{ org_id: 'org-1' }] })
          : Promise.resolve(undefined),
      };
      return query;
    },
  };
}

Deno.test('AC-SEC-A3 the ClickUp binding resolution paths require an active binding', async () => {
  const adopted = await resolveBindingLive(fakeBindingResolverClient() as never, 'task-1', 'list-bound');
  const mapped = await resolveBindingLive(fakeBindingResolverClient({ mapped: true }) as never, 'task-1', null);
  assert(adopted?.projectId === 'project-only-bound', 'the active List binding should resolve');
  assert(mapped?.projectId === 'project-only-bound', 'the active mapped-task binding should resolve');
});

Deno.test('AC-IEM-014: an unbound List never leaks into the one bound project and is recorded as unresolvable', async () => {
  const applyDeps = makeApplyDeps();
  const deps: ProcessRowDeps = {
    resolveOrg: async () => ({ orgId: 'org-1', token: 'test-token' }),
    getTask: async () => task({ list: { id: 'list-unbound' } }),
    // Use the shipped live resolver: its only binding is list-bound; the unbound List must not
    // fall through to org-level employment.
    resolveBinding: async (taskId, listId) => resolveBindingLive(
      fakeBindingResolverClient() as never, taskId, listId,
    ),
    buildApplyDeps: () => applyDeps.deps,
  };
  const outcome = await processInboxRow(row({ id: 'unbound-row' }), deps);
  assert(outcome.kind === 'no-op', `expected no-op, got ${outcome.kind}`);
  assert(applyDeps.mints.length === 0 && applyDeps.updates.length === 0,
    'an unbound List must create or update no PMO task');

  const batch = batchDeps([row({ id: 'unbound-row' })], async () => outcome);
  await runWorkerBatch(batch);
  assert(batch.unresolvable.length === 1 && batch.unresolvable[0].id === 'unbound-row',
    'the discarded inbox event must be observable as unresolvable');
});

Deno.test('OD-INT-11: an unresolvable binding is a faithful ack-and-skip (no-op) — the sweep is the safety net', async () => {
  const deps: ProcessRowDeps = {
    resolveOrg: async () => ({ orgId: 'org-1', token: 'test-token' }),
    getTask: async () => task({ list: { id: 'list-unbound' } }),
    resolveBinding: async () => null,
    buildApplyDeps: () => {
      throw new Error('buildApplyDeps must not be called when no binding resolves');
    },
  };
  const outcome = await processInboxRow(row(), deps);
  assert(outcome.kind === 'no-op', `expected no-op, got ${outcome.kind}`);
});

// ── Claim-first adopt + compare-and-set mirror update wiring (the shipped bag the worker applies
//    through). The full engine-level interleaving/concurrency proofs live in
//    supabase/functions/_shared/clickupMirrorDeps.test.ts against the SAME shared factory; this pins
//    the WORKER's wiring: the live apply deps must carry the strategy and its claim must hit
//    external_refs (insert-only), never an unconditional upsert. ──────────────────────────────────
function fakeMirrorWriteClient() {
  const inserts: Array<{ table: string; row: Record<string, unknown> }> = [];
  const client = {
    from(table: string) {
      type MirrorWriteQuery = {
        select: () => MirrorWriteQuery;
        eq: (column: string, value: unknown) => MirrorWriteQuery;
        or: () => MirrorWriteQuery;
        update: () => MirrorWriteQuery;
        insert: (row: Record<string, unknown>) => MirrorWriteQuery;
        maybeSingle: () => Promise<{ data: unknown; error: null }>;
        then: (resolve: (value: unknown) => unknown) => unknown;
      };
      const q: MirrorWriteQuery = {
        select: () => q,
        eq: () => q,
        or: () => q,
        update: () => q,
        insert: (r: Record<string, unknown>) => {
          inserts.push({ table, row: r });
          return q;
        },
        maybeSingle: async () => ({ data: null, error: null }),
        then: (resolve: (v: unknown) => unknown) => resolve({ data: null, error: null }),
      };
      return q;
    },
  };
  return { client, inserts };
}

Deno.test('claim-first adopt is wired into the live apply deps: the claim is an INSERT-only external_refs write', async () => {
  const { client, inserts } = fakeMirrorWriteClient();
  const binding: ResolvedBinding = { orgId: 'org-1', projectId: 'proj-1', statusMap, memberMap };
  const deps = buildApplyDepsLive(client as never, binding);

  assert(deps.adoptAtomically !== undefined, 'the live apply deps must carry the claim-first adopt strategy');
  await deps.adoptAtomically!.claimExternalRef({
    pmoRecordId: 'pmo-1',
    externalTier: 'clickup',
    externalRecordId: 'cu-1',
    domain: 'tasks',
  });
  const refInsert = inserts.find((i) => i.table === 'external_refs');
  if (!refInsert) throw new Error('the claim must write external_refs via INSERT (refuses a duplicate — the adoption lock)');
  assert(refInsert.row.pmo_record_id === 'pmo-1' && refInsert.row.external_record_id === 'cu-1', 'the claim records the mapping');

  const repaired = await deps.adoptAtomically!.mirrorExists('pmo-1');
  assert(repaired === false, 'a mirror row that does not exist is reported absent (drives the same-id repair)');
});

// ── Live wiring: the shipped deps resolve status / parent / project for an existing mapped task. ───

type FieldRow = Record<string, unknown>;
function statefulClient(seed: { refs: FieldRow[]; tasks: FieldRow[] }) {
  const tables: Record<string, FieldRow[]> = { external_refs: seed.refs, tasks: seed.tasks, external_sync_watermarks: [] };
  const client = {
    from(table: string) {
      const filters: Array<[string, unknown]> = [];
      let op: 'select' | 'update' | 'insert' | 'upsert' = 'select';
      let payload: FieldRow = {};
      const rows = () => (tables[table] ??= []);
      const match = (r: FieldRow) => filters.every(([c, v]) => r[c] === v);
      type StatefulQuery = {
        select: () => StatefulQuery;
        eq: (column: string, value: unknown) => StatefulQuery;
        is: (column: string, value: unknown) => StatefulQuery;
        or: () => StatefulQuery;
        update: (row: FieldRow) => StatefulQuery;
        insert: (row: FieldRow) => StatefulQuery;
        upsert: (row: FieldRow) => StatefulQuery;
        maybeSingle: () => Promise<{ data: FieldRow | null; error: null }>;
        then: (resolve: (value: unknown) => unknown) => unknown;
      };
      const b: StatefulQuery = {
        select: () => b,
        eq: (c: string, v: unknown) => (filters.push([c, v]), b),
        is: (c: string, v: unknown) => (filters.push([c, v]), b),
        or: () => b,
        update: (p: FieldRow) => ((op = 'update'), (payload = p), b),
        insert: (p: FieldRow) => ((op = 'insert'), (payload = p), b),
        upsert: (p: FieldRow) => ((op = 'upsert'), (payload = p), b),
        maybeSingle: () => Promise.resolve({ data: rows().find(match) ?? null, error: null }),
        then: (resolve: (v: unknown) => unknown) => {
          if (op === 'update') {
            const hit = rows().filter(match);
            hit.forEach((r) => Object.assign(r, payload));
            return resolve({ data: hit.map((r) => ({ id: r.id })), error: null });
          }
          if (op === 'insert') rows().push({ ...payload });
          return resolve({ data: null, error: null });
        },
      };
      return b;
    },
  };
  return { client, tables };
}

async function applyLive(
  seed: { refs: FieldRow[]; tasks: FieldRow[] },
  cuTask: ClickUpTask,
  map: ClickUpStatusMap = statusMap,
) {
  const db = statefulClient(seed);
  const binding: ResolvedBinding = { orgId: 'org-1', projectId: 'proj-1', statusMap: map, memberMap };
  const row: InboxRow = { id: 'in-1', event: 'taskUpdated', task_id: cuTask.id, team_id: 'team-1', history_items: [] };
  const outcome = await processInboxRow(row, {
    resolveOrg: async () => ({ orgId: 'org-1', token: 't' }),
    getTask: async () => cuTask,
    resolveBinding: async () => binding,
    buildApplyDeps: (bnd) => buildApplyDepsLive(db.client as never, bnd),
  });
  return { outcome, tables: db.tables };
}
const liveRef = (cu: string, pmo: string): FieldRow => ({ org_id: 'org-1', domain: 'tasks', external_record_id: cu, pmo_record_id: pmo });
const liveMirror = (id: string, extra: FieldRow = {}): FieldRow => ({ id, org_id: 'org-1', project_id: 'proj-1', name: 'old', status: 'To Do', source_updated_at: new Date(1000).toISOString(), ...extra });

Deno.test('live worker keeps a mapped task\'s PMO-only status across an unrelated inbound change', async () => {
  const { tables } = await applyLive(
    { refs: [liveRef('cu-1', 'pmo-1')], tasks: [liveMirror('pmo-1', { status: 'Blocked' })] },
    task({ id: 'cu-1', name: 'Renamed' }),
    { ...statusMap, pmoOnlyStatuses: ['Blocked'] },
  );
  assert(tables.tasks[0].name === 'Renamed', 'the inbound change applies');
  assert(tables.tasks[0].status === 'Blocked', 'the PMO-only status must survive the sync');
});

Deno.test('live worker: no ClickUp parent keeps the linked PMO parent; a ClickUp parent resolves; another project\'s parent is refused', async () => {
  const refs = [liveRef('cu-1', 'pmo-1'), liveRef('cu-p', 'pmo-p'), liveRef('cu-x', 'pmo-x')];
  const tasks = () => [
    liveMirror('pmo-1', { parent_task_id: 'pmo-keep' }),
    liveMirror('pmo-p'),
    liveMirror('pmo-x', { project_id: 'proj-other' }),
  ];

  const none = await applyLive({ refs, tasks: tasks() }, task({ id: 'cu-1' }));
  assert(none.tables.tasks[0].parent_task_id === 'pmo-keep', 'a task with no ClickUp parent must not be flattened');

  const resolved = await applyLive({ refs, tasks: tasks() }, { ...task({ id: 'cu-1' }), parent: 'cu-p' });
  assert(resolved.tables.tasks[0].parent_task_id === 'pmo-p', 'the ClickUp parent resolves to the mirrored PMO task');

  const refused = await applyLive({ refs, tasks: tasks() }, { ...task({ id: 'cu-1' }), parent: 'cu-x' });
  assert(refused.tables.tasks[0].parent_task_id === null, 'a parent in another project than the bound child is refused');
});

// ── runWorkerBatch — claim/process/mark bookkeeping. ────────────────────────────────────────────

function batchDeps(rows: InboxRow[], processRow: WorkerBatchDeps['processRow']): WorkerBatchDeps & {
  done: string[];
  failed: Array<{ id: string; error: string }>;
  held: Array<{ id: string; reason: string }>;
  unresolvable: Array<{ id: string; reason: string }>;
} {
  const done: string[] = [];
  const failed: Array<{ id: string; error: string }> = [];
  const held: Array<{ id: string; reason: string }> = [];
  const unresolvable: Array<{ id: string; reason: string }> = [];
  return {
    claimPending: async () => rows,
    markDone: async (id) => {
      done.push(id);
    },
    markFailed: async (id, error) => {
      failed.push({ id, error });
    },
    markHeld: async (id, reason) => {
      held.push({ id, reason });
    },
    markUnresolvable: async (id, reason) => {
      unresolvable.push({ id, reason });
    },
    processRow,
    done,
    failed,
    held,
    unresolvable,
  };
}

Deno.test('runWorkerBatch: a successful row is marked done', async () => {
  const d = batchDeps([row({ id: 'r1' })], async () => ({ kind: 'upserted', pmoRecordId: 'pmo-1', adopted: false }));
  const result = await runWorkerBatch(d);
  assert(result.processed === 1 && result.failed === 0, `expected 1 processed / 0 failed, got ${JSON.stringify(result)}`);
  assert(d.done.includes('r1'), 'row r1 must be marked done');
});

Deno.test('FR-PLN-006 runWorkerBatch preserves a feature-off row as pending without counting a failure', async () => {
  const d = batchDeps([row({ id: 'held-row' })], async () => ({ kind: 'held', reason: 'feature-off:clickup_sync' }));
  const result = await runWorkerBatch(d);
  assert(result.claimed === 1 && result.processed === 0 && result.failed === 0, `expected a held row, got ${JSON.stringify(result)}`);
  assert(d.held.some((entry) => entry.id === 'held-row' && entry.reason === 'feature-off:clickup_sync'), 'held row must be returned to pending');
  assert(d.done.length === 0 && d.unresolvable.length === 0, 'a feature-off row must not be acknowledged or discarded');
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

// ── OD-INT-9 archive write, the REAL test (issue #1883 — replaces the skipped placeholder that stood
// here while `tasks.archived_at` was still migration-pending). The column shipped on migration 0140
// (task_model_fields), so the SHIPPED `buildApplyDepsLive().archiveMirror` write is exercised
// end-to-end: two `taskUpdated` inbox rows run through `processInboxRow` with `buildApplyDeps` wired
// to the shipped factory, whose service client is an in-memory supabase-js-shaped fake (exactly the
// PostgREST surface the shipped callbacks issue: select/eq/is/in/or → update/insert/upsert →
// maybeSingle / select-after-update). The pure apply + a MOCKED archiveMirror stay covered in
// webhookApply.test.ts; THIS test owns the real write. Mutation oracle: gutting the archive write —
// a no-op archiveMirror in buildApplyDepsLive, or teaching updateMirror's patch to carry
// `archived_at: null` — must turn this test RED. ─────────────────────────────────────────────────
type Row = Record<string, unknown>;

/** Minimal supabase-js-shaped in-memory service client: only the chains the shipped mirror callbacks
 *  and archive/tombstone mirrors issue; anything else THROWS, so a shipped-code drift fails the test
 *  loudly instead of silently passing against an unintended query shape. Every executed `update` is
 *  recorded in `patches` so the test can prove no later-sync write carries `archived_at`. */
function fakeServiceClient(store: Record<string, Row[]>) {
  const patches: Array<{ table: string; patch: Row }> = [];
  /** Parse the one `or()` form the shipped CAS predicate uses:
   *  `source_updated_at.is.null,source_updated_at.lte.<iso>` — PostgREST or-semantics (ANY clause). */
  const clause = (r: Row, c: string): boolean => {
    const m = /^([a-z_]+?)\.(is|lte)\.(.+)$/.exec(c);
    if (!m) throw new Error(`fake client: unsupported or() clause "${c}"`);
    const col = m[1];
    const op = m[2];
    const val = m[3];
    if (op === 'is') return r[col] === (val === 'null' ? null : val);
    return r[col] !== null && r[col] !== undefined && String(r[col]) <= val; // ISO strings order lexically
  };
  function from(table: string) {
    const rows = store[table];
    if (!rows) throw new Error(`fake client: no in-memory table "${table}"`);
    let filters: Array<{ col: string; op: 'eq' | 'is' | 'in'; val: unknown }> = [];
    let orExprs: string[] = [];
    let selected: string | null = null;
    let patch: Row | null = null;
    let updating = false;
    const matched = () =>
      rows.filter((r) =>
        filters.every((f) => (f.op === 'in' ? (f.val as unknown[]).includes(r[f.col]) : r[f.col] === f.val))
        && orExprs.every((expr) => expr.split(',').some((c) => clause(r, c))));
    const projectRow = (r: Row): Row =>
      selected === null ? r : Object.fromEntries(selected.split(',').map((c) => [c.trim(), r[c.trim()]]));
    const exec = (): { data: Row[] | null; error: null } => {
      if (updating && patch) {
        const hits = matched();
        for (const r of hits) Object.assign(r, patch);
        patches.push({ table, patch: { ...patch } });
        return { data: hits.map(projectRow), error: null };
      }
      return { data: matched().map(projectRow), error: null };
    };
    const build = {
      select(cols?: string) {
        selected = cols ?? '*';
        return build;
      },
      update(p: Row) {
        updating = true;
        patch = p;
        return build;
      },
      insert(v: Row) {
        rows.push({ ...v });
        return { data: null, error: null };
      },
      upsert(v: Row, opts?: { onConflict?: string }) {
        const conflictCols = (opts?.onConflict ?? '').split(',').map((c) => c.trim()).filter((c) => c !== '');
        const existing = conflictCols.length > 0 ? rows.find((r) => conflictCols.every((c) => r[c] === v[c])) : undefined;
        if (existing) Object.assign(existing, v);
        else rows.push({ ...v });
        return { data: null, error: null };
      },
      eq(col: string, val: unknown) {
        filters.push({ col, op: 'eq', val });
        return build;
      },
      is(col: string, val: unknown) {
        filters.push({ col, op: 'is', val });
        return build;
      },
      in(col: string, val: unknown[]) {
        filters.push({ col, op: 'in', val });
        return build;
      },
      or(expr: string) {
        orExprs.push(expr);
        return build;
      },
      order() {
        return build;
      },
      limit() {
        return build;
      },
      then<T1 = { data: Row[] | null; error: null }, T2 = never>(
        onfulfilled?: ((value: { data: Row[] | null; error: null }) => T1 | PromiseLike<T1>) | null,
        onrejected?: ((reason: unknown) => T2 | PromiseLike<T2>) | null,
      ): PromiseLike<T1 | T2> {
        return Promise.resolve(exec()).then(onfulfilled, onrejected);
      },
      maybeSingle: async (): Promise<{ data: Row | null; error: null }> => {
        const hits = matched();
        if (hits.length > 1) throw new Error(`fake client: maybeSingle matched ${hits.length} rows in "${table}"`);
        return { data: hits[0] ? { ...hits[0] } : null, error: null };
      },
    };
    return build;
  }
  return { from, patches };
}

Deno.test('OD-INT-9: archiving a synced task writes archived_at via the shipped archiveMirror, and a later sync neither clears nor resurrects it', async () => {
  const T0 = 1_700_000_000_000; // the mirror's seeded source_updated_at (the state the sync finds)
  const T_ARCHIVE = 1_700_003_600_000; // the archive history entry's own timestamp
  const T_LATER = 1_700_010_000_000; // a later plain sync's timestamp
  const isoArchive = new Date(T_ARCHIVE).toISOString();

  const store: Record<string, Row[]> = {
    tasks: [{
      id: 'pmo-1',
      org_id: 'org-1',
      project_id: 'proj-1',
      name: 'Synced task',
      status: 'To Do',
      assignee_id: null,
      start_date: null,
      end_date: null,
      completed_at: null,
      description: null,
      priority: null,
      parent_task_id: null,
      tombstoned_at: null,
      archived_at: null,
      source_updated_at: new Date(T0).toISOString(),
    }],
    external_refs: [{ org_id: 'org-1', domain: 'tasks', external_tier: 'clickup', external_record_id: 'cu-1', pmo_record_id: 'pmo-1' }],
    external_sync_watermarks: [],
  };
  const client = fakeServiceClient(store);
  const binding: ResolvedBinding = { orgId: 'org-1', projectId: 'proj-1', statusMap, memberMap };
  // The worker's real deps shape: only ClickUp HTTP (getTask) and the org/binding SQL (resolveOrg /
  // resolveBinding — both covered by the shipped-wiring tests above) are stubbed; buildApplyDeps is
  // the SHIPPED factory under test, pointed at the in-memory client.
  const depsFor = (reGet: ClickUpTask): ProcessRowDeps => ({
    resolveOrg: async () => ({ orgId: 'org-1', token: 'per-org-token' }),
    getTask: async () => reGet,
    resolveBinding: async () => binding,
    buildApplyDeps: (b) => buildApplyDepsLive(client as never, b),
  });

  // 1. The archive sync: a taskUpdated whose history records `archived: true`. The re-GET cursor is
  //    deliberately LATER than the history item's timestamp, so archived_at must come from the
  //    history item (not the source-mod fallback) to pass.
  const archiveOutcome = await processInboxRow(
    row({ id: 'r1', history_items: [{ field: 'archived', after: 'true', date: String(T_ARCHIVE) }] }),
    depsFor(task({ id: 'cu-1', name: 'Synced task', date_updated: String(T_ARCHIVE + 60_000) })),
  );
  assert(
    archiveOutcome.kind === 'upserted' && archiveOutcome.pmoRecordId === 'pmo-1',
    `the archive event must apply to the mapped mirror, got ${JSON.stringify(archiveOutcome)}`,
  );
  const archivedRow = store.tasks[0] as { archived_at: string | null; source_updated_at: string };
  assert(
    archivedRow.archived_at === isoArchive,
    `archiving a synced task must persist archived_at=${isoArchive} (the history item's timestamp, NOT the re-GET cursor), got ${archivedRow.archived_at}`,
  );
  assert(
    archivedRow.source_updated_at === new Date(T_ARCHIVE + 60_000).toISOString(),
    `the apply itself must have gone through the guarded update path, got source_updated_at=${archivedRow.source_updated_at}`,
  );
  assert(
    client.patches.some((p) => p.table === 'tasks' && p.patch.archived_at === isoArchive),
    `the shipped archiveMirror must issue the tasks.archived_at write itself, patches=${JSON.stringify(client.patches)}`,
  );

  // 2. The later plain sync (a status change, NO archived history entry): must apply its own change
  //    and leave archived_at exactly as written — never cleared to null, never resurrected.
  const patchesBefore = client.patches.length;
  const laterOutcome = await processInboxRow(
    row({ id: 'r2', history_items: [{ field: 'status', after: 'complete', date: String(T_LATER) }] }),
    depsFor(task({ id: 'cu-1', status: { status: 'complete' }, date_updated: String(T_LATER) })),
  );
  assert(
    laterOutcome.kind === 'upserted' && laterOutcome.pmoRecordId === 'pmo-1',
    `the later sync must apply (not stall as a stale no-op), got ${JSON.stringify(laterOutcome)}`,
  );
  const laterRow = store.tasks[0] as { archived_at: string | null; status: string };
  assert(laterRow.status === 'Done', `the later sync must apply its own change (status → Done via the map), got ${laterRow.status}`);
  assert(
    laterRow.archived_at === isoArchive,
    `a later sync must NOT clear or resurrect archived_at — expected ${isoArchive}, got ${laterRow.archived_at}`,
  );
  const laterPatches = client.patches.slice(patchesBefore);
  assert(
    laterPatches.length > 0 && laterPatches.every((p) => !('archived_at' in p.patch)),
    `no later-sync write may carry archived_at (updateMirror's field set omits the column), got ${JSON.stringify(laterPatches)}`,
  );
});


// ── T-07 B3 · a lookup / vault FAILURE is not an absent binding ───────────────────────────────────
// A failed read fails the row (so it is retried) — it must never collapse into the acknowledged
// "unresolvable" no-op that permanently drops the event.

type PgErr = { message: string; code?: string };
const PG_DOWN: PgErr = { message: 'connection reset by peer', code: '08006' };

/** `external_org_bindings` + `read_vault_secret` stand-in for `resolveOrgForTeam`. */
function orgClient(opts: { binding?: { org_id: string; secret_ref: string | null } | null; bindingError?: PgErr; vault?: string | null; vaultError?: PgErr; featureEnabled?: boolean; featureError?: PgErr }) {
  return {
    from: () => {
      type BindingQuery = {
        select: () => BindingQuery;
        eq: () => BindingQuery;
        maybeSingle: () => Promise<{ data: { org_id: string; secret_ref: string | null } | null; error: PgErr | null }>;
      };
      const q: BindingQuery = {
        select: () => q,
        eq: () => q,
        maybeSingle: async () => ({ data: opts.binding ?? null, error: opts.bindingError ?? null }),
      };
      return q;
    },
    rpc: async (name: string) => name === 'service_feature_enabled'
      ? ({ data: opts.featureEnabled ?? true, error: opts.featureError ?? null })
      : ({ data: opts.vault ?? null, error: opts.vaultError ?? null }),
  } as never;
}

async function rejectsWith(p: Promise<unknown>): Promise<unknown> {
  try {
    await p;
  } catch (e) {
    return e;
  }
  return null;
}

Deno.test('T-07 B3: resolveOrgForTeam — confirmed absence is null; found binding resolves the token', async () => {
  assert((await resolveOrgForTeam(orgClient({ binding: null }), 'team-1')) === null, 'no binding row → null (ack as unresolvable)');
  assert((await resolveOrgForTeam(orgClient({ binding: { org_id: 'org-1', secret_ref: 'ref' }, vault: null }), 'team-1')) === null, 'empty vault secret → null');
  const ok = await resolveOrgForTeam(orgClient({ binding: { org_id: 'org-1', secret_ref: 'ref' }, vault: 'tok' }), 'team-1');
  assert(ok?.orgId === 'org-1' && ok.token === 'tok', 'found binding + vault secret resolves');
});

Deno.test('FR-PLN-006 resolveOrgForTeam observes clickup_sync before reading the Vault secret', async () => {
  const off = await resolveOrgForTeam(orgClient({
    binding: { org_id: 'org-1', secret_ref: 'ref' },
    featureEnabled: false,
  }), 'team-1');
  assert(off?.featureEnabled === false && off.token === '', 'an off org is identified without loading a sync token');
});

Deno.test('T-07 B3: resolveOrgForTeam throws when the binding read fails (not null)', async () => {
  const err = await rejectsWith(resolveOrgForTeam(orgClient({ bindingError: PG_DOWN }), 'team-1'));
  assert(err !== null, 'a binding read error must surface, not read as "no binding"');
});

Deno.test('T-07 B3: resolveOrgForTeam throws when the vault read fails (not null)', async () => {
  const err = await rejectsWith(resolveOrgForTeam(orgClient({ binding: { org_id: 'org-1', secret_ref: 'ref' }, vaultError: PG_DOWN }), 'team-1'));
  assert(err !== null, 'a vault read error must surface, not read as "unresolvable"');
});

Deno.test('T-07 B3: a failed org lookup fails the row (markFailed), is never acked as unresolvable', async () => {
  const d = batchDeps([row({ id: 'r1' })], (r) =>
    processInboxRow(r, {
      resolveOrg: (teamId) => resolveOrgForTeam(orgClient({ bindingError: PG_DOWN }), teamId),
      getTask: async () => { throw new Error('must not fetch'); },
      resolveBinding: async () => { throw new Error('must not resolve'); },
      buildApplyDeps: () => { throw new Error('must not apply'); },
    }));
  const result = await runWorkerBatch(d);
  assert(result.failed === 1 && result.processed === 0, `expected the row to fail, got ${JSON.stringify(result)}`);
  assert(d.failed.some((f) => f.id === 'r1'), 'r1 must be marked failed');
  assert(d.done.length === 0 && d.unresolvable.length === 0, 'a read failure must not ack the row');
});

/** Fails the `failOn` table's reads with a query error; everything else behaves like the happy resolver. */
function failingBindingClient(failOn: string, opts: { mapped?: boolean } = {}) {
  const happy = fakeBindingResolverClient(opts);
  return {
    from(table: string) {
      const q = happy.from(table);
      if (table !== failOn) return q;
      q.maybeSingle = async () => ({ data: null, error: PG_DOWN });
      return q;
    },
  } as never;
}

Deno.test('T-07 B3: resolveBindingLive throws on a failed read at every step (mapped ref, task, project binding, list binding)', async () => {
  for (const [failOn, mapped, listId] of [
    ['external_refs', false, 'list-bound'],
    ['tasks', true, null],
    ['external_project_bindings', true, null],
    ['external_project_bindings', false, 'list-bound'],
  ] as const) {
    const err = await rejectsWith(resolveBindingLive(failingBindingClient(failOn, { mapped }), 'task-1', listId));
    assert(err !== null, `a failed ${failOn} read (mapped=${mapped}) must throw, not resolve to "no binding"`);
  }
});

/** An in-memory `clickup_webhook_inbox`: only the PostgREST operations the claim / mark-failed code issues. */
function fakeInbox(seed: Array<{ id: string; status: string; attempts: number; received_at: string; processed_at?: string | null; team_id?: string | null }>, opts: { readError?: PgErr } = {}) {
  const rows = seed.map((r) => ({ event: 'taskUpdated', task_id: `t-${r.id}`, team_id: 'team-1', history_items: [], ...r }));
  const client = {
    from() {
      const eq: Array<[string, unknown]> = [];
      const lt: Array<[string, number]> = [];
      let patch: Record<string, unknown> | null = null;
      let ids: string[] | null = null;
      const orders: Array<{ column: string; ascending: boolean; nullsFirst: boolean }> = [];
      let limit = Infinity;
      const matches = () => rows.filter((r) =>
        eq.every(([c, v]) => (r as Record<string, unknown>)[c] === v) &&
        lt.every(([c, v]) => ((r as Record<string, unknown>)[c] as number) < v) &&
        (ids === null || ids.includes(r.id)));
      const run = () => {
        if (patch) {
          for (const r of matches()) Object.assign(r, patch);
          return { data: null, error: null };
        }
        if (opts.readError) return { data: null, error: opts.readError };
        let out = matches();
        if (orders.length) out = [...out].sort((a, b) => {
          for (const { column, ascending, nullsFirst } of orders) {
            const av = (a as Record<string, unknown>)[column];
            const bv = (b as Record<string, unknown>)[column];
            if (av == null || bv == null) {
              if (av == null && bv == null) continue;
              return (av == null ? (nullsFirst ? -1 : 1) : (nullsFirst ? 1 : -1)) * (ascending ? 1 : -1);
            }
            const cmp = String(av).localeCompare(String(bv));
            if (cmp !== 0) return cmp * (ascending ? 1 : -1);
          }
          return 0;
        });
        return { data: out.slice(0, limit).map((r) => ({ ...r })), error: null };
      };
      type InboxQuery = {
        select: () => InboxQuery;
        eq: (column: string, value: unknown) => InboxQuery;
        lt: (column: string, value: number) => InboxQuery;
        in: (column: string, values: string[]) => InboxQuery;
        order: (column: string, options?: { ascending?: boolean; nullsFirst?: boolean }) => InboxQuery;
        limit: (count: number) => InboxQuery;
        update: (patch: Record<string, unknown>) => InboxQuery;
        maybeSingle: () => Promise<{ data: unknown; error: PgErr | null }>;
        then: (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) => Promise<unknown>;
      };
      const q: InboxQuery = {
        select: () => q,
        eq: (c: string, v: unknown) => { eq.push([c, v]); return q; },
        lt: (c: string, v: number) => { lt.push([c, v]); return q; },
        in: (_c: string, v: string[]) => { ids = v; return q; },
        order: (c: string, options: { ascending?: boolean; nullsFirst?: boolean } = {}) => {
          orders.push({ column: c, ascending: options.ascending ?? true, nullsFirst: options.nullsFirst ?? false });
          return q;
        },
        limit: (n: number) => { limit = n; return q; },
        update: (p: Record<string, unknown>) => { patch = p; return q; },
        maybeSingle: async () => ({ ...run(), data: matches()[0] ?? null }),
        then: (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) => Promise.resolve(run()).then(resolve, reject),
      };
      return q;
    },
  };
  return { client: client as never, rows };
}

Deno.test('T-07 B3: claimPendingLive reclaims failed rows under the attempt cap, oldest first, and skips capped ones', async () => {
  const { client, rows } = fakeInbox([
    { id: 'capped', status: 'failed', attempts: MAX_INBOX_ATTEMPTS, received_at: '2026-01-01T00:00:01Z' },
    { id: 'failed-old', status: 'failed', attempts: 1, received_at: '2026-01-01T00:00:02Z' },
    { id: 'pending-mid', status: 'pending', attempts: 0, received_at: '2026-01-01T00:00:03Z' },
    { id: 'failed-new', status: 'failed', attempts: MAX_INBOX_ATTEMPTS - 1, received_at: '2026-01-01T00:00:04Z' },
    { id: 'done', status: 'done', attempts: 0, received_at: '2026-01-01T00:00:00Z' },
  ]);
  const claimed = await claimPendingLive(client, 25);
  assert(claimed.map((r) => r.id).join() === 'failed-old,pending-mid,failed-new', `claim order, got ${claimed.map((r) => r.id).join()}`);
  assert(rows.filter((r) => r.status === 'processing').length === 3, 'claimed rows are marked processing');
  assert(rows.find((r) => r.id === 'capped')?.status === 'failed', 'a row at the attempt cap stays failed');
});

Deno.test('T-07 B3: claimPendingLive honours the batch size across pending and failed rows', async () => {
  const { client } = fakeInbox([
    { id: 'f1', status: 'failed', attempts: 1, received_at: '2026-01-01T00:00:01Z' },
    { id: 'p1', status: 'pending', attempts: 0, received_at: '2026-01-01T00:00:02Z' },
    { id: 'f2', status: 'failed', attempts: 1, received_at: '2026-01-01T00:00:03Z' },
  ]);
  const claimed = await claimPendingLive(client, 2);
  assert(claimed.map((r) => r.id).join() === 'f1,p1', `expected the 2 oldest, got ${claimed.map((r) => r.id).join()}`);
});

Deno.test('FR-PLN-006: held rows rotate behind untouched events across batches', async () => {
  const seed = Array.from({ length: 30 }, (_, index) => ({
    id: `held-${String(index).padStart(2, '0')}`,
    status: 'pending',
    attempts: 0,
    received_at: new Date(Date.UTC(2026, 0, 1, 0, index)).toISOString(),
    team_id: 'disabled-team',
  }));
  seed.push({
    id: 'enabled-new', status: 'pending', attempts: 0,
    received_at: new Date(Date.UTC(2026, 0, 1, 1)).toISOString(), team_id: 'enabled-team',
  });
  const { client, rows } = fakeInbox(seed);
  let enabledProcessed = 0;
  const tick = () => runWorkerBatch({
    claimPending: (batchSize) => claimPendingLive(client, batchSize),
    markDone: async (id) => { const target = rows.find((r) => r.id === id); if (target) target.status = 'done'; },
    markFailed: async (id, reason) => { const target = rows.find((r) => r.id === id); if (target) Object.assign(target, { status: 'failed', last_error: reason }); },
    markHeld: async (id, reason) => {
      const target = rows.find((r) => r.id === id);
      if (target) Object.assign(target, { status: 'pending', last_error: reason, processed_at: '2026-01-02T00:00:00.000Z' });
    },
    markUnresolvable: async (id, reason) => { const target = rows.find((r) => r.id === id); if (target) Object.assign(target, { status: 'done', last_error: reason }); },
    processRow: async (claimed) => {
      if (claimed.team_id === 'disabled-team') return { kind: 'held', reason: 'feature-off:clickup_sync' };
      enabledProcessed += 1;
      return { kind: 'upserted', pmoRecordId: 'pmo-enabled', adopted: false };
    },
  }, 25);

  await tick();
  await tick();

  assert(enabledProcessed === 1, 'the enabled org event must be reached after the first held batch');
  assert(rows.find((r) => r.id === 'enabled-new')?.status === 'done', 'the enabled event is acknowledged after apply');
  assert(rows.filter((r) => r.id.startsWith('held-')).every((r) => r.status === 'pending'), 'disabled org events remain pending for recovery');
  assert(rows.filter((r) => r.id.startsWith('held-')).some((r) => r.processed_at != null), 'held rows carry their last attempt time for queue rotation');
});

Deno.test('T-07 B3: markFailedLive counts each failure, so repeated failures reach the cap and stop being reclaimed', async () => {
  const { client, rows } = fakeInbox([{ id: 'r1', status: 'processing', attempts: 0, received_at: '2026-01-01T00:00:01Z' }]);
  for (let i = 0; i < MAX_INBOX_ATTEMPTS; i += 1) {
    await markFailedLive(client, 'r1', 'boom');
    assert(rows[0].status === 'failed', 'failed after each failure');
    const reclaimed = await claimPendingLive(client, 25);
    assert(reclaimed.length === (i + 1 < MAX_INBOX_ATTEMPTS ? 1 : 0), `attempt ${i + 1}: reclaim expected ${i + 1 < MAX_INBOX_ATTEMPTS ? 1 : 0}, got ${reclaimed.length}`);
  }
  assert(rows[0].attempts === MAX_INBOX_ATTEMPTS, 'attempts counted');
});

Deno.test('T-07 B3: markFailedLive throws when the attempts read fails (the cap must not silently reset)', async () => {
  const { client } = fakeInbox([{ id: 'r1', status: 'processing', attempts: 3, received_at: '2026-01-01T00:00:01Z' }], { readError: PG_DOWN });
  const err = await rejectsWith(markFailedLive(client, 'r1', 'boom'));
  assert(err !== null, 'an attempts read error must surface');
});

async function runLiveFeatureWorker(featureEnabled: boolean) {
  const previousEnv = Object.fromEntries(['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'CLICKUP_WEBHOOK_WORKER_SECRET', 'EXTERNAL_CONNECT_ENABLED']
    .map((key) => [key, Deno.env.get(key)]));
  const env = {
    SUPABASE_URL: 'https://edge-test.supabase',
    SUPABASE_SERVICE_ROLE_KEY: 'synthetic-service-role-key',
    CLICKUP_WEBHOOK_WORKER_SECRET: 'synthetic-worker-secret',
    EXTERNAL_CONNECT_ENABLED: 'true',
  };
  for (const [key, value] of Object.entries(env)) Deno.env.set(key, value);
  const originalFetch = globalThis.fetch;
  const calls: Array<{ url: URL; method: string; body: string }> = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(input, init);
    const url = new URL(request.url);
    const method = init?.method ?? request.method;
    const body = method === 'GET' ? '' : await request.clone().text();
    calls.push({ url, method, body });
    if (url.pathname === '/rest/v1/clickup_webhook_inbox' && method === 'GET') {
      const status = url.searchParams.get('status');
      if (status === 'eq.pending') return new Response(JSON.stringify([{ id: 'inbox-1', event: 'taskUpdated', task_id: 'task-1', team_id: 'team-1', history_items: [], received_at: '2026-01-01T00:00:00Z' }]), { status: 200 });
      if (status === 'eq.failed') return new Response('[]', { status: 200 });
    }
    if (url.pathname === '/rest/v1/external_org_bindings') {
      return new Response(JSON.stringify({ org_id: 'org-1', secret_ref: 'synthetic-vault-ref' }), { status: 200 });
    }
    if (url.pathname === '/rest/v1/rpc/service_feature_enabled') return new Response(JSON.stringify(featureEnabled), { status: 200 });
    if (url.pathname === '/rest/v1/rpc/read_vault_secret') return new Response(JSON.stringify('synthetic-clickup-token'), { status: 200 });
    if (url.pathname === '/rest/v1/external_refs') return new Response('[]', { status: 200 });
    if (url.pathname === '/rest/v1/clickup_webhook_inbox' && method === 'PATCH') return new Response(null, { status: 204 });
    if (url.hostname === 'api.clickup.com' && url.pathname.endsWith('/task/task-1')) return new Response('{}', { status: 404 });
    throw new Error(`unexpected request: ${method} ${url.href}`);
  }) as typeof fetch;
  try {
    const response = await jobHandler(new Request('http://edge.test/clickup-webhook-worker', {
      method: 'POST',
      headers: { Authorization: 'Bearer synthetic-worker-secret' },
      body: '{}',
    }));
    return { response, body: await response.json(), calls };
  } finally {
    globalThis.fetch = originalFetch;
    for (const [key, value] of Object.entries(previousEnv)) {
      if (value === undefined) Deno.env.delete(key);
      else Deno.env.set(key, value as string);
    }
  }
}

Deno.test('FR-PLN-006 clickup_sync off returns a claimed webhook row to pending without fetching or dropping it', async () => {
  const r = await runLiveFeatureWorker(false);
  assert((r.body as { processed: number; failed: number }).processed === 0, 'a held row is not counted as processed');
  assert((r.body as { failed: number }).failed === 0, 'a held row is not marked failed');
  const clickupCalls = r.calls.filter((c) => c.url.hostname === 'api.clickup.com');
  assert(clickupCalls.length === 0, 'a disabled ClickUp org must not be fetched');
  const inboxWrites = r.calls.filter((c) => c.url.pathname === '/rest/v1/clickup_webhook_inbox' && c.method === 'PATCH');
  assert(inboxWrites.some((c) => c.body.includes('feature-off:clickup_sync') && c.body.includes('pending')),
    'the row must be left pending with its feature-off reason');
  const heldPatch = inboxWrites.map((call) => JSON.parse(call.body) as Record<string, unknown>)
    .find((patch) => patch.last_error === 'feature-off:clickup_sync');
  assert(typeof heldPatch?.processed_at === 'string', 'a hold records its latest attempt time so it can rotate behind fresh events');
});

Deno.test('FR-PLN-006 clickup_sync on proceeds to fetch and reconcile the queued webhook', async () => {
  const r = await runLiveFeatureWorker(true);
  assert((r.body as { processed: number }).processed === 1, 'an enabled org proceeds through normal row processing');
  assert(r.calls.some((c) => c.url.hostname === 'api.clickup.com' && c.url.pathname.endsWith('/task/task-1')),
    'the worker fetches the ClickUp task when the switch is on');
});
