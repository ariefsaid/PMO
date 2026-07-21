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
