import "../_shared/testing/publicErpDns.ts";

/**
 * Reposted vouchers [Deno, served] — drives the SHIPPED ledger feed (`feedOrgLedgersLive` from ./index.ts)
 * with a stubbed `fetch` (ERPNext) and an in-memory Supabase client.
 *
 * ERPNext's "Repost Accounting Ledger" re-creates a voucher's GL rows; a second repost hard-deletes the
 * first repost's rows. The mirror kept them live and the project's spend counted twice. The feed must
 * read the voucher's current full row set and hand it to `replace_erp_gl_voucher_rows`; a failed read
 * must change nothing.
 *
 * Verify: deno test supabase/functions/erpnext-sweep/ledgerVoucherReplace.test.ts --allow-all --config supabase/functions/erpnext-sweep/deno.json
 */
(Deno as unknown as { serve: (...a: unknown[]) => unknown }).serve = () => ({ finished: Promise.resolve() });
const { feedOrgLedgersLive } = await import('./index.ts');
import type { SupabaseClient } from '@supabase/supabase-js';

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}

const ORG = '00000000-0000-4000-8000-0000000000bb';
const COMPANY = 'Synthetic Co';
const JV = { voucher_type: 'Journal Entry', voucher_no: 'ACC-JV-2026-00070' };
const LINE = { ...JV, company: COMPANY, account: '519101 - Other Direct Expenses - SYN', project: 'PROJ-0004' };

type Row = Record<string, unknown>;

/** ERPNext after the second repost: the original (cancelled) and the second repost's rows. */
const ERP_CURRENT: Row[] = [
  { name: 'ACC-GLE-2026-00231', ...LINE, project: null, debit: 241999959, credit: 0, is_cancelled: 1, docstatus: 1, modified: '2026-10-25 07:37:41.941175' },
  { name: 'ACC-GLE-2026-01435', ...LINE, debit: 0, credit: 241999959, is_cancelled: 1, docstatus: 1, modified: '2026-10-25 08:32:12.248890' },
  { name: 'ACC-GLE-2026-01438', ...LINE, debit: 241999959, credit: 0, is_cancelled: 0, docstatus: 1, modified: '2026-10-25 08:32:12.251858' },
];

function mirrorAfterFirstRepost(): Row[] {
  return [
    { id: 'a1', org_id: ORG, erp_name: 'ACC-GLE-2026-00231', ...LINE, project: null, debit: '241999959', credit: '0', is_cancelled: true, erp_modified: '2026-10-25 07:37:41.941175' },
    { id: 'a2', org_id: ORG, erp_name: '90b076b758', ...LINE, debit: '0', credit: '241999959', is_cancelled: true, erp_modified: '2026-10-25 07:37:41.951217' },
    { id: 'a3', org_id: ORG, erp_name: '9a24980bf8', ...LINE, debit: '241999959', credit: '0', is_cancelled: false, erp_modified: '2026-10-25 07:37:57.013202' },
  ];
}

/** A minimal PostgREST-shaped store: the mirror scan, the watermark cursor, the binding stamp, the RPCs. */
function fakeDb(gl: Row[]) {
  const watermarks: Row[] = [
    { org_id: ORG, external_tier: 'erpnext', domain: 'ledger::GL Entry', watermark_cursor: '2026-10-25 07:37:57.013202' },
  ];
  const rpcs: Array<{ name: string; args: Row }> = [];
  const tables: Record<string, Row[]> = { erp_gl_entry_mirror: gl, erp_payment_ledger_mirror: [], external_sync_watermarks: watermarks, external_org_bindings: [] };

  const from = (table: string) => {
    const filters: Array<(r: Row) => boolean> = [];
    let op: 'select' | 'update' = 'select';
    let values: Row = {};
    let limit = Infinity;
    const rows = () => (tables[table] ?? []).filter((r) => filters.every((f) => f(r)));
    const run = () => {
      if (op === 'update') {
        const hit = rows();
        for (const r of hit) Object.assign(r, values);
        return { data: null, count: hit.length, error: null };
      }
      return { data: rows().sort((x, y) => String(x.id).localeCompare(String(y.id))).slice(0, limit), error: null };
    };
    const b: Record<string, unknown> = {
      select: () => b,
      update: (v: Row) => { op = 'update'; values = v; return b; },
      eq: (c: string, v: unknown) => { filters.push((r) => r[c] === v); return b; },
      lt: (c: string, v: string) => { filters.push((r) => String(r[c]) < v); return b; },
      gt: (c: string, v: string) => { filters.push((r) => String(r[c]) > v); return b; },
      order: () => b,
      limit: (n: number) => { limit = n; return b; },
      maybeSingle: () => Promise.resolve({ data: rows()[0] ?? null, error: null }),
      upsert: (incoming: Row | Row[]) => {
        for (const r of Array.isArray(incoming) ? incoming : [incoming]) {
          const store = tables[table];
          const at = table === 'external_sync_watermarks'
            ? store.findIndex((x) => x.org_id === r.org_id && x.domain === r.domain)
            : store.findIndex((x) => x.org_id === r.org_id && x.erp_name === r.erp_name);
          if (at === -1) store.push({ id: `u-${String(r.erp_name ?? r.domain)}`, ...r });
          else if (table !== 'external_sync_watermarks') Object.assign(store[at], r);
        }
        return Promise.resolve({ error: null });
      },
      then: (resolve: (v: unknown) => unknown) => resolve(run()),
    };
    return b;
  };

  const rpc = (name: string, args: Row) => {
    rpcs.push({ name, args });
    if (name === 'mark_erp_statement_replay_for_missing_accounts') return Promise.resolve({ data: false, error: null });
    if (name === 'replace_erp_gl_voucher_rows') {
      const store = tables.erp_gl_entry_mirror;
      for (const r of args.p_rows as Row[]) {
        const at = store.findIndex((x) => x.erp_name === r.erp_name);
        if (at === -1) store.push({ id: `r-${String(r.erp_name)}`, org_id: args.p_org_id, ...r });
        else Object.assign(store[at], r);
      }
      const current = new Set(args.p_current_names as string[]);
      tables.erp_gl_entry_mirror = store.filter((x) => !(x.voucher_no === args.p_voucher_no && !current.has(String(x.erp_name))));
      return Promise.resolve({ data: { deleted: store.length - tables.erp_gl_entry_mirror.length }, error: null });
    }
    return Promise.resolve({ data: null, error: null });
  };
  return { sc: { from, rpc } as unknown as SupabaseClient, tables, rpcs, watermarks };
}

/** ERPNext: the incremental GL batch re-delivers the second repost's rows; a voucher read returns its full set. */
function stubErp(voucherRead: () => Response) {
  const original = globalThis.fetch;
  const voucherReads: unknown[][] = [];
  globalThis.fetch = ((input: string | URL | Request) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    const doctype = decodeURIComponent(url.pathname.replace('/api/resource/', ''));
    const filters = JSON.parse(url.searchParams.get('filters') ?? '[]') as unknown[][];
    const json = (data: unknown) => new Response(JSON.stringify({ data }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    if (doctype === 'GL Entry') {
      if (filters.some(([c]) => c === 'voucher_no')) { voucherReads.push(filters); return Promise.resolve(voucherRead()); }
      return Promise.resolve(json(ERP_CURRENT.slice(1)));
    }
    if (doctype === 'Payment Ledger Entry') return Promise.resolve(json([]));
    return Promise.resolve(new Response('{"exc":"not in this test"}', { status: 403 }));
  }) as typeof fetch;
  return { voucherReads, restore: () => { globalThis.fetch = original; } };
}

const ORG_BINDING = { orgId: ORG, siteUrl: 'https://erp.example.test', secretRef: 'r', company: COMPANY, config: {}, ownedDomains: [], versionMajor: 15 };
const cache = () => new Map([[ORG, Promise.resolve({ apiKey: 'k', apiSecret: 's' })]]);
const liveProjectSpend = (rows: Row[]) => rows
  .filter((r) => r.project === 'PROJ-0004' && r.is_cancelled !== true)
  .reduce((s, r) => s + Number(r.debit ?? 0) - Number(r.credit ?? 0), 0);

Deno.test('a voucher reposted twice leaves exactly ERPNext\'s current rows, so the project spend counts once', async () => {
  const db = fakeDb(mirrorAfterFirstRepost());
  const erp = stubErp(() => new Response(JSON.stringify({ data: ERP_CURRENT }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
  try {
    const r = await feedOrgLedgersLive(db.sc, { ...ORG_BINDING }, cache());
    assert(r.glCaughtUp === true && !r.error, `feed must complete: ${r.error}`);
    const names = db.tables.erp_gl_entry_mirror.map((x) => String(x.erp_name)).sort();
    assert(JSON.stringify(names) === JSON.stringify(['ACC-GLE-2026-00231', 'ACC-GLE-2026-01435', 'ACC-GLE-2026-01438']), `mirror holds ${names}`);
    assert(liveProjectSpend(db.tables.erp_gl_entry_mirror) === 241999959, 'the project spend counts once');
    const replace = db.rpcs.find((c) => c.name === 'replace_erp_gl_voucher_rows');
    assert(replace?.args.p_company === COMPANY && replace?.args.p_voucher_no === JV.voucher_no, 'replace is scoped to the company + voucher');
    assert(JSON.stringify(erp.voucherReads[0]) === JSON.stringify([['company', '=', COMPANY], ['voucher_type', '=', JV.voucher_type], ['voucher_no', '=', JV.voucher_no]]),
      'the voucher read is company-scoped and carries no modified cursor');
    assert(db.watermarks[0].watermark_cursor === '2026-10-25 08:32:12.251858', 'the cursor advances past the batch');
  } finally {
    erp.restore();
  }
});

Deno.test('a failed voucher read removes nothing and keeps the cursor', async () => {
  const db = fakeDb(mirrorAfterFirstRepost());
  const erp = stubErp(() => new Response('{"exc":"denied"}', { status: 403 }));
  try {
    const r = await feedOrgLedgersLive(db.sc, { ...ORG_BINDING }, cache());
    assert(Boolean(r.error) && r.glCaughtUp === false, 'a failed voucher read surfaces as an incomplete feed');
    assert(db.tables.erp_gl_entry_mirror.length === 3, 'no mirror row was removed or added');
    assert(!db.rpcs.some((c) => c.name === 'replace_erp_gl_voucher_rows'), 'no replace ran');
    assert(db.watermarks[0].watermark_cursor === '2026-10-25 07:37:57.013202', 'the cursor did not move');
  } finally {
    erp.restore();
  }
});
