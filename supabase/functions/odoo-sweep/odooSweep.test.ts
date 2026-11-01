/**
 * AC-ODC-025 — one org's Odoo sweep (`_shared/odooSweep.ts`; tested here, its first consumer, because CI runs `_shared`
 * tests under an import map without the edge test kit). Supabase is mocked over fetch with an in-memory cursor store
 * that only the RPCs write; Odoo is the in-memory fake.
 */
import { afterAll, describe, it } from '@std/testing/bdd';
import { assert, assertEquals, assertRejects } from '@std/assert';
import { createClient } from '@supabase/supabase-js';
import { countResponse, installEdgeEnv, jsonResponse, rpcCall, supabaseRpc, supabaseSelect, withFetchMock, type FetchCall, type MockRoute } from '../_shared/testing/edgeTestKit.ts';
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
const BINDING_ID = '0b000000-0000-4000-8000-000000000001';
const binding = (over: Record<string, unknown> = {}) => ({
  id: BINDING_ID, site_url: `https://${ODOO}`, secret_ref: 'odoo_ref', status: 'active', activated_at: '2026-11-01T00:00:00Z',
  config: { database: 'db1', odoo_company_id: 1, capabilities: { observed_at: FRESH, missing: [], models: {} } }, ...over,
});

interface Opts { pmoProjects?: Array<Record<string, unknown>>; pmoCompanies?: Array<Record<string, unknown>>; run?: Record<string, unknown> | null; accepted?: boolean; runError?: boolean; binding?: Record<string, unknown>; lock?: { held: boolean }; applyError?: boolean; reconcileError?: boolean; rejectAfter?: number; version?: number | null; prepare?: (f: FakeOdoo) => void }

function harness(o: Opts = {}) {
  const fake = createFakeOdoo({ key: KEY });
  fake.seed('res.company', [{ id: 1, name: 'Main Co', currency_id: [12, 'IDR'] }]);
  fake.seed('product.product', [{ id: 1, name: 'Semen', default_code: 'S1', company_id: false }]);
  fake.seed('account.account', [{ id: 1, name: 'Payable', code: '2100', account_type: 'liability_payable', company_ids: [1] }]);
  o.prepare?.(fake);
  const cursors = new Map<string, string>();
  const staged = new Map<string, Array<{ externalId: string }>>();
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
    // S6: the setup run's pass and the partner feed read these; by default there is no run and the party kind was never accepted.
    supabaseSelect('erp_connect_runs', () => (o.runError ? jsonResponse({ code: 'XX000', message: 'x' }, { status: 500 }) : o.run ? one(o.run) : none())),
    supabaseSelect('erp_connect_census', () => (o.accepted ? one({ accepted_at: '2026-11-01T00:00:00Z' }) : none())),
    supabaseSelect('external_master_records', () => jsonResponse([])),
    supabaseSelect('external_refs', () => jsonResponse([])),
    supabaseSelect('companies', (c) => jsonResponse(c.url.searchParams.has('erp_tax_id') || c.url.searchParams.has('name') ? [] : (o.pmoCompanies ?? []))),
    supabaseSelect('projects', () => jsonResponse(o.pmoProjects ?? [])),
    ...['profiles', 'procurement_items'].map((t) => supabaseSelect(t, () => jsonResponse([]))),
    { label: 'categories-in-use', method: 'HEAD', pathname: '/rest/v1/budget_line_items', response: () => countResponse(0) },
    supabaseSelect('erp_connect_staged', (c) => jsonResponse((staged.get(c.url.searchParams.get('kind')!.replace(/^eq\./, '')) ?? []).map((row) => ({ external_id: row.externalId, row })))),
    supabaseRpc('stage_connect_master_page', (c) => {
      const b = c.bodyJson as { p_kind: string; p_rows: Array<{ externalId: string }> };
      staged.set(b.p_kind, [...(staged.get(b.p_kind) ?? []), ...b.p_rows]);
      return jsonResponse(null);
    }),
    supabaseRpc('replace_connect_proposals', () => jsonResponse(null)),
    supabaseRpc('fail_connect_run', () => jsonResponse('staging')),
    supabaseRpc('apply_connect_outcome', () => jsonResponse(null)),
    supabaseRpc('reconcile_odoo_links', () => (o.reconcileError ? jsonResponse({ code: 'XX000', message: 'x' }, { status: 500 }) : jsonResponse(0))),
    { label: 'odoo-json2', host: ODOO, pathname: /^\/json\/2\//, response: (c: FetchCall) => {
      odooCalls++;
      const key = o.rejectAfter !== undefined && odooCalls > o.rejectAfter ? 'revoked' : (c.headers.get('authorization') ?? '');
      return fake.fetch(c.url.toString(), { method: 'POST', headers: { Authorization: key.startsWith('bearer') ? key : `bearer ${key}` }, body: c.bodyText });
    } },
    { label: 'odoo-version', host: ODOO, pathname: '/web/webclient/version_info', response: () => (o.version === null ? new Response('no', { status: 404 }) : jsonResponse({ result: { server_version_info: [o.version ?? 20, 0] } })) },
  ];
  return { fake, cursors, lock, routes };
}

const one = (body: unknown) => jsonResponse(body, { headers: { 'content-type': 'application/vnd.pgrst.object+json' } });
const none = () => new Response('null', { status: 200, headers: { 'content-type': 'application/json' } });
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

const RUN = { id: 'run-1', state: 'staging', cursor: {}, proposed_kinds: [], started_at: new Date().toISOString() };
const partnerRow = (id: number, over: Record<string, unknown> = {}) => ({ id, name: `Partner ${id}`, vat: false, ref: false, is_company: true, parent_id: false, supplier_rank: 1, customer_rank: 0, ...over });

describe('odooSweep — #1504 S6 the setup run and the partner feed', () => {
  it('FR-ECA-002 an open setup run of this connection is advanced in the same tick: Odoo parties are staged for it', async () => {
    const r = await sweep({ run: RUN, prepare: (f) => f.seed('res.partner', [partnerRow(5), partnerRow(6, { supplier_rank: 0, customer_rank: 1 })]) });
    assert('ok' in r.result);
    const read = r.calls.find((c) => c.url.pathname === '/rest/v1/erp_connect_runs')!;
    assertEquals([read.url.searchParams.get('org_id'), read.url.searchParams.get('external_tier'), read.url.searchParams.get('binding_id')], [`eq.${ORG}`, 'eq.odoo', `eq.${BINDING_ID}`]);
    const staged = rpcCall(r.calls, 'stage_connect_master_page').map((c) => c.bodyJson as { p_org_id: string; p_run_id: string; p_kind: string; p_rows: Array<{ externalId: string }> });
    assert(staged.every((b) => b.p_org_id === ORG && b.p_run_id === 'run-1'));
    assertEquals(staged.find((b) => b.p_kind === 'party')?.p_rows.map((x) => x.externalId), ['Vendor:5', 'Client:6']);
  });

  it('FR-ECA-010 once every kind is staged the next tick step proposes with the shared matcher, for tier odoo, against PMO\'s companies', async () => {
    const r = await sweep({ run: RUN, pmoCompanies: [{ id: 'c1', name: 'Partner 5', type: 'Vendor', erp_tax_id: null }], prepare: (f) => f.seed('res.partner', [partnerRow(5)]) });
    const writes = rpcCall(r.calls, 'replace_connect_proposals').map((c) => c.bodyJson as { p_org_id: string; p_tier: string; p_kind: string; p_rows: Array<Record<string, unknown>> });
    assertEquals(writes.map((w) => [w.p_org_id, w.p_tier, w.p_kind]), [[ORG, 'odoo', 'party']]);
    assertEquals(writes[0].p_rows.map((x) => [x.outcome, x.pmoIds, x.externalIds]), [['link', ['c1'], ['Vendor:5']]]);
    assertEquals(rpcCall(r.calls, 'fail_connect_run').length, 0);
  });

  it('AC-ODC-050 a PMO project links to the cost account carrying its PMO project number, not its client code', async () => {
    const DONE = { party: null, item: null, project: null, employee: null, account: null };
    const run = { ...RUN, state: 'proposing', cursor: DONE, proposed_kinds: ['party', 'item'] };
    const h = harness({ run, pmoProjects: [{ id: 'p1', name: 'Jembatan', pmo_project_number: 'PRJ-26-0001', code: 'CLIENT-9' }] });
    h.routes.unshift(supabaseSelect('erp_connect_staged', () => jsonResponse([{ external_id: '10', row: { kind: 'project', externalId: '10', code: 'PRJ-26-0001', name: 'PRJ-26-0001 Jembatan', active: true } }])));
    const r = await withFetchMock(h.routes, async ({ calls }) => (await sweepOdooOrg(client(), ORG), calls));
    const read = r.find((c) => c.url.pathname === '/rest/v1/projects')!;
    assert(read.url.searchParams.get('select')!.includes('pmo_project_number'));
    const write = rpcCall(r, 'replace_connect_proposals').map((c) => c.bodyJson as { p_kind: string; p_rows: Array<Record<string, unknown>> }).find((w) => w.p_kind === 'project')!;
    assertEquals(write.p_rows.map((x) => [x.outcome, x.pmoIds, x.externalIds, x.key]), [['link', ['p1'], ['10'], 'code']]);
  });

  it('with no open run the pass reads nothing more from Odoo and stages nothing', async () => {
    const quiet = await sweep();
    const running = await sweep({ run: RUN });
    assertEquals(rpcCall(quiet.calls, 'stage_connect_master_page').length, 0);
    assert(odoo(running.calls).length > odoo(quiet.calls).length);
  });

  it('FR-ECA-002 an Odoo key revoked mid-sweep still counts one failed tick against the open setup run (three end it)', async () => {
    const r = await sweep({ run: RUN, rejectAfter: 0 });
    assertEquals('ok' in r.result && r.result.failed, 'key-rejected');
    const fails = rpcCall(r.calls, 'fail_connect_run').map((c) => c.bodyJson as { p_org_id: string; p_run_id: string; p_fatal: boolean });
    assertEquals(fails.map((f) => [f.p_org_id, f.p_run_id, f.p_fatal]), [[ORG, 'run-1', false]]);
    assertEquals(rpcCall(r.calls, 'release_erp_sweep_lock').length, 1);
  });

  it('a failed tick with no open setup run counts nothing', async () => {
    const r = await sweep({ rejectAfter: 0 });
    assertEquals(rpcCall(r.calls, 'fail_connect_run').length, 0);
  });

  it('a setup run that cannot be read does not fail the tick: the connection state is still stored', async () => {
    const r = await sweep({ runError: true });
    assertEquals('ok' in r.result && r.result.failed, undefined);
    assertEquals(stored(r.calls)?.connection.state, 'healthy');
    assertEquals(rpcCall(r.calls, 'release_erp_sweep_lock').length, 1);
  });

  it('AC-ECA-005 a partner Odoo just changed is matched after the page is saved, once the party kind was accepted', async () => {
    const r = await sweep({ accepted: true, prepare: (f) => f.seed('res.partner', [partnerRow(9, { write_date: '2026-11-01 00:00:00' })]) });
    const apply = rpcCall(r.calls, 'apply_connect_outcome').map((c) => c.bodyJson);
    assertEquals(apply, [{ p_org_id: ORG, p_tier: 'odoo', p_outcome: 'bring-in', p_external_id: 'Vendor:9', p_pmo_id: null, p_kind: 'party', p_snapshot: { name: 'Partner 9', taxId: null, code: null, role: 'vendor' } }]);
    const pageSaved = r.calls.findIndex((c) => c.url.pathname === '/rest/v1/rpc/apply_odoo_master_page' && (c.bodyJson as { p_kind: string }).p_kind === 'partner');
    assert(pageSaved >= 0 && pageSaved < r.calls.findIndex((c) => c.url.pathname === '/rest/v1/rpc/apply_connect_outcome'));
  });

  it('before the first accept the sweep applies nothing', async () => {
    const r = await sweep({ prepare: (f) => f.seed('res.partner', [partnerRow(9, { write_date: '2026-11-01 00:00:00' })]) });
    assertEquals(rpcCall(r.calls, 'apply_connect_outcome').length, 0);
  });
});

describe('odooSweep — #1504 S7 link reconciliation (AC-ODC-054)', () => {
  it('a clean tick reconciles this org\'s project links once, after the directory pages are saved', async () => {
    const r = await sweep();
    const calls = rpcCall(r.calls, 'reconcile_odoo_links');
    assertEquals(calls.map((c) => c.bodyJson), [{ p_org_id: ORG }]);
    const lastPage = r.calls.map((c) => c.url.pathname === '/rest/v1/rpc/apply_odoo_master_page').lastIndexOf(true);
    assert(lastPage >= 0 && lastPage < r.calls.indexOf(calls[0]));
  });

  it('a tick that cannot reach Odoo still reconciles from the mirror it already holds', async () => {
    const r = await sweep({ rejectAfter: 0 });
    assertEquals('ok' in r.result && r.result.failed, 'key-rejected');
    assertEquals(rpcCall(r.calls, 'reconcile_odoo_links').length, 1);
  });

  it('a reconcile that fails does not fail the tick: the connection state is still stored and the lock released', async () => {
    const r = await sweep({ reconcileError: true });
    assertEquals('ok' in r.result && r.result.failed, undefined);
    assertEquals(stored(r.calls)?.connection.state, 'healthy');
    assertEquals(rpcCall(r.calls, 'release_erp_sweep_lock').length, 1);
  });
});
