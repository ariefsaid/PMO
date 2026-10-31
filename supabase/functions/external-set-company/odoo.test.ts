/**
 * external-set-company — the Odoo router (#1504 S2): list companies and set-once activation through the stored key.
 * Real handler from ./index.ts; Supabase and Odoo mocked over fetch (Odoo by the in-memory fake).
 */
import { afterAll, describe, it } from '@std/testing/bdd';
import { assertEquals } from '@std/assert';
import { handleSetCompanyRequest, setTestJwks } from './index.ts';
import {
  createAuthedRequest, createJwtAuthority, createTestJwksResolver, installEdgeEnv, jsonResponse, rpcCall,
  supabaseRpc, supabaseSelect, withFetchMock, type FetchCall, type MockRoute,
} from '../_shared/testing/edgeTestKit.ts';
import type { CapabilitySnapshot } from '../../../pmo-portal/src/lib/adapterSeam/odoo/discovery.ts';
import type { ConnectionRecord } from '../../../pmo-portal/src/lib/adapterSeam/odoo/connectionState.ts';
import { createFakeOdoo, type FakeOdoo } from '../../../pmo-portal/src/lib/adapterSeam/odoo/fakeOdoo.ts';

const env = installEdgeEnv();
const auth = await createJwtAuthority(env.SUPABASE_URL);
setTestJwks(createTestJwksResolver(auth));
// Unpaced: discovery's ~60 calls at 5 per second would make every case take seconds.
// The pacer can only slow a client down, so tests skip its waits by firing timers at once.
const realSetTimeout = globalThis.setTimeout;
globalThis.setTimeout = ((fn: () => void) => { queueMicrotask(fn); return 0; }) as unknown as typeof setTimeout;
let clockSkewMs = 0;
const realNow = Date.now;
Date.now = () => realNow() + clockSkewMs;
afterAll(() => { env.restore(); globalThis.setTimeout = realSetTimeout; Date.now = realNow; });

const ODOO = 'odoo.example.test';
const KEY = 'stored-odoo-key';
const one = (body: unknown) => jsonResponse(body, { headers: { 'content-type': 'application/vnd.pgrst.object+json' } });
const none = () => new Response('null', { status: 200, headers: { 'content-type': 'application/json' } });
const pgError = (message: string) => jsonResponse({ code: 'P0001', message, details: null, hint: null }, { status: 400 });

interface Opts { role?: string; operator?: boolean; active?: boolean; activate?: () => Response; binding?: Record<string, unknown>; version?: number | null; rateOk?: boolean; skewAfterCalls?: number; prepare?: (fake: FakeOdoo) => void; extra?: MockRoute[] }
function setup(o: Opts = {}) {
  const fake = createFakeOdoo({ key: KEY });
  fake.seed('res.company', [{ id: 1, name: 'Main Co' }, { id: 2, name: 'Second Co' }]);
  fake.seed('account.tax', [{ id: 1, name: '12%', amount: 12, type_tax_use: 'purchase' }]);
  o.prepare?.(fake);
  let odooN = 0;
  clockSkewMs = 0;
  const routes: MockRoute[] = [
    ...(o.extra ?? []),
    supabaseSelect('profiles', () => one({ org_id: 'org-1', role: o.role ?? 'Admin' })),
    supabaseSelect('platform_operators', () => (o.operator ? one({ user_id: 'user-1' }) : none())),
    supabaseRpc('actor_authorization_state', () => jsonResponse({ active: o.active ?? true })),
    supabaseSelect('external_org_bindings', () => one(o.binding ?? {
      site_url: `https://${ODOO}`, secret_ref: 'odoo_ref', status: 'active', activated_at: null, config: { database: 'db1' } })),
    supabaseRpc('read_vault_secret', () => jsonResponse(KEY)),
    { label: 'odoo-json2', host: ODOO, pathname: /^\/json\/2\//,
      response: (c: FetchCall) => (o.skewAfterCalls !== undefined && ++odooN >= o.skewAfterCalls && (clockSkewMs = 200_000), fake.fetch(c.url.toString(), { method: 'POST', headers: { Authorization: c.headers.get('authorization') ?? '' }, body: c.bodyText })) },
    { label: 'odoo-version', host: ODOO, pathname: '/web/webclient/version_info',
      response: () => jsonResponse({ result: { server_version_info: [o.version === undefined ? 20 : o.version, 0, 0, 'final', 0, ''] } }) },
    supabaseRpc('merge_external_org_binding_config', () => jsonResponse(null)),
    supabaseRpc('log_audit', () => jsonResponse(null)),
    supabaseRpc('rate_limit_hit', () => jsonResponse(o.rateOk ?? true)),
    supabaseRpc('activate_odoo_binding', () => (o.activate ? o.activate() : jsonResponse('2026-11-01T00:00:00+00:00'))),
  ];
  return { fake, routes };
}

async function call(body: Record<string, unknown>, o: Opts = {}) {
  const { fake, routes } = setup(o);
  return await withFetchMock(routes, async ({ calls }) => {
    const res = await handleSetCompanyRequest(createAuthedRequest('http://edge.test/set-company', { tier: 'odoo', ...body }, await auth.mintJwt({ sub: 'user-1' })));
    const text = await res.text();
    return { res, json: JSON.parse(text) as Record<string, unknown>, text, calls, fake };
  });
}
const odooCalls = (calls: FetchCall[]) => calls.filter((c) => c.url.host === ODOO);

describe('external-set-company — Odoo list-companies', () => {
  it('FR-ODC-005 lists the companies the stored key can see, before activation', async () => {
    const r = await call({ setupAction: 'list-companies' });
    assertEquals(r.res.status, 200);
    assertEquals(r.json, { companies: [{ id: 1, name: 'Main Co' }, { id: 2, name: 'Second Co' }] });
    assertEquals(r.fake.calls, [{ model: 'res.company', method: 'search_read' }]);
    assertEquals(r.text.includes(KEY), false);
    const read = r.calls.find((c) => c.url.pathname === '/rest/v1/external_org_bindings')!;
    assertEquals([read.url.searchParams.get('org_id'), read.url.searchParams.get('external_tier')], ['eq.org-1', 'eq.odoo']);
  });

  it('FR-ODC-005 a refused resolver → 422 with its classified reason, no Odoo call', async () => {
    const r = await call({ setupAction: 'list-companies' }, { binding: { site_url: `https://${ODOO}`, secret_ref: 'r', status: 'disconnected', activated_at: null, config: {} } });
    assertEquals([r.res.status, r.json.error], [422, 'inactive']);
    assertEquals(odooCalls(r.calls).length, 0);
  });
});

describe('external-set-company — Odoo activate', () => {
  it('FR-ODC-005 a company past the first 50 can be activated', async () => {
    const { fake, routes } = setup();
    fake.seed('res.company', Array.from({ length: 60 }, (_, i) => ({ id: i + 1, name: `Co ${i + 1}` })));
    await withFetchMock(routes, async ({ calls }) => {
      const res = await handleSetCompanyRequest(createAuthedRequest('http://edge.test/set-company', { tier: 'odoo', companyId: 60 }, await auth.mintJwt({ sub: 'user-1' })));
      assertEquals(res.status, 200);
      assertEquals((rpcCall(calls, 'activate_odoo_binding')[0].bodyJson as Record<string, unknown>).p_company_id, 60);
    });
  });

  it('FR-ODC-022 the RPC version refusal → 409 unsupported-version, not a reasonless refusal', async () => {
    const r = await call({ companyId: 1 }, { activate: () => pgError('unsupported odoo major version 19') });
    assertEquals([r.res.status, r.json.error], [409, 'unsupported-version']);
  });

  it('AC-ODC-005 activates the chosen company with the version from version_info and the company name', async () => {
    const r = await call({ companyId: 1 });
    assertEquals(r.res.status, 200);
    assertEquals(r.json, { ok: true, companyId: 1, versionMajor: 20, activatedAt: '2026-11-01T00:00:00+00:00' });
    const args = rpcCall(r.calls, 'activate_odoo_binding')[0].bodyJson as Record<string, unknown>;
    const { p_config_patch: patch, ...rest } = args;
    assertEquals(rest, { p_org_id: 'org-1', p_version_major: 20, p_company_id: 1, p_company_name: 'Main Co', p_actor_id: 'user-1' });
    const { capabilities, connection } = patch as { capabilities: CapabilitySnapshot; connection: ConnectionRecord };
    assertEquals([capabilities.missing, capabilities.version_major, connection.state, connection.failures], [[], 20, 'healthy', 0]);
    assertEquals(Object.keys(patch as object).sort(), ['capabilities', 'connection']);
    assertEquals(JSON.stringify(args).includes(KEY), false);
  });

  it('FR-ODC-021 activation stores what is missing and a degraded state', async () => {
    const r = await call({ companyId: 1 }, { prepare: (f) => f.dropModel('stock.location') });
    assertEquals(r.res.status, 200);
    const patch = (rpcCall(r.calls, 'activate_odoo_binding')[0].bodyJson as { p_config_patch: { capabilities: CapabilitySnapshot; connection: ConnectionRecord } }).p_config_patch;
    assertEquals([patch.capabilities.missing, patch.connection.state, patch.connection.missing], [['stock.location'], 'degraded', ['stock.location']]);
  });

  it('FR-ODC-020 activation runs discovery without reading the installed-modules model', async () => {
    const r = await call({ companyId: 1 });
    assertEquals(r.fake.calls.some((c) => c.model === 'ir.module.module'), false);
    assertEquals(r.fake.calls.some((c) => c.method === 'fields_get' && c.model === 'res.partner'), true);
  });

  for (const version of [19, null]) {
    it(`AC-ODC-012 version ${version} at activation → 422 below-tested, no RPC`, async () => {
      const r = await call({ companyId: 1 }, { version });
      assertEquals([r.res.status, r.json.error], [422, 'below-tested']);
      assertEquals(rpcCall(r.calls, 'activate_odoo_binding').length, 0);
    });
  }

  it('FR-ODC-022 a version past the tested range activates with the untested notice', async () => {
    const r = await call({ companyId: 1 }, { version: 21 });
    assertEquals(r.res.status, 200);
    assertEquals((rpcCall(r.calls, 'activate_odoo_binding')[0].bodyJson as { p_config_patch: { capabilities: CapabilitySnapshot } }).p_config_patch.capabilities.untested_version, true);
  });

  it('FR-ODC-020 discovery failing on the network → 502 with the class, no RPC', async () => {
    const r = await call({ companyId: 1 }, { prepare: (f) => { const orig = f.fetch; let n = 0; f.fetch = ((...a: Parameters<typeof fetch>) => (++n === 2 ? Promise.reject(new TypeError('connection reset')) : orig(...a))) as typeof fetch; } });
    assertEquals([r.res.status, r.json.error], [502, 'unreachable']);
    assertEquals(rpcCall(r.calls, 'activate_odoo_binding').length, 0);
  });

  it('AC-ODC-005 setupAction activate is the same verb', async () => {
    const r = await call({ setupAction: 'activate', companyId: 2 });
    assertEquals(r.res.status, 200);
    assertEquals((rpcCall(r.calls, 'activate_odoo_binding')[0].bodyJson as Record<string, unknown>).p_company_name, 'Second Co');
  });

  it('AC-ODC-005 a company the key cannot see → 404 company-not-found, no RPC', async () => {
    const r = await call({ companyId: 9 });
    assertEquals([r.res.status, r.json.error], [404, 'company-not-found']);
    assertEquals(rpcCall(r.calls, 'activate_odoo_binding').length, 0);
  });

  it('AC-ODC-005 the RPC refusing another company → 409 company-locked, the RPC message not echoed', async () => {
    const r = await call({ companyId: 2 }, { activate: () => pgError('company already chosen') });
    assertEquals([r.res.status, r.json.error], [409, 'company-locked']);
    assertEquals(r.text.includes('already chosen'), false);
  });

  it('FR-ODC-022 any other RPC refusal → 409 activation-refused', async () => {
    const r = await call({ companyId: 1 }, { activate: () => pgError('binding is not connectable') });
    assertEquals([r.res.status, r.json.error], [409, 'activation-refused']);
  });

  it('FR-ODC-002 Odoo rejecting the stored key → 502 key-rejected, no RPC', async () => {
    const { routes } = setup();
    const r = await withFetchMock(routes.map((rt) => rt.label === 'supabase-rpc-read_vault_secret' ? supabaseRpc('read_vault_secret', () => jsonResponse('wrong-key')) : rt), async ({ calls }) => {
      const res = await handleSetCompanyRequest(createAuthedRequest('http://edge.test/set-company', { tier: 'odoo', companyId: 1 }, await auth.mintJwt({ sub: 'user-1' })));
      return { res, calls };
    });
    assertEquals([r.res.status, (await r.res.json()).error], [502, 'key-rejected']);
    assertEquals(rpcCall(r.calls, 'activate_odoo_binding').length, 0);
  });
});

describe('external-set-company — Odoo gates', () => {
  for (const role of ['Finance', 'Project Manager', 'Executive', 'Engineer']) {
    for (const verb of [{ setupAction: 'list-companies' }, { companyId: 1 }]) {
      it(`AC-ODC-009 a ${role} cannot ${verb.setupAction ?? 'activate'} → 403, no Odoo call, no RPC`, async () => {
        const r = await call(verb, { role });
        assertEquals(r.res.status, 403);
        assertEquals(odooCalls(r.calls).length, 0);
        assertEquals(rpcCall(r.calls, 'read_vault_secret').length, 0);
        assertEquals(rpcCall(r.calls, 'activate_odoo_binding').length, 0);
      });
    }
  }

  it('AC-ODC-009 a platform operator may activate', async () => {
    const r = await call({ companyId: 1 }, { role: 'Engineer', operator: true });
    assertEquals(r.res.status, 200);
  });

  it('AC-ODC-009 an inactive member → 403 before anything is read', async () => {
    const r = await call({ companyId: 1 }, { active: false });
    assertEquals(r.res.status, 403);
    assertEquals(rpcCall(r.calls, 'read_vault_secret').length, 0);
  });

  it('PQ-12 an unknown Odoo verb → 400', async () => {
    const r = await call({ setupAction: 'drop-everything' });
    assertEquals([r.res.status, r.json.error], [400, 'BAD_REQUEST']);
    assertEquals(odooCalls(r.calls).length, 0);
  });
});

describe('external-set-company — Odoo recheck (FR-ODC-020, FR-ODC-031)', () => {
  const ACTIVATED = { site_url: `https://${ODOO}`, secret_ref: 'odoo_ref', status: 'active', activated_at: '2026-11-01T00:00:00Z',
    config: { database: 'db1', odoo_company_id: 1, connection: { state: 'healthy', failures: 0, last_ok_at: null, last_checked_at: null, error_class: null, missing: [] } } };
  const merged = (calls: FetchCall[]) => rpcCall(calls, 'merge_external_org_binding_config').map((c) => c.bodyJson as { p_org_id: string; p_external_tier: string; p_patch: { connection: ConnectionRecord; capabilities?: CapabilitySnapshot } });

  it('FR-ODC-031 an Admin recheck probes now and stores a healthy state with the snapshot', async () => {
    const r = await call({ setupAction: 'recheck' }, { binding: ACTIVATED });
    assertEquals([r.res.status, r.json.state], [200, 'healthy']);
    const m = merged(r.calls);
    assertEquals(m.length, 1);
    assertEquals([m[0].p_org_id, m[0].p_external_tier, m[0].p_patch.connection.state, m[0].p_patch.capabilities?.missing], ['org-1', 'odoo', 'healthy', []]);
    assertEquals(r.text.includes(KEY), false);
    assertEquals(JSON.stringify(m).includes(KEY), false);
  });

  it('FR-ODC-031 Odoo rejecting the key → 200 credential-rejected (the probe ran), stored with the class', async () => {
    const { routes } = setup({ binding: ACTIVATED });
    const r = await withFetchMock(routes.map((rt) => rt.label === 'supabase-rpc-read_vault_secret' ? supabaseRpc('read_vault_secret', () => jsonResponse('wrong-key')) : rt), async ({ calls }) => {
      const res = await handleSetCompanyRequest(createAuthedRequest('http://edge.test/set-company', { tier: 'odoo', setupAction: 'recheck' }, await auth.mintJwt({ sub: 'user-1' })));
      return { res, calls };
    });
    assertEquals([r.res.status, (await r.res.json()).state], [200, 'credential-rejected']);
    const m = merged(r.calls);
    assertEquals([m[0].p_patch.connection.state, m[0].p_patch.connection.error_class, 'capabilities' in m[0].p_patch], ['credential-rejected', 'key-rejected', false]);
    assertEquals(rpcCall(r.calls, 'log_audit').length, 1);
  });

  it('FR-ODC-031 a network failure counts once; the previous state is kept until the third', async () => {
    const r = await call({ setupAction: 'recheck' }, { binding: ACTIVATED, prepare: (f) => f.failNext('transport') });
    assertEquals([r.res.status, r.json.state], [200, 'healthy']);
    assertEquals(merged(r.calls)[0].p_patch.connection.failures, 1);
  });

  it('FR-ODC-020 a missing model on recheck → degraded naming it', async () => {
    const r = await call({ setupAction: 'recheck' }, { binding: ACTIVATED, prepare: (f) => f.dropModel('uom.uom') });
    assertEquals([r.res.status, r.json.state, r.json.missing], [200, 'degraded', ['uom.uom']]);
  });

  it('FR-ODC-020 a binding that is not activated → 422 inactive, no Odoo call, nothing stored', async () => {
    const r = await call({ setupAction: 'recheck' }, { binding: { ...ACTIVATED, activated_at: null } });
    assertEquals([r.res.status, r.json.error], [422, 'inactive']);
    assertEquals(odooCalls(r.calls).length, 0);
    assertEquals(merged(r.calls).length, 0);
  });

  for (const role of ['Engineer', 'Finance', 'Project Manager', 'Executive']) {
    it(`FR-ODC-020 a ${role} cannot recheck → 403, no key read, nothing stored`, async () => {
      const r = await call({ setupAction: 'recheck' }, { role, binding: ACTIVATED });
      assertEquals(r.res.status, 403);
      assertEquals(rpcCall(r.calls, 'read_vault_secret').length, 0);
      assertEquals(merged(r.calls).length, 0);
    });
  }

  it('FR-ODC-020 a platform operator may recheck', async () => {
    const r = await call({ setupAction: 'recheck' }, { role: 'Engineer', operator: true, binding: ACTIVATED });
    assertEquals(r.res.status, 200);
  });

  it('FR-ODC-046 a second recheck inside the window → 429, no Odoo call, nothing stored', async () => {
    const r = await call({ setupAction: 'recheck' }, { binding: ACTIVATED, rateOk: false });
    assertEquals(r.res.status, 429);
    assertEquals(odooCalls(r.calls).length, 0);
    assertEquals(merged(r.calls).length, 0);
    assertEquals((rpcCall(r.calls, 'rate_limit_hit')[0].bodyJson as { p_key: string }).p_key, 'odoo-recheck:org-1');
  });

  it('FR-ODC-020 a discovery that outlasts its budget → 200 timeout, one failure counted, no snapshot stored', async () => {
    const r = await call({ setupAction: 'recheck' }, { binding: ACTIVATED, skewAfterCalls: 4 });
    assertEquals([r.res.status, r.json.errorClass], [200, 'timeout']);
    const m = merged(r.calls);
    assertEquals([m[0].p_patch.connection.failures, 'capabilities' in m[0].p_patch], [1, false]);
  });

  it('FR-ODC-021 a failed version probe with no earlier snapshot is a failure, never healthy', async () => {
    const r = await call({ setupAction: 'recheck' }, { binding: { ...ACTIVATED, config: { ...ACTIVATED.config, connection: { ...ACTIVATED.config.connection, state: 'degraded' } } }, version: null });
    assertEquals(r.json.state, 'degraded');
    const m = merged(r.calls);
    assertEquals([m[0].p_patch.connection.failures, 'capabilities' in m[0].p_patch], [1, false]);
  });

  it('FR-ODC-021 a failed version probe keeps the earlier snapshot version', async () => {
    const config = { ...ACTIVATED.config, capabilities: { version_major: 20, missing: [] } };
    const r = await call({ setupAction: 'recheck' }, { binding: { ...ACTIVATED, config }, version: null });
    assertEquals([r.json.state, merged(r.calls)[0].p_patch.capabilities?.version_major], ['healthy', 20]);
  });
});

describe('external-set-company — Odoo activation deadline', () => {
  it('FR-ODC-021 discovery outlasting its budget at activation → "Odoo is slow", nothing activated', async () => {
    const r = await call({ companyId: 1 }, { skewAfterCalls: 6 });
    assertEquals([r.res.status, r.json.error, r.json.message], [502, 'timeout', 'Odoo is slow, try again']);
    assertEquals(rpcCall(r.calls, 'activate_odoo_binding').length, 0);
  });
});

describe('external-set-company — Odoo refresh and reset-kind (FR-ODC-047, FR-ODC-048)', () => {
  const ACTIVATED = { site_url: `https://${ODOO}`, secret_ref: 'odoo_ref', status: 'active', activated_at: '2026-11-01T00:00:00Z',
    config: { database: 'db1', odoo_company_id: 1, capabilities: { observed_at: new Date().toISOString(), missing: [], models: {} } } };
  const window = () => {
    let hits = 0;
    return supabaseRpc('rate_limit_hit', () => jsonResponse(++hits <= 1));
  };
  const sweepRoutes = (): MockRoute[] => [
    window(),
    supabaseRpc('claim_erp_sweep_lock', () => jsonResponse(true)),
    supabaseRpc('release_erp_sweep_lock', () => jsonResponse(true)),
    supabaseSelect('external_sync_watermarks', () => jsonResponse([])),
    supabaseRpc('apply_odoo_master_page', () => jsonResponse(0)),
    supabaseRpc('mark_odoo_census_seen', () => jsonResponse(null)),
    supabaseRpc('finish_odoo_census', () => jsonResponse(0)),
    supabaseRpc('reset_odoo_sync_kind', () => jsonResponse(null)),
  ];
  const run = async (bodies: Record<string, unknown>[], o: Opts) => {
    const { routes } = setup({ binding: ACTIVATED, ...o, extra: o.extra ?? sweepRoutes() });
    return await withFetchMock(routes, async ({ calls }) => {
      const out = [];
      for (const b of bodies) {
        const res = await handleSetCompanyRequest(createAuthedRequest('http://edge.test/set-company', { tier: 'odoo', ...b }, await auth.mintJwt({ sub: 'user-1' })));
        out.push({ status: res.status, json: await res.json() as Record<string, unknown> });
      }
      return { out, calls };
    });
  };

  it('AC-ODC-025 Finance refresh → one rate-limit hit keyed to the org, then the sweep runs; a second within the minute → 429', async () => {
    const r = await run([{ setupAction: 'refresh' }, { setupAction: 'refresh' }], { role: 'Finance' });
    assertEquals(r.out[0].status, 200);
    assertEquals(r.out[0].json.ok, true);
    assertEquals(rpcCall(r.calls, 'rate_limit_hit')[0].bodyJson, { p_key: 'odoo-refresh:org-1', p_limit: 1, p_window_secs: 60 });
    assertEquals(rpcCall(r.calls, 'claim_erp_sweep_lock').length, 1);
    assertEquals([r.out[1].status, r.out[1].json.retryAfterSeconds], [429, 60]);
  });

  it('FR-ODC-047 an Admin may refresh', async () => {
    const r = await run([{ setupAction: 'refresh' }], { role: 'Admin' });
    assertEquals(r.out[0].status, 200);
  });

  for (const role of ['Engineer', 'Project Manager', 'Executive']) {
    it(`FR-ODC-047 a ${role} cannot refresh → 403, no sweep`, async () => {
      const r = await run([{ setupAction: 'refresh' }], { role });
      assertEquals(r.out[0].status, 403);
      assertEquals(rpcCall(r.calls, 'claim_erp_sweep_lock').length, 0);
    });
  }

  it('FR-ODC-047 refresh is for the org\'s Admin or Finance, not a platform operator', async () => {
    const r = await run([{ setupAction: 'refresh' }], { role: 'Engineer', operator: true });
    assertEquals(r.out[0].status, 403);
  });

  it('FR-ODC-048 an Admin reset-kind → reset_odoo_sync_kind for the caller\'s org, kind and actor', async () => {
    const r = await run([{ setupAction: 'reset-kind', kind: 'product' }], { role: 'Admin' });
    assertEquals([r.out[0].status, r.out[0].json], [200, { reset: 'product' }]);
    assertEquals(rpcCall(r.calls, 'reset_odoo_sync_kind')[0].bodyJson, { p_org_id: 'org-1', p_kind: 'product', p_actor_id: 'user-1' });
  });

  it('FR-ODC-048 a reset while the sync runs → 409, nothing reset, the running sync\'s lock untouched', async () => {
    const routes = sweepRoutes().filter((r) => !String(r.label ?? '').includes('claim_erp_sweep_lock'));
    const r = await run([{ setupAction: 'reset-kind', kind: 'product' }], { role: 'Admin', extra: [supabaseRpc('claim_erp_sweep_lock', () => jsonResponse(false)), ...routes] });
    assertEquals(r.out[0].status, 409);
    assertEquals(rpcCall(r.calls, 'reset_odoo_sync_kind').length, 0);
    assertEquals(rpcCall(r.calls, 'release_erp_sweep_lock').length, 0);
  });

  it('FR-ODC-048 a reset holds the sync lock around the delete and releases it after', async () => {
    const r = await run([{ setupAction: 'reset-kind', kind: 'product' }], { role: 'Admin' });
    assertEquals(r.out[0].status, 200);
    const order = r.calls.map((c) => c.url.pathname.split('/').at(-1)).filter((n) => /erp_sweep_lock|reset_odoo_sync_kind/.test(n ?? ''));
    assertEquals(order, ['claim_erp_sweep_lock', 'reset_odoo_sync_kind', 'release_erp_sweep_lock']);
  });

  it('FR-ODC-048 an unknown kind → 400, nothing reset', async () => {
    for (const kind of ['bogus', undefined, 7]) {
      const r = await run([{ setupAction: 'reset-kind', kind }], { role: 'Admin' });
      assertEquals(r.out[0].status, 400);
      assertEquals(rpcCall(r.calls, 'reset_odoo_sync_kind').length, 0);
    }
  });

  it('FR-ODC-048 a platform operator may reset; the database refusing → 403', async () => {
    const ok = await run([{ setupAction: 'reset-kind', kind: 'uom' }], { role: 'Engineer', operator: true });
    assertEquals(ok.out[0].status, 200);
    const refused = await run([{ setupAction: 'reset-kind', kind: 'uom' }], { role: 'Admin', extra: [supabaseRpc('reset_odoo_sync_kind', () => jsonResponse({ code: '42501', message: 'x' }, { status: 403 })), ...sweepRoutes()] });
    assertEquals(refused.out[0].status, 403);
  });

  for (const role of ['Finance', 'Engineer', 'Project Manager', 'Executive']) {
    it(`AC-ODC-026 a ${role} cannot reset a kind → 403, nothing reset`, async () => {
      const r = await run([{ setupAction: 'reset-kind', kind: 'product' }], { role });
      assertEquals(r.out[0].status, 403);
      assertEquals(rpcCall(r.calls, 'reset_odoo_sync_kind').length, 0);
    });
  }
});
