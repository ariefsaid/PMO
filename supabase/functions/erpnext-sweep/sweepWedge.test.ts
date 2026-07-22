/**
 * HIGH-A (Luna re-audit round 2, 2026-07-21) [Deno] — ONE Desk-created document must never WEDGE the
 * poll, and one doctype's failure must never abandon the org's remaining doctypes.
 *
 * The defect, end to end: an accountant creates a `Budget` (or a `Timesheet`) directly in the ERPNext
 * Desk — the EXPECTED scenario FR-BUD-140 / FR-TSP-082 exist for. `mintMirrorRow` throws
 * `native-budget-not-adopted` by design; `runSweep` had no per-change catch, so the throw escaped
 * BEFORE `advanceWatermarkMonotonic` and the watermark never moved. The same document is first in the
 * next tick's page (`order_by modified asc`), so the poll was wedged FOREVER: a later Desk CANCEL of a
 * genuinely PMO-pushed Budget sat behind it and never applied — FR-BUD-142 never fired, `push_state`
 * stayed `'pushed'`, and ERPNext enforced no budget while PMO reported the version pushed and Active.
 * `sweepOrgDoctypesLive` compounded it by `return`ing (not `continue`ing) on one doctype's failure.
 *
 * These tests drive the LIVE poll (the shipped `sweepOrgDoctypesLive`) with a stubbed `fetch` + a fake
 * Supabase client, exactly like `companyScopedSweep.test.ts`.
 *
 * Verify: deno test supabase/functions/erpnext-sweep/ --config supabase/functions/erpnext-sweep/deno.json
 */
(Deno as unknown as { serve: (...a: unknown[]) => unknown }).serve = () => ({ finished: Promise.resolve() });
const { sweepOrgDoctypesLive } = await import('./index.ts');
import type { SupabaseClient } from '@supabase/supabase-js';

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}

const ORG = '00000000-0000-4000-8000-0000000000aa';
const OURS = 'PMO Smoke Co';
const SECRET_REF = 'wedge-bench';

function stubEnv() {
  const original = Deno.env.get;
  const values: Record<string, string> = { WEDGE_BENCH_KEY: 'k', WEDGE_BENCH_SECRET: 's' };
  (Deno.env as unknown as { get: (k: string) => string | undefined }).get = (k: string) => values[k];
  return { restore: () => { (Deno.env as unknown as { get: unknown }).get = original; } };
}

function orgBinding(ownedDomains: string[]) {
  return { orgId: ORG, siteUrl: 'https://erp.example.test', secretRef: SECRET_REF, company: OURS, config: {}, ownedDomains, versionMajor: 15 };
}

interface DbOp { table: string; op: string; payload?: unknown }

/** A Supabase stand-in recording every (table, op) so the watermark ADVANCE itself is observable. */
function fakeDb() {
  const ops: DbOp[] = [];
  const empty = { data: [] as unknown[], error: null };
  const client = {
    from(table: string) {
      // deno-lint-ignore no-explicit-any
      const builder: any = {
        select: () => { ops.push({ table, op: 'select' }); return builder; },
        eq: () => builder,
        in: () => builder,
        is: () => builder,
        not: () => builder,
        order: () => builder,
        contains: () => builder,
        insert: (payload: unknown) => { ops.push({ table, op: 'insert', payload }); return Promise.resolve({ data: null, error: null }); },
        update: (payload: unknown) => { ops.push({ table, op: 'update', payload }); return builder; },
        upsert: (payload: unknown) => { ops.push({ table, op: 'upsert', payload }); return Promise.resolve({ data: null, error: null }); },
        limit: () => Promise.resolve(empty),
        maybeSingle: () => Promise.resolve({ data: null, error: null }),
        then: (resolve: (v: unknown) => void) => resolve(empty),
      };
      return builder;
    },
    rpc: () => Promise.resolve({ data: null, error: null }),
  };
  return { client: client as unknown as SupabaseClient, ops };
}

/** Serves one page per doctype; a doctype listed in `failing` answers with a hard 403 instead. */
function stubErpFetch(docsByDoctype: Record<string, Array<Record<string, unknown>>>, failing: string[] = []) {
  const original = globalThis.fetch;
  const urls: string[] = [];
  globalThis.fetch = ((input: string | URL | Request) => {
    const url = String(input instanceof Request ? input.url : input);
    urls.push(url);
    const doctype = decodeURIComponent(url.split('/api/resource/')[1]?.split('?')[0] ?? '');
    if (failing.includes(doctype)) {
      return Promise.resolve(new Response(JSON.stringify({ message: 'forbidden' }), { status: 403 }));
    }
    return Promise.resolve(
      new Response(JSON.stringify({ data: docsByDoctype[doctype] ?? [] }), { status: 200, headers: { 'content-type': 'application/json' } }),
    );
  }) as typeof fetch;
  return {
    urls,
    polled: (doctype: string) => urls.some((u) => u.includes(`/api/resource/${encodeURIComponent(doctype)}?`)),
    restore: () => { globalThis.fetch = original; },
  };
}

const deskBudget = (name: string) => ({
  name, company: OURS, modified: '2026-07-20 10:00:00', docstatus: 1, amended_from: null, fiscal_year: '2026',
});

Deno.test('HIGH-A: a Desk-created Budget is ACKED and SKIPPED — the watermark still ADVANCES (the poll is not wedged)', async () => {
  const db = fakeDb();
  const env = stubEnv();
  const erp = stubErpFetch({ Budget: [deskBudget('BUDGET-DESK-001')] });
  try {
    const result = await sweepOrgDoctypesLive(db.client, orgBinding(['budget']));
    assert(result.error === undefined, `a never-adopt document is an EXPECTED outcome, not a sweep failure: ${result.error}`);
    assert(result.applied === 0, 'nothing is adopted from a Desk-created Budget (FR-BUD-140)');
    const advance = db.ops.find((o) => o.table === 'external_sync_watermarks' && o.op === 'upsert');
    assert(
      !!advance,
      'HIGH-A: the watermark MUST advance past a never-adopt document — otherwise every later change '
        + '(including a Desk CANCEL of a PMO-pushed Budget) is queued behind it forever',
    );
    assert(
      // The ERP cursor IS the `modified` datetime string the next tick sends back as
      // `["modified",">=",cursor]` — never an epoch-ms coercion (which persisted the literal 'NaN').
      (advance!.payload as { watermark_cursor?: string }).watermark_cursor === '2026-07-20 10:00:00',
      `expected the cursor to move to the page max, got ${JSON.stringify(advance!.payload)}`,
    );
  } finally {
    erp.restore();
    env.restore();
  }
});

Deno.test('HIGH-A: one doctype failing does NOT abandon the org\'s remaining doctypes this tick', async () => {
  const db = fakeDb();
  const env = stubEnv();
  // A timesheets+budget org polls Timesheet, Employee, then Budget. The Timesheet poll is refused.
  const erp = stubErpFetch({ Employee: [], Budget: [] }, ['Timesheet']);
  try {
    const result = await sweepOrgDoctypesLive(db.client, orgBinding(['timesheets', 'budget']));
    assert(!!result.error, 'the failing doctype must still be REPORTED, never swallowed');
    assert(erp.polled('Employee'), 'HIGH-A: the Employee poll must still run after the Timesheet poll failed');
    assert(erp.polled('Budget'), 'HIGH-A: the Budget poll must still run — a money-control push depends on it');
  } finally {
    erp.restore();
    env.restore();
  }
});

Deno.test('HIGH-A: a transient failure INSIDE the apply still halts that doctype (no silent skip past a lost change)', async () => {
  const env = stubEnv();
  const erp = stubErpFetch({ Budget: [deskBudget('BUDGET-DESK-002')] });
  const db = fakeDb();
  // The superseded-name lineage read (the apply's first DB touch) fails transiently.
  const original = db.client.from.bind(db.client);
  (db.client as unknown as { from: (t: string) => unknown }).from = (table: string) => {
    if (table === 'external_ref_lineage') {
      // deno-lint-ignore no-explicit-any
      const b: any = {
        select: () => b, eq: () => b, limit: () => Promise.resolve({ data: null, error: { message: 'connection terminated', code: '08006' } }),
      };
      return b;
    }
    return original(table);
  };
  try {
    const result = await sweepOrgDoctypesLive(db.client, orgBinding(['budget']));
    assert(!!result.error, 'a transient DB failure must surface as a sweep error');
    assert(
      !db.ops.some((o) => o.table === 'external_sync_watermarks' && o.op === 'upsert'),
      'a transient failure must NOT advance the watermark — the change has to be re-listed next tick',
    );
  } finally {
    erp.restore();
    env.restore();
  }
});

// ── NEW-2/NEW-5 (audit r4): pass 1 must NOT drive `budget` — pass 5 owns it ────────────────────────
// `reconcileOrgOutbox` re-checks only the actor's role. The budget domain's OTHER precondition — the
// version is STILL Active with its stamp (FR-BUD-102) — lives solely in `budgetBackstop.ts`. So a
// budget row replayed here bypasses that gate entirely. Concrete: v2's push fails while ERP is down, a
// PM activates v3, ERP returns; `outbox_reconcile_candidates` has NO ORDER BY, so v2 can replay first
// and leave ERPNext enforcing the ARCHIVED version's figures. Driving it twice per tick also burns
// 0131's 5-attempt auto-recovery budget at 2x.
Deno.test('NEW-2 reconcileOrgOutbox SKIPS budget candidates (pass 5 owns them, with the version gate)', async () => {
  const { reconcileOrgOutbox } = await import('./index.ts');
  const dispatched: string[] = [];
  const candidates = [
    { id: 'ob-budget', domain: 'budget', pmoRecordId: 'v2', idempotencyKey: 'bud:v2:1', state: 'failed', externalRecordId: null, canonical: null, claimGeneration: 0, payloadDigest: null },
    { id: 'ob-revenue', domain: 'revenue', pmoRecordId: 'si1', idempotencyKey: 'k2', state: 'failed', externalRecordId: null, canonical: null, claimGeneration: 0, payloadDigest: null },
  ];
  const result = await reconcileOrgOutbox(
    async () => candidates as never,
    { orgId: 'org-1', ownedDomains: ['budget', 'revenue'] },
    (async (c: { id: string }) => ({ id: c.id })) as never,
    (async (d: { id: string }) => { dispatched.push(d.id); }) as never,
  );
  assert(
    !dispatched.includes('ob-budget'),
    'NEW-2: pass 1 must NOT drive a budget row — it would bypass the still-Active version gate and can push an ARCHIVED version\'s figures',
  );
  assert(dispatched.includes('ob-revenue'), 'every other domain must still be reconciled by pass 1');
  assert(result.reconciled === 1, `expected exactly one non-budget reconcile, got ${result.reconciled}`);
});

// ── P3b task 6.4: pass 1 must NOT drive `timesheets` either — the new pass 6 owns it ──────────────
// The decision, made on evidence rather than by analogy with budget (the two differ in one important
// way, and it is worth being precise about which argument actually carries):
//
//  (1) THE UNCONDITIONAL ARGUMENT — the attempt budget. My backstop drives exactly the rows
//      `outbox_reconcile_candidates` admits, which is the SAME set pass 1 drives. Leaving `timesheets`
//      in pass 1 means every candidate is driven TWICE per tick, burning `0131`'s 5-attempt
//      auto-recovery budget at 2x — so a push that ERP would have accepted on attempt 4 is abandoned
//      after two ticks instead of five. This argument holds today, unconditionally, on its own.
//
//  (2) THE GATE ARGUMENT — pass 1 never calls `approved_timesheet_for_push` at all, so it re-asserts
//      NONE of 0138's preconditions. Unlike budget, that is not currently EXPLOITABLE via status:
//      `transition_timesheet`'s map makes `Approved` TERMINAL (`'Approved' -> []`, mig 0007), so an
//      approval cannot be revoked and a frozen payload cannot become unapproved behind pass 1's back.
//      ⚑ But that safety is a property of a DIFFERENT migration that P3b does not own, and the
//      correction path that would break it is explicitly ANTICIPATED and OPEN (OQ-TSP-6, cited by the
//      desk-cancel branch in `_shared/erpnextFeedDeps.ts`). The day `Approved -> Rejected` is added for
//      corrections, a `timesheets` row left in pass 1 silently posts payroll-costing hours that a human
//      un-approved. Making pass 6 the sole owner NOW means that change cannot reintroduce the hole.
//
// So: skipped here, and 0138's gate is re-asserted by exactly one pass.
Deno.test('task 6.4 reconcileOrgOutbox SKIPS timesheets candidates (pass 6 owns them, with the 0138 approval gate)', async () => {
  const { reconcileOrgOutbox } = await import('./index.ts');
  const dispatched: string[] = [];
  const candidates = [
    { id: 'ob-timesheet', domain: 'timesheets', pmoRecordId: 'ts1', idempotencyKey: 'ts:ts1:2026-07-19T02:55:21.340995+00:00', state: 'failed', externalRecordId: null, canonical: null, claimGeneration: 0, payloadDigest: null },
    { id: 'ob-budget', domain: 'budget', pmoRecordId: 'v2', idempotencyKey: 'bud:v2:1', state: 'failed', externalRecordId: null, canonical: null, claimGeneration: 0, payloadDigest: null },
    { id: 'ob-procurement', domain: 'procurement', pmoRecordId: 'pi1', idempotencyKey: 'k3', state: 'failed', externalRecordId: null, canonical: null, claimGeneration: 0, payloadDigest: null },
  ];
  const result = await reconcileOrgOutbox(
    async () => candidates as never,
    { orgId: 'org-1', ownedDomains: ['timesheets', 'budget', 'procurement'] },
    (async (c: { id: string }) => ({ id: c.id })) as never,
    (async (d: { id: string }) => { dispatched.push(d.id); }) as never,
  );
  assert(
    !dispatched.includes('ob-timesheet'),
    'task 6.4: pass 1 must NOT drive a timesheets row — it re-asserts none of 0138\'s gate and double-burns the 0131 attempt budget',
  );
  assert(dispatched.includes('ob-procurement'), 'every other domain must still be reconciled by pass 1');
  assert(result.reconciled === 1, `expected exactly one non-owned-elsewhere reconcile, got ${result.reconciled}`);
});
