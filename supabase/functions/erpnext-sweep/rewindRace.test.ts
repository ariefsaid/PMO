import "../_shared/testing/publicErpDns.ts";

/**
 * #1607 [Deno] — a party link rewinds the revenue cursor; a tick already in flight must not write its older cursor over the rewind.
 * Every cursor write of the LIVE poll (the shipped `sweepOrgDoctypesLive`) states the cursor the tick read when it began
 * (`expected_cursor`); the database keeps the stored cursor when that has moved (pgTAP: odoo_revenue_cursor_rewind).
 *
 * Verify: deno test supabase/functions/erpnext-sweep/ --config supabase/functions/erpnext-sweep/deno.json
 */
const PRIOR = '2026-07-01 00:00:00.000000|BUDGET-OLD';
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
        upsert: (payload: unknown) => {
          ops.push({ table, op: 'upsert', payload });
          const cursor = (payload as { watermark_cursor?: string | null }).watermark_cursor;
          const error = table === 'external_sync_watermarks' && cursor === null
            ? { code: '23502', message: 'null value in column "watermark_cursor" violates not-null constraint' }
            : null;
          return Promise.resolve({ data: null, error });
        },
        limit: () => Promise.resolve(empty),
        maybeSingle: () => Promise.resolve({ data: table === 'external_sync_watermarks' ? { watermark_cursor: PRIOR } : null, error: null }),
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


Deno.test('#1607: every cursor write states the cursor the tick began with', async () => {
  const db = fakeDb();
  const env = stubEnv();
  const erp = stubErpFetch({ Budget: [{ name: 'BUDGET-DESK-002', company: OURS, modified: '2026-07-20 10:00:00', docstatus: 1, amended_from: null, fiscal_year: '2026' }] });
  try {
    await sweepOrgDoctypesLive(db.client, orgBinding(['budget']));
    const writes = db.ops.filter((o) => o.table === 'external_sync_watermarks' && o.op === 'upsert')
      .map((o) => o.payload as { watermark_cursor?: string; expected_cursor?: string });
    const advance = writes.find((p) => p.watermark_cursor === '2026-07-20 10:00:00.000000|BUDGET-DESK-002');
    assert(!!advance, 'the cursor advanced');
    assert(advance!.expected_cursor === PRIOR, `the advance must state the cursor the tick began with, got ${advance!.expected_cursor}`);
    assert(writes.every((p) => p.expected_cursor === PRIOR || p.expected_cursor === advance!.watermark_cursor), 'no write is without an expectation');
    assert(writes[0].expected_cursor === PRIOR, 'the attempt stamp at tick start states it too');
  } finally {
    erp.restore();
    env.restore();
  }
});
