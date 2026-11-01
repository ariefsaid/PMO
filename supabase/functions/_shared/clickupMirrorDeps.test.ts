// [Deno unit] — the SHARED ClickUp mirror-callback bag (`clickupMirrorDeps.ts`) binds the sync
// correctness rules every ClickUp apply path (webhook worker, multi-List sweep, onboarding) inherits:
//   • the mirror UPDATE is compare-and-set — the shipped update itself compares the incoming
//     source-modification against the STORED one and reports whether it applied, so an older change
//     arriving after a newer one is a no-op (never a silent overwrite);
//   • adoption is CLAIM-FIRST — the `external_refs` claim precedes the mirror mint, so the loser of a
//     concurrent webhook/sweep adopt writes NO mirror row at all (the ref insert refuses a duplicate);
//   • a claim whose mirror is missing (a crash between claim and mint) is repaired with the SAME
//     pre-claimed id on the next apply.
// Every test drives the real engine (`applyInboundChange`) through the real shipped callbacks against
// an in-memory PostgREST-shaped stand-in — the fake stands in for the DATABASE, never for shipped code.
//
// Verify: cd supabase/functions/clickup-webhook-worker && deno test ../_shared --config deno.json --allow-env --allow-net --allow-read
import type { SupabaseClient } from '@supabase/supabase-js';
import { AppError } from '../../../pmo-portal/src/lib/appError.ts';
import { applyInboundChange } from '../../../pmo-portal/src/lib/adapterSeam/applyEngine.ts';
import { createClickUpMirrorCallbacks } from './clickupMirrorDeps.ts';

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}

const ORG = '00000000-0000-4000-8000-0000000000c7';
const PROJECT = '00000000-0000-4000-8000-0000000000d1';
const CTX = { tier: 'clickup', domain: 'tasks' };

type Row = Record<string, unknown>;

const iso = (ms: number): string => new Date(ms).toISOString();

function taskRecord(name: string): Row {
  return { id: 'ignored-by-the-engine', name, status: 'To Do', assignee_id: null };
}

/** A minimal in-memory PostgREST-shaped client. Only the operations the shipped callbacks actually
 *  issue are modeled, and the DATABASE semantics are honored faithfully:
 *  - `external_refs` INSERT enforces the 0093 uniqueness on (org_id, domain, external_record_id) and
 *    (org_id, domain, pmo_record_id) — a duplicate claim surfaces as 23505;
 *  - an UPDATE's `.or(...)` predicate is applied to the stored rows, and the selected rows come back
 *    (an empty selection = the predicate matched nothing = the write applied 0 rows);
 *  - reads consult the optional `sourceModReadOverride` hook, so a test can replay the exact
 *    read-then-write race a concurrent webhook/sweep apply hits. */
function fakeMirrorDb(seed: { refs?: Row[]; tasks?: Row[] } = {}) {
  const refs: Row[] = seed.refs ?? [];
  const tasks: Row[] = seed.tasks ?? [];
  const watermarks: Row[] = [];
  const ops: string[] = [];
  let sourceModReadOverride: ((stored: string | null) => Promise<string | null>) | null = null;

  const client = {
    from(table: string) {
      const eqFilters: Array<[string, unknown]> = [];
      let orPredicate: string | null = null;
      let selecting = false;
      let op: 'select' | 'update' | 'insert' | 'upsert' = 'select';
      let patch: Row = {};
      let writeRow: Row = {};
      // deno-lint-ignore no-explicit-any
      const b: any = {
        select: (_cols?: string) => {
          selecting = true;
          return b;
        },
        eq: (column: string, value: unknown) => {
          eqFilters.push([column, value]);
          return b;
        },
        is: (column: string, value: null) => {
          eqFilters.push([column, value]);
          return b;
        },
        or: (predicate: string) => {
          orPredicate = predicate;
          return b;
        },
        update: (p: Row) => {
          op = 'update';
          patch = p;
          return b;
        },
        insert: (row: Row) => {
          op = 'insert';
          writeRow = row;
          return b;
        },
        upsert: (row: Row, _opts?: { onConflict: string }) => {
          op = 'upsert';
          writeRow = row;
          return b;
        },
        maybeSingle: () => {
          let row = tasks.find((r) => matchesEq(r)) ?? null;
          if (table === 'external_refs') row = refs.find((r) => matchesEq(r)) ?? null;
          if (table === 'external_sync_watermarks') row = watermarks.find((r) => matchesEq(r)) ?? null;
          let data = row;
          if (table === 'tasks' && selecting && op === 'select' && sourceModReadOverride && row) {
            return Promise.resolve(sourceModReadOverride((row as Row).source_updated_at as string | null)).then(
              (overridden) => ({ data: { ...row, source_updated_at: overridden }, error: null }),
            );
          }
          return Promise.resolve({ data, error: null });
        },
        then: (
          resolve: (value: unknown) => unknown,
          reject: (reason?: unknown) => unknown,
        ) => {
          Promise.resolve(runStatement()).then(resolve, reject);
        },
      };

      const matchesEq = (row: Row) => eqFilters.every(([c, v]) => row[c] === v);

      const matchesOr = (row: Row): boolean => {
        if (!orPredicate) return true;
        return orPredicate.split(',').some((cond) => {
          const firstDot = cond.indexOf('.');
          const secondDot = cond.indexOf('.', firstDot + 1);
          const column = cond.slice(0, firstDot);
          const comparator = cond.slice(firstDot + 1, secondDot);
          const value = cond.slice(secondDot + 1);
          if (comparator === 'is') return (row[column] ?? null) === null;
          if (comparator === 'lte') {
            const stored = row[column];
            if (stored === null || stored === undefined) return false;
            return String(stored) <= value;
          }
          throw new Error(`fake db: unsupported or condition "${cond}"`);
        });
      };

      const runStatement = (): { data: unknown; error: { message: string; code?: string } | null } => {
        if (op === 'select') {
          const rows = table === 'tasks' ? tasks : table === 'external_refs' ? refs : watermarks;
          const matches = rows.filter((r) => matchesEq(r) && matchesOr(r));
          return { data: matches, error: null };
        }
        if (op === 'update') {
          const matches = tasks.filter((r) => matchesEq(r) && matchesOr(r));
          for (const r of matches) Object.assign(r, patch);
          ops.push(`update:tasks:${matches.length}`);
          return { data: matches.map((r) => ({ id: r.id })), error: null };
        }
        if (op === 'insert') {
          if (table === 'external_refs') {
            const dup = refs.some(
              (r) =>
                (r.org_id === writeRow.org_id && r.domain === writeRow.domain && r.external_record_id === writeRow.external_record_id) ||
                (r.org_id === writeRow.org_id && r.domain === writeRow.domain && r.pmo_record_id === writeRow.pmo_record_id),
            );
            if (dup) {
              return { data: null, error: { message: 'duplicate key value violates unique constraint', code: '23505' } };
            }
            refs.push({ ...writeRow });
            ops.push('insert:external_refs');
            return { data: null, error: null };
          }
          if (tasks.some((r) => r.id === writeRow.id)) {
            return { data: null, error: { message: 'duplicate key value violates unique constraint', code: '23505' } };
          }
          tasks.push({ ...writeRow });
          ops.push('insert:tasks');
          return { data: null, error: null };
        }
        // upsert
        const rows = table === 'external_refs' ? refs : watermarks;
        const conflictCols = String(writeRow.org_id !== undefined ? 'org_id' : '');
        void conflictCols;
        const existing = rows.find(
          (r) => r.org_id === writeRow.org_id && r.domain === writeRow.domain && r.external_tier === writeRow.external_tier,
        );
        if (existing) Object.assign(existing, writeRow);
        else rows.push({ ...writeRow });
        ops.push(`upsert:${table}`);
        return { data: null, error: null };
      };

      return b;
    },
    __state: {
      get ops() {
        return [...ops];
      },
      get refs() {
        return refs;
      },
      get tasks() {
        return tasks;
      },
    },
    __setSourceModReadOverride: (hook: ((stored: string | null) => Promise<string | null>) | null) => {
      sourceModReadOverride = hook;
    },
  };
  return client as unknown as SupabaseClient & {
    __state: { ops: string[]; refs: Row[]; tasks: Row[] };
    __setSourceModReadOverride: (hook: ((stored: string | null) => Promise<string | null>) | null) => void;
  };
}

function mirrorTaskRow(pmoRecordId: string, sourceModMs: number): Row {
  return {
    id: pmoRecordId,
    org_id: ORG,
    project_id: PROJECT,
    name: 'Mirrored task',
    status: 'To Do',
    source_updated_at: iso(sourceModMs),
  };
}

function mappedRef(externalRecordId: string, pmoRecordId: string): Row {
  return { org_id: ORG, domain: 'tasks', external_record_id: externalRecordId, external_tier: 'clickup', pmo_record_id: pmoRecordId };
}

// ── ADP-001 · THEME-DATA-04 — the mirror update is compare-and-set. ───────────────────────────────

Deno.test('mirror update is compare-and-set: an older source-mod arriving after a newer one applies nothing', async () => {
  const db = fakeMirrorDb({ tasks: [mirrorTaskRow('pmo-1', 1500)] });
  const callbacks = createClickUpMirrorCallbacks({ serviceClient: db, orgId: ORG, projectId: PROJECT });

  const appliedNewer = await callbacks.updateMirror('pmo-1', taskRecord('Newer name') as never, 2000);
  assert(appliedNewer === true, 'a newer (and an equal) source-mod must apply');
  assert(db.__state.tasks[0].source_updated_at === iso(2000), 'the newer state must be stored');

  const appliedOlder = await callbacks.updateMirror('pmo-1', taskRecord('Older name') as never, 1000);
  assert(appliedOlder === false, 'an OLDER source-mod must lose the compare-and-set (apply nothing)');
  assert(db.__state.tasks[0].source_updated_at === iso(2000), 'the stored state must stay the newer one');
  assert(db.__state.tasks[0].name === 'Newer name', 'an older change must never overwrite newer mirror fields');

  const appliedEqual = await callbacks.updateMirror('pmo-1', taskRecord('Newer name') as never, 2000);
  assert(appliedEqual === true, 're-delivery of the SAME source-mod re-applies idempotently (the engine\'s >= semantics)');
});

Deno.test('an interleaved older apply (its read predating a newer write) is a no-op end-to-end through the engine', async () => {
  const db = fakeMirrorDb({ refs: [mappedRef('cu-1', 'pmo-1')], tasks: [mirrorTaskRow('pmo-1', 1000)] });
  const callbacks = createClickUpMirrorCallbacks({ serviceClient: db, orgId: ORG, projectId: PROJECT });

  // The newer change applies first.
  const newer = await applyInboundChange(CTX, 'cu-1', taskRecord('Newer name') as never, 2000, callbacks);
  assert(newer.kind === 'upserted', `the newer change must apply, got ${newer.kind}`);

  // The older change raced through its mirror read BEFORE the newer write landed — both appliers saw
  // the same stored timestamp. Replay that stale read, then let the older write hit the CAS.
  db.__setSourceModReadOverride(() => Promise.resolve(iso(1000)));
  const older = await applyInboundChange(CTX, 'cu-1', taskRecord('Older name') as never, 1500, callbacks);
  db.__setSourceModReadOverride(null);

  assert(older.kind === 'no-op', `the stale apply must be a no-op, got ${JSON.stringify(older)}`);
  assert(db.__state.tasks[0].source_updated_at === iso(2000), 'the stored state must stay the newer one');
  assert(db.__state.tasks[0].name === 'Newer name', 'mirror fields must stay the newer state');
  assert(db.__state.ops.every((o) => !o.startsWith('insert:')), 'a stale apply must never mint');
});

Deno.test('concurrent apply of older and newer through the shipped callbacks stores the newest state', async () => {
  const db = fakeMirrorDb({ refs: [mappedRef('cu-1', 'pmo-1')], tasks: [mirrorTaskRow('pmo-1', 1000)] });
  const callbacks = createClickUpMirrorCallbacks({ serviceClient: db, orgId: ORG, projectId: PROJECT });

  // Both appliers read the SAME stored timestamp (the read-then-write race), then both writes run —
  // the compare-and-set must leave the newest state stored regardless of completion order.
  let readers = 0;
  let releaseReaders: () => void = () => {};
  const bothRead = new Promise<void>((resolve) => {
    releaseReaders = resolve;
  });
  db.__setSourceModReadOverride((stored) => {
    readers += 1;
    if (readers === 2) releaseReaders();
    return bothRead.then(() => stored);
  });

  const outcomes = await Promise.all([
    applyInboundChange(CTX, 'cu-1', taskRecord('From A') as never, 2000, callbacks),
    applyInboundChange(CTX, 'cu-1', taskRecord('From B') as never, 1500, callbacks),
  ]);
  db.__setSourceModReadOverride(null);

  assert(db.__state.tasks.length === 1, 'a mirror update must never mint a second row');
  assert(db.__state.tasks[0].source_updated_at === iso(2000), `the newest state must win, got ${db.__state.tasks[0].source_updated_at}`);
  const newerOutcome = outcomes.find((o) => o.kind !== 'no-op' && o.kind === 'upserted');
  assert(newerOutcome !== undefined, 'the newer apply must report upserted');
});

// ── ADP-002 + FN1-005 · THEME-DATA-05 / THEME-BACK-12 — claim-first adoption. ─────────────────────

Deno.test('adoption is claim-first: the external_refs claim precedes the mirror mint and shares one id', async () => {
  const db = fakeMirrorDb();
  const callbacks = createClickUpMirrorCallbacks({ serviceClient: db, orgId: ORG, projectId: PROJECT });

  const outcome = await applyInboundChange(CTX, 'cu-new', taskRecord('Adopted task') as never, 5000, callbacks);

  assert(outcome.kind === 'upserted' && outcome.adopted, 'an unmapped task must be adopted');
  assert(db.__state.ops[0] === 'insert:external_refs', `the CLAIM must precede the mint, ops=${db.__state.ops.join(',')}`);
  assert(db.__state.ops[1] === 'insert:tasks', `the mirror mint must follow the claim, ops=${db.__state.ops.join(',')}`);
  assert(db.__state.refs.length === 1 && db.__state.tasks.length === 1, 'exactly one ref + one mirror');
  assert(db.__state.refs[0].pmo_record_id === db.__state.tasks[0].id, 'the mirror must carry the pre-claimed id');
  assert(db.__state.tasks[0].project_id === PROJECT, 'the mirror lands in the ctx project');
});

Deno.test('concurrent adoption mints ONE mirror — the losing claim surfaces 23505 and writes no mirror row', async () => {
  const db = fakeMirrorDb();
  const webhookCallbacks = createClickUpMirrorCallbacks({ serviceClient: db, orgId: ORG, projectId: PROJECT });
  const sweepCallbacks = createClickUpMirrorCallbacks({ serviceClient: db, orgId: ORG, projectId: PROJECT });

  // The webhook worker and the multi-List sweep adopt the SAME unmapped ClickUp task concurrently:
  // both claims run against the one external_refs unique constraint — exactly one wins, and the loser
  // (23505) must have written NO mirror row (pre-claim-first, the loser's orphan mirror stayed
  // visible forever and was unreachable by later updates).
  const results = await Promise.allSettled([
    applyInboundChange(CTX, 'cu-race', taskRecord('Winner') as never, 5000, webhookCallbacks),
    applyInboundChange(CTX, 'cu-race', taskRecord('Loser') as never, 5000, sweepCallbacks),
  ]);

  const fulfilled = results.filter((r) => r.status === 'fulfilled') as PromiseFulfilledResult<Awaited<ReturnType<typeof applyInboundChange>>>[];
  const rejected = results.filter((r) => r.status === 'rejected') as { reason: unknown }[];
  assert(fulfilled.length === 1 && rejected.length === 1, `expected one winner + one loser, got ${results.map((r) => r.status).join(',')}`);
  assert(
    (rejected[0].reason as AppError).code === '23505',
    `the loser must surface the claim's 23505, got ${(rejected[0].reason as AppError)?.code}`,
  );
  assert(fulfilled[0].value.kind === 'upserted' && fulfilled[0].value.adopted, 'the winner must report an adopt');
  assert(db.__state.tasks.length === 1, `exactly ONE mirror row may exist, got ${db.__state.tasks.length}`);
  assert(db.__state.refs.length === 1, 'exactly one ref claim wins');
  assert(db.__state.refs[0].pmo_record_id === db.__state.tasks[0].id, 'the surviving mirror carries the winning claim id');
});

Deno.test('a claim whose mirror is missing (crash between claim and mint) is repaired with the SAME id', async () => {
  // The ref was claimed, then the process died before the mint: mapped lookup finds the ref, the
  // mirror row does not exist. The next apply must re-mint with the SAME pre-claimed id (never a
  // duplicate under a fresh id) and must NOT re-claim the ref.
  const db = fakeMirrorDb({ refs: [mappedRef('cu-crash', 'pmo-claimed-1')], tasks: [] });
  const callbacks = createClickUpMirrorCallbacks({ serviceClient: db, orgId: ORG, projectId: PROJECT });

  const outcome = await applyInboundChange(CTX, 'cu-crash', taskRecord('Repaired task') as never, 6000, callbacks);

  assert(outcome.kind === 'upserted' && outcome.adopted, `expected a repair-adopt, got ${JSON.stringify(outcome)}`);
  assert(outcome.kind === 'upserted' && outcome.pmoRecordId === 'pmo-claimed-1', 'the repair must reuse the SAME pre-claimed id');
  assert(db.__state.tasks.length === 1 && db.__state.tasks[0].id === 'pmo-claimed-1', 'the mirror is minted under the claimed id');
  assert(db.__state.refs.length === 1, 'the existing claim is reused, never re-inserted');
  assert(db.__state.tasks[0].source_updated_at === iso(6000), 'the repair stamps the inbound source-modification');
});

Deno.test('the strategy mint honors a project_id on the canonical record (the per-task sweep resolution)', async () => {
  const db = fakeMirrorDb();
  const callbacks = createClickUpMirrorCallbacks({ serviceClient: db, orgId: ORG }); // NO ctx project — the sweep resolves per task
  const canonical = { ...taskRecord('Sweep adopt'), project_id: 'proj-from-sweep' } as never;

  await callbacks.adoptAtomically.mintWithId(canonical, 7000, 'pmo-sweep-1');

  assert(db.__state.tasks.length === 1, 'the mint inserts the mirror');
  assert(db.__state.tasks[0].project_id === 'proj-from-sweep', 'the canonical project_id wins over an absent ctx project');

  let threw: unknown;
  try {
    await callbacks.adoptAtomically.mintWithId(taskRecord('No project anywhere') as never, 7000, 'pmo-sweep-2');
  } catch (err) {
    threw = err;
  }
  assert(threw instanceof AppError, 'a mint with no project anywhere must refuse');
});
