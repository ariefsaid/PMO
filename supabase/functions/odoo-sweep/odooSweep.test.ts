/**
 * AC-ODC-025 — one org's Odoo sweep (`_shared/odooSweep.ts`; tested here, its first consumer, because CI runs `_shared`
 * tests under an import map without the edge test kit). Supabase is mocked over fetch with an in-memory cursor store
 * that only the RPCs write; Odoo is the in-memory fake.
 */
import { afterAll, describe, it } from '@std/testing/bdd';
import { assert, assertEquals, assertRejects } from '@std/assert';
import { createClient } from '@supabase/supabase-js';
import { installEdgeEnv, jsonResponse, rpcCall, supabaseRpc, supabaseSelect, withFetchMock, type FetchCall, type MockRoute } from '../_shared/testing/edgeTestKit.ts';
import { ODOO_SWEEP_TICK_MAX_CALLS, sweepOdooOrg } from '../_shared/odooSweep.ts';
import { createFakeOdoo, type FakeOdoo } from '../../../pmo-portal/src/lib/adapterSeam/odoo/fakeOdoo.ts';
import type { ConnectionRecord } from '../../../pmo-portal/src/lib/adapterSeam/odoo/connectionState.ts';

const env = installEdgeEnv();
// The pacer can only slow a client down, so tests skip its waits by firing timers at once.
const realSetTimeout = globalThis.setTimeout;
globalThis.setTimeout = ((fn: () => void) => { queueMicrotask(fn); return 0; }) as unknown as typeof setTimeout;
afterAll(() => { env.restore(); globalThis.setTimeout = realSetTimeout; });

const ORG = '0d000000-0000-4000-8000-000000000004';
const ODOO = 'odoo.example.test';
const KEY = 'stored-odoo-key';
const FRESH = new Date().toISOString();
const binding = (over: Record<string, unknown> = {}) => ({
  site_url: `https://${ODOO}`, secret_ref: 'odoo_ref', status: 'active', activated_at: '2026-11-01T00:00:00Z',
  config: { database: 'db1', odoo_company_id: 1, capabilities: { observed_at: FRESH, missing: [], models: {} } }, ...over,
});

interface Opts { binding?: Record<string, unknown>; lock?: { held: boolean }; applyError?: boolean; rejectAfter?: number; version?: number | null; prepare?: (f: FakeOdoo) => void }

function harness(o: Opts = {}) {
  const fake = createFakeOdoo({ key: KEY });
  fake.seed('res.company', [{ id: 1, name: 'Main Co', currency_id: [12, 'IDR'] }]);
  fake.seed('product.product', [{ id: 1, name: 'Semen', default_code: 'S1', company_id: false }]);
  fake.seed('account.account', [{ id: 1, name: 'Payable', code: '2100', account_type: 'liability_payable', company_ids: [1] }]);
  o.prepare?.(fake);
  const cursors = new Map<string, string>();
  const lock = o.lock ?? { held: false };
  let odooCalls = 0;
  const routes: MockRoute[] = [
    supabaseRpc('claim_erp_sweep_lock', () => { const ok = !lock.held; lock.held = true; return jsonResponse(ok); }),
    supabaseRpc('release_erp_sweep_lock', () => { lock.held = false; return jsonResponse(true); }),
    supabaseSelect('external_org_bindings', () => jsonResponse([o.binding ?? binding()])),
    supabaseRpc('read_vault_secret', () => jsonResponse(KEY)),
    supabaseSelect('external_sync_watermarks', (c) => {
      const v = cursors.get(c.url.searchParams.get('domain')!.replace(/^eq\./, ''));
      return jsonResponse(v === undefined ? [] : [{ watermark_cursor: v }]);
    }),
    supabaseRpc('apply_odoo_master_page', (c) => {
      if (o.applyError) return jsonResponse({ code: 'P0001', message: 'x' }, { status: 400 });
      const b = c.bodyJson as { p_kind: string; p_rows: unknown[]; p_cursor: string };
      cursors.set(`master:${b.p_kind}`, b.p_cursor);
      return jsonResponse(b.p_rows.length);
    }),
    supabaseRpc('mark_odoo_census_seen', () => jsonResponse(null)),
    supabaseRpc('finish_odoo_census', (c) => { const b = c.bodyJson as { p_kind: string; p_cursor: string }; cursors.set(`master:${b.p_kind}`, b.p_cursor); return jsonResponse(0); }),
    supabaseRpc('merge_external_org_binding_config', () => jsonResponse(null)),
    supabaseRpc('log_audit', () => jsonResponse(null)),
    { label: 'odoo-json2', host: ODOO, pathname: /^\/json\/2\//, response: (c: FetchCall) => {
      odooCalls++;
      const key = o.rejectAfter !== undefined && odooCalls > o.rejectAfter ? 'revoked' : (c.headers.get('authorization') ?? '');
      return fake.fetch(c.url.toString(), { method: 'POST', headers: { Authorization: key.startsWith('bearer') ? key : `bearer ${key}` }, body: c.bodyText });
    } },
    { label: 'odoo-version', host: ODOO, pathname: '/web/webclient/version_info', response: () => (o.version === null ? new Response('no', { status: 404 }) : jsonResponse({ result: { server_version_info: [o.version ?? 20, 0] } })) },
  ];
  return { fake, cursors, lock, routes };
}

const client = () => createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
async function sweep(o: Opts = {}, opts?: Parameters<typeof sweepOdooOrg>[2]) {
  const h = harness(o);
  return await withFetchMock(h.routes, async ({ calls }) => ({ result: await sweepOdooOrg(client(), ORG, opts), calls, ...h }));
}
const odoo = (calls: FetchCall[]) => calls.filter((c) => c.url.host === ODOO);
const stored = (calls: FetchCall[]) => (rpcCall(calls, 'merge_external_org_binding_config').at(-1)?.bodyJson as { p_patch: { connection: ConnectionRecord; capabilities?: unknown } } | undefined)?.p_patch;

describe('odooSweep — AC-ODC-025 single flight and refusals', () => {
  it('AC-ODC-025 a held lock → lock-held, no Odoo call and no release of someone else\'s lock', async () => {
    const r = await sweep({ lock: { held: true } });
    assertEquals(r.result, { skipped: 'lock-held' });
    assertEquals(odoo(r.calls).length, 0);
    assertEquals(rpcCall(r.calls, 'release_erp_sweep_lock').length, 0);
  });

  for (const [label, b, refusal] of [
    ['disconnected', binding({ status: 'disconnected' }), 'inactive'],
    ['not activated', binding({ activated_at: null }), 'inactive'],
  ] as const) {
    it(`AC-ODC-025 a ${label} binding → ${refusal}, no Odoo call, lock released`, async () => {
      const r = await sweep({ binding: b });
      assertEquals(r.result, { skipped: refusal });
      assertEquals(odoo(r.calls).length, 0);
      assertEquals(rpcCall(r.calls, 'release_erp_sweep_lock').length, 1);
    });
  }

  it('AC-ODC-025 the kill switch off → kill-switch, no Odoo call', async () => {
    Deno.env.set('EXTERNAL_CONNECT_ENABLED', 'false');
    try {
      const r = await sweep();
      assertEquals(r.result, { skipped: 'kill-switch' });
      assertEquals(odoo(r.calls).length, 0);
    } finally { Deno.env.delete('EXTERNAL_CONNECT_ENABLED'); }
  });

  it('AC-ODC-025 two overlapping sweeps for one org → one runs, the other no-ops', async () => {
    const h = harness();
    const [a, b] = await withFetchMock(h.routes, () => Promise.all([sweepOdooOrg(client(), ORG), sweepOdooOrg(client(), ORG)]));
    assertEquals([a, b].filter((x) => 'skipped' in x && x.skipped === 'lock-held').length, 1);
    assertEquals([a, b].filter((x) => 'ok' in x).length, 1);
  });
});

describe('odooSweep — AC-ODC-025 budget and outcomes', () => {
  it('AC-ODC-025 a big catalogue stops at the per-tick call budget with progress saved', async () => {
    const r = await sweep({ prepare: (f) => f.seed('product.product', Array.from({ length: 15_000 }, (_, i) => ({ id: i + 10, name: `P${i}`, company_id: false }))) });
    assert(odoo(r.calls).length <= ODOO_SWEEP_TICK_MAX_CALLS, `${odoo(r.calls).length} Odoo calls`);
    assertEquals('ok' in r.result && r.result.calls, ODOO_SWEEP_TICK_MAX_CALLS);
    assert(JSON.parse(r.cursors.get('master:product')!).scan.after_id > 0);
  });

  it('AC-ODC-025 a kind with a backlog larger than the tick leaves budget for every kind after it', async () => {
    const r = await sweep({ prepare: (f) => f.seed('product.product', Array.from({ length: 15_000 }, (_, i) => ({ id: i + 10, name: `P${i}`, company_id: false }))) });
    for (const kind of ['warehouse', 'location', 'partner']) assert(r.cursors.get(`master:${kind}`), `${kind} got no budget`);
  });

  it('AC-ODC-025 a spent time budget makes no Odoo call', async () => {
    const r = await sweep({}, { timeBudgetMs: 0 });
    assertEquals(odoo(r.calls).length, 0);
  });

  it('AC-ODC-021 cursors are written only by the page and census RPCs, never by a table write', async () => {
    const r = await sweep();
    assertEquals(r.calls.filter((c) => c.url.pathname === '/rest/v1/external_sync_watermarks' && c.method !== 'GET').length, 0);
    assert(r.cursors.has('master:product') && r.cursors.has('master:account'));
    const apply = rpcCall(r.calls, 'apply_odoo_master_page').map((c) => c.bodyJson as { p_org_id: string });
    assert(apply.every((b) => b.p_org_id === ORG));
  });

  it('AC-ODC-025 a clean run stores a healthy connection with what discovery last found missing', async () => {
    const r = await sweep({ binding: binding({ config: { database: 'db1', odoo_company_id: 1, capabilities: { observed_at: FRESH, missing: ['l10n_id:ppn'], models: {} } } }) });
    assertEquals(stored(r.calls)?.connection.state, 'degraded');
    assertEquals(stored(r.calls)?.connection.missing, ['l10n_id:ppn']);
    assertEquals(stored(r.calls)?.capabilities, undefined);
    const clean = await sweep();
    assertEquals(stored(clean.calls)?.connection.state, 'healthy');
  });

  it('AC-ODC-025 capabilities older than a day are discovered again and stored', async () => {
    const r = await sweep({ binding: binding({ config: { database: 'db1', odoo_company_id: 1, capabilities: { observed_at: '2026-01-01T00:00:00Z', missing: [], models: {} } } }) });
    assert(r.fake.calls.some((c) => c.method === 'fields_get'));
    assert(stored(r.calls)?.capabilities);
  });

  it('FR-ODC-021 a stale snapshot whose version probe fails falls back to the stored version, and with none is a failure', async () => {
    const old = { observed_at: '2026-01-01T00:00:00Z', missing: [], models: {} };
    const kept = await sweep({ version: null, binding: binding({ config: { database: 'db1', odoo_company_id: 1, capabilities: { ...old, version_major: 20 } } }) });
    assertEquals((stored(kept.calls)?.capabilities as { version_major: number }).version_major, 20);
    const none = await sweep({ version: null, binding: binding({ config: { database: 'db1', odoo_company_id: 1, capabilities: old } }) });
    assertEquals('ok' in none.result && none.result.failed, 'unreachable');
    assertEquals(stored(none.calls)?.capabilities, undefined);
  });

  it('AC-ODC-025 a 401 mid-sweep → credential-rejected, and no Odoo call after it', async () => {
    const r = await sweep({ rejectAfter: 2 });
    assertEquals('ok' in r.result && r.result.failed, 'key-rejected');
    assertEquals(stored(r.calls)?.connection.state, 'credential-rejected');
    assertEquals(stored(r.calls)?.connection.error_class, 'key-rejected');
    assertEquals(odoo(r.calls).length, 3);
    assertEquals(rpcCall(r.calls, 'release_erp_sweep_lock').length, 1);
  });

  it('AC-ODC-025 the lock is released when a store write throws, and the error surfaces', async () => {
    const h = harness({ applyError: true });
    await withFetchMock(h.routes, async ({ calls }) => {
      await assertRejects(() => sweepOdooOrg(client(), ORG), Error, 'apply_odoo_master_page failed');
      assertEquals(rpcCall(calls, 'release_erp_sweep_lock').length, 1);
      assertEquals(h.lock.held, false);
    });
  });

  it('a kind whose model discovery found missing is skipped, never read and never a rejected key', async () => {
    const r = await sweep({ binding: binding({ config: { database: 'db1', odoo_company_id: 1, capabilities: { observed_at: FRESH, missing: ['stock.warehouse'], models: {
      'stock.warehouse': { exists: false, read: false, create: false, write: false, unlink: false, fields_missing: [] },
      'stock.location': { exists: true, read: false, create: false, write: false, unlink: false, fields_missing: [] },
    } } } }) });
    assertEquals(r.fake.calls.filter((c) => c.model.startsWith('stock.')).length, 0);
    assertEquals(stored(r.calls)?.connection.state, 'degraded');
  });

  it('reads only the activated company and shared rows', async () => {
    const r = await sweep({ prepare: (f) => f.seed('product.product', [{ id: 2, name: 'Other', company_id: [2, 'Other Co'] }]) });
    const rows = rpcCall(r.calls, 'apply_odoo_master_page').flatMap((c) => (c.bodyJson as { p_kind: string; p_rows: { external_id: string }[] }).p_kind === 'product' ? (c.bodyJson as { p_rows: { external_id: string }[] }).p_rows : []);
    assertEquals([...new Set(rows.map((x) => x.external_id))], ['1']);
  });
});
