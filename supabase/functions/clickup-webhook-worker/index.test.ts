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
const {
  processInboxRow,
  resolveBindingLive,
  resolveOrgForTeam,
  runWorkerBatch,
  buildApplyDepsLive,
  claimPendingLive,
  markFailedLive,
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
      const query: any = {
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
      // deno-lint-ignore no-explicit-any
      const q: any = {
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

// ── runWorkerBatch — claim/process/mark bookkeeping. ────────────────────────────────────────────

function batchDeps(rows: InboxRow[], processRow: WorkerBatchDeps['processRow']): WorkerBatchDeps & {
  done: string[];
  failed: Array<{ id: string; error: string }>;
  unresolvable: Array<{ id: string; reason: string }>;
} {
  const done: string[] = [];
  const failed: Array<{ id: string; error: string }> = [];
  const unresolvable: Array<{ id: string; reason: string }> = [];
  return {
    claimPending: async () => rows,
    markDone: async (id) => {
      done.push(id);
    },
    markFailed: async (id, error) => {
      failed.push({ id, error });
    },
    markUnresolvable: async (id, reason) => {
      unresolvable.push({ id, reason });
    },
    processRow,
    done,
    failed,
    unresolvable,
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


// ── T-07 B3 · a lookup / vault FAILURE is not an absent binding ───────────────────────────────────
// A failed read fails the row (so it is retried) — it must never collapse into the acknowledged
// "unresolvable" no-op that permanently drops the event.

type PgErr = { message: string; code?: string };
const PG_DOWN: PgErr = { message: 'connection reset by peer', code: '08006' };

/** `external_org_bindings` + `read_vault_secret` stand-in for `resolveOrgForTeam`. */
function orgClient(opts: { binding?: { org_id: string; secret_ref: string | null } | null; bindingError?: PgErr; vault?: string | null; vaultError?: PgErr }) {
  return {
    from: () => {
      const q: any = { select: () => q, eq: () => q };
      q.maybeSingle = async () => ({ data: opts.binding ?? null, error: opts.bindingError ?? null });
      return q;
    },
    rpc: async () => ({ data: opts.vault ?? null, error: opts.vaultError ?? null }),
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
function fakeInbox(seed: Array<{ id: string; status: string; attempts: number; received_at: string }>, opts: { readError?: PgErr } = {}) {
  const rows = seed.map((r) => ({ event: 'taskUpdated', task_id: `t-${r.id}`, team_id: 'team-1', history_items: [], ...r }));
  const client = {
    from() {
      const eq: Array<[string, unknown]> = [];
      const lt: Array<[string, number]> = [];
      let patch: Record<string, unknown> | null = null;
      let ids: string[] | null = null;
      let order: string | null = null;
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
        if (order) out = [...out].sort((a, b) => String((a as Record<string, unknown>)[order!]).localeCompare(String((b as Record<string, unknown>)[order!])));
        return { data: out.slice(0, limit).map((r) => ({ ...r })), error: null };
      };
      const q: any = {
        select: () => q,
        eq: (c: string, v: unknown) => { eq.push([c, v]); return q; },
        lt: (c: string, v: number) => { lt.push([c, v]); return q; },
        in: (_c: string, v: string[]) => { ids = v; return q; },
        order: (c: string) => { order = c; return q; },
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
