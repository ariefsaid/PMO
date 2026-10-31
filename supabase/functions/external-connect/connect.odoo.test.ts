/**
 * external-connect — the Odoo branch (#1504 S2): validate, stage, finalize; the key never leaves the stage RPC.
 * Real handler from ./index.ts, fetch mocked (edgeTestKit).
 */
import { afterAll, describe, it } from '@std/testing/bdd';
import { assert, assertEquals } from '@std/assert';
import { stub } from '@std/testing/mock';
import { handleConnectRequest, setTestJwks } from './index.ts';
import {
  createAuthedRequest, createJwtAuthority, createTestJwksResolver, installEdgeEnv, jsonResponse, rpcCall,
  supabaseRpc, supabaseSelect, withFetchMock, type FetchCall, type MockRoute,
} from '../_shared/testing/edgeTestKit.ts';

const env = installEdgeEnv();
const auth = await createJwtAuthority(env.SUPABASE_URL);
setTestJwks(createTestJwksResolver(auth));
afterAll(() => env.restore());

const SENTINEL = 'SENTINEL-ODOO-KEY';
const ODOO = 'odoo.example.test';
const SITE = `https://${ODOO}`;
const one = (body: unknown) => jsonResponse(body, { headers: { 'content-type': 'application/vnd.pgrst.object+json' } });
const none = () => new Response('null', { status: 200, headers: { 'content-type': 'application/json' } });
const VERSION = { jsonrpc: '2.0', id: null, result: { server_version_info: [20, 0, 0, 'final', 0, ''] } };

const request = async (credential: Record<string, unknown>, sub = 'user-1') =>
  createAuthedRequest('http://edge.test/connect', { tier: 'odoo', credential: { siteUrl: SITE, database: 'db1', apiKey: SENTINEL, ...credential } }, await auth.mintJwt({ sub }));

interface Opts {
  role?: string;
  erpActive?: boolean;
  erpCheckFails?: boolean;
  versionMajor?: number;
  companies?: () => Response;
  stage?: () => Response;
  finalize?: () => Response;
}
function routes(o: Opts = {}): MockRoute[] {
  return [
    supabaseSelect('profiles', () => one({ org_id: 'org-1', role: o.role ?? 'Admin' })),
    supabaseSelect('platform_operators', none),
    supabaseSelect('external_org_bindings', () => (o.erpCheckFails ? pgError('boom', 'XX000') : o.erpActive ? one({ external_tier: 'erpnext' }) : none())),
    { label: 'odoo-companies', host: ODOO, pathname: '/json/2/res.company/search_read',
      response: () => (o.companies ? o.companies() : jsonResponse([{ id: 1, name: 'Main Co', partner_id: [1, 'Main Co'] }])) },
    { label: 'odoo-version', host: ODOO, pathname: '/web/webclient/version_info', response: () => jsonResponse(o.versionMajor ? { result: { server_version_info: [o.versionMajor, 0] } } : VERSION) },
    supabaseRpc('stage_vault_secret_for_org', () => (o.stage ? o.stage() : jsonResponse('odoo_token_ref'))),
    supabaseRpc('finalize_odoo_connect', () => (o.finalize ? o.finalize() : jsonResponse('active'))),
    supabaseRpc('cleanup_external_connect_attempt', () => jsonResponse(null)),
  ];
}
const pgError = (message: string, code = 'P0001') => jsonResponse({ code, message, details: null, hint: null }, { status: 400 });

/** Runs one connect with every console method spied. */
async function connect(credential: Record<string, unknown>, o: Opts = {}) {
  const logged: string[] = [];
  const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((m) =>
    stub(console, m, (...args: unknown[]) => { logged.push(args.map((a) => (a instanceof Error ? `${a.message} ${a.stack}` : typeof a === 'string' ? a : JSON.stringify(a))).join(' ')); }));
  try {
    return await withFetchMock(routes(o), async ({ calls }) => {
      const res = await handleConnectRequest(await request(credential));
      return { res, text: await res.text(), calls, logged };
    });
  } finally { spies.forEach((s) => s.restore()); }
}
const body = (text: string) => JSON.parse(text) as Record<string, unknown>;
const odooCalls = (calls: FetchCall[]) => calls.filter((c) => c.url.host === ODOO);

/** AC-ODC-003: the sentinel may appear only as the stage RPC's p_secret_value and the Odoo bearer header. */
function assertNoLeak(r: { text: string; calls: FetchCall[]; logged: string[] }) {
  assert(!r.text.includes(SENTINEL), 'response carries the key');
  for (const line of r.logged) assert(!line.includes(SENTINEL), `a log line carries the key: ${line}`);
  for (const c of r.calls.filter((c) => c.url.pathname.startsWith('/rest/v1/'))) {
    const args = { ...(c.bodyJson as Record<string, unknown> | undefined) };
    if (c.url.pathname === '/rest/v1/rpc/stage_vault_secret_for_org') delete args.p_secret_value;
    assert(!JSON.stringify(args).includes(SENTINEL) && !c.url.search.includes(SENTINEL), `${c.url.pathname} carries the key`);
  }
}

describe('external-connect — Odoo success', () => {
  it('FR-ODC-003 validates, stages the key, finalizes with site + database, answers without any reference or key', async () => {
    const r = await connect({ keyExpiresOn: '2027-01-31' });
    assertEquals(r.res.status, 200);
    assertEquals(body(r.text), { ok: true, binding: { status: 'active' }, companies: [{ id: 1, name: 'Main Co' }], versionMajor: 20 });
    const stage = rpcCall(r.calls, 'stage_vault_secret_for_org')[0].bodyJson as Record<string, unknown>;
    assertEquals([stage.p_org_id, stage.p_external_tier, stage.p_secret_value, stage.p_actor_id], ['org-1', 'odoo', SENTINEL, 'user-1']);
    const fin = rpcCall(r.calls, 'finalize_odoo_connect')[0].bodyJson as Record<string, unknown>;
    assertEquals(fin, {
      p_org_id: 'org-1', p_secret_ref: stage.p_secret_name, p_site_url: SITE, p_database: 'db1', p_key_expires_on: '2027-01-31',
      p_discard: false, p_kill_switch_enabled: true, p_actor_id: 'user-1',
    });
    assertEquals(rpcCall(r.calls, 'cleanup_external_connect_attempt').length, 0);
    assertNoLeak(r);
    const json2 = odooCalls(r.calls).filter((c) => c.url.pathname.startsWith('/json/2/'));
    assertEquals(json2.length, 1);
    assertEquals(json2[0].headers.get('authorization'), `bearer ${SENTINEL}`);
    assertEquals(json2[0].headers.get('x-odoo-database'), 'db1');
  });

  it('FR-ODC-006 a confirmed discard is passed through to finalize', async () => {
    const r = await connect({ confirmDiscard: true });
    assertEquals(r.res.status, 200);
    assertEquals((rpcCall(r.calls, 'finalize_odoo_connect')[0].bodyJson as Record<string, unknown>).p_discard, true);
  });
});

describe('external-connect — AC-ODC-003 the sentinel key never leaks', () => {
  it('AC-ODC-003 validation fails on an Odoo 500 whose body carries the key → 502, nothing staged', async () => {
    const r = await connect({}, { companies: () => new Response(`Traceback ... ${SENTINEL}`, { status: 500 }) });
    assertEquals(r.res.status, 502);
    assertEquals(body(r.text).error, 'server-error');
    assertEquals(rpcCall(r.calls, 'stage_vault_secret_for_org').length, 0);
    assertNoLeak(r);
  });

  it('AC-ODC-003 the vault write fails → 500, the attempt is cleaned up by its own reference', async () => {
    const r = await connect({}, { stage: () => pgError(`could not store ${SENTINEL}`, 'XX000') });
    assertEquals(r.res.status, 500);
    assertEquals(body(r.text).error, 'CONNECT_NOT_COMMITTED');
    const stage = rpcCall(r.calls, 'stage_vault_secret_for_org')[0].bodyJson as Record<string, unknown>;
    assertEquals((rpcCall(r.calls, 'cleanup_external_connect_attempt')[0].bodyJson as Record<string, unknown>).p_secret_ref, stage.p_secret_name);
    assertEquals(rpcCall(r.calls, 'finalize_odoo_connect').length, 0);
    assertNoLeak(r);
  });

  it('AC-ODC-003 finalize fails → 500, cleanup ran with the staged reference', async () => {
    const r = await connect({}, { finalize: () => pgError(`binding is not active ${SENTINEL}`) });
    assertEquals(r.res.status, 500);
    assertEquals(body(r.text).error, 'CONNECT_NOT_COMMITTED');
    const stage = rpcCall(r.calls, 'stage_vault_secret_for_org')[0].bodyJson as Record<string, unknown>;
    const cleanup = rpcCall(r.calls, 'cleanup_external_connect_attempt')[0].bodyJson as Record<string, unknown>;
    assertEquals([cleanup.p_org_id, cleanup.p_external_tier, cleanup.p_secret_ref, cleanup.p_actor_id], ['org-1', 'odoo', stage.p_secret_name, 'user-1']);
    assertNoLeak(r);
  });
});

describe('external-connect — Odoo wire classes', () => {
  const cases: Array<[string, () => Response, number, string]> = [
    ['key-rejected', () => jsonResponse({ name: 'odoo.exceptions.AccessDenied', message: SENTINEL }, { status: 401 }), 422, 'key-rejected'],
    ['database-not-found', () => jsonResponse({ name: 'odoo.exceptions.DatabaseNotFound', message: 'db' }, { status: 404 }), 422, 'database-not-found'],
    ['access-denied', () => jsonResponse({ name: 'odoo.exceptions.AccessError', message: 'm' }, { status: 403 }), 422, 'access-denied'],
    ['a redirect (not followed)', () => new Response(null, { status: 302, headers: { location: 'https://elsewhere.example.test/' } }), 422, 'not-odoo'],
  ];
  for (const [label, res, status, code] of cases) {
    it(`FR-ODC-002 ${label} → ${status} ${code}, nothing staged`, async () => {
      const r = await connect({}, { companies: res });
      assertEquals([r.res.status, body(r.text).error], [status, code]);
      assertEquals(rpcCall(r.calls, 'stage_vault_secret_for_org').length, 0);
      assertNoLeak(r);
    });
  }

  it('FR-ODC-002 an HTML 404 from an Odoo older than 19 → 422 no-json2, nothing staged', async () => {
    const r = await connect({}, { companies: () => new Response('<html>404</html>', { status: 404 }), versionMajor: 17 });
    assertEquals([r.res.status, body(r.text).error], [422, 'no-json2']);
    assertEquals(rpcCall(r.calls, 'stage_vault_secret_for_org').length, 0);
  });

  it('FR-ODC-002 an HTML 404 from Odoo 20 (a pinned host, another database) → 422 database-not-found, nothing staged', async () => {
    const r = await connect({ database: 'other' }, { companies: () => new Response('<html>404</html>', { status: 404 }) });
    assertEquals([r.res.status, body(r.text).error], [422, 'database-not-found']);
    assertEquals(rpcCall(r.calls, 'stage_vault_secret_for_org').length, 0);
  });

  it('FR-ODC-002 a timeout → 502 timeout', async () => {
    const r = await connect({}, { companies: () => { throw new DOMException('t', 'TimeoutError'); } });
    assertEquals([r.res.status, body(r.text).error], [502, 'timeout']);
  });

  const finalizeCases: Array<[string, number, string]> = [
    ['different Odoo database; confirm discard', 409, 'confirm-discard'],
    ['Odoo documents already reference this connection', 409, 'target-locked'],
    ['another ERP tier is active', 409, 'another-erp-active'],
  ];
  for (const [message, status, code] of finalizeCases) {
    it(`FR-ODC-006 finalize "${message}" → ${status} ${code}, cleaned up`, async () => {
      const r = await connect({}, { finalize: () => pgError(message) });
      assertEquals([r.res.status, body(r.text).error], [status, code]);
      assertEquals(rpcCall(r.calls, 'cleanup_external_connect_attempt').length, 1);
      assert(!r.text.includes(message), 'the RPC message is never echoed');
    });
  }
});

describe('external-connect — Odoo refusals before any request or write', () => {
  it('FR-ODC-008 an active ERPNext binding → 409 another-erp-active, no Odoo call, no stage', async () => {
    const r = await connect({}, { erpActive: true });
    assertEquals([r.res.status, body(r.text).error], [409, 'another-erp-active']);
    assertEquals(odooCalls(r.calls).length, 0);
    assertEquals(rpcCall(r.calls, 'stage_vault_secret_for_org').length, 0);
  });

  it('FR-ODC-008 the one-tier check failing → 500, fail closed: no Odoo call, no stage', async () => {
    const r = await connect({}, { erpCheckFails: true });
    assertEquals([r.res.status, body(r.text).error], [500, 'CONNECT_NOT_COMMITTED']);
    assertEquals(odooCalls(r.calls).length, 0);
    assertEquals(rpcCall(r.calls, 'stage_vault_secret_for_org').length, 0);
  });

  it('FR-ODC-001 a non-Admin → 403, nothing read from Odoo', async () => {
    const r = await connect({}, { role: 'Finance' });
    assertEquals(r.res.status, 403);
    assertEquals(odooCalls(r.calls).length, 0);
  });

  for (const missing of ['siteUrl', 'database', 'apiKey']) {
    it(`FR-ODC-001 a missing ${missing} → 400`, async () => {
      const r = await connect({ [missing]: '' });
      assertEquals(r.res.status, 400);
      assertEquals(odooCalls(r.calls).length, 0);
    });
  }

  it('FR-ODC-100 a key with a colon is refused (the resolver could never use it) → 400', async () => {
    const r = await connect({ apiKey: 'a:b' });
    assertEquals(r.res.status, 400);
    assertEquals(rpcCall(r.calls, 'stage_vault_secret_for_org').length, 0);
  });

  // AC-ODC-001 secondary U: each destination is refused before any Odoo request or write.
  const refused: Array<[string, string]> = [
    ['private', 'https://10.0.0.5'],
    ['loopback', 'https://127.0.0.1'],
    ['localhost', 'https://localhost'],
    ['link-local', 'https://169.254.10.10'],
    ['metadata', 'https://169.254.169.254'],
    ['metadata name', 'https://metadata.google.internal'],
    ['http', `http://${ODOO}`],
    ['not a URL', 'odoo.example.test'],
  ];
  for (const [label, siteUrl] of refused) {
    it(`AC-ODC-001 a ${label} site is refused → 422 destination-refused, no request, no write`, async () => {
      const r = await connect({ siteUrl });
      assertEquals([r.res.status, body(r.text).error], [422, 'destination-refused']);
      assertEquals(r.calls.filter((c) => !c.url.pathname.startsWith('/rest/v1/profiles') && !c.url.pathname.startsWith('/rest/v1/platform_operators')
        && c.url.pathname !== '/rest/v1/external_org_bindings' && !c.url.pathname.startsWith('/auth/')).length, 0);
    });
  }

  it('AC-ODC-001 a non-resolving host is refused before any request or write', async () => {
    const original = Deno.resolveDns;
    try {
      const r = await withFetchMock(routes(), async ({ calls }) => {
        Deno.resolveDns = (() => Promise.reject(new Deno.errors.NotFound('nx'))) as typeof Deno.resolveDns;
        const res = await handleConnectRequest(await request({ siteUrl: 'https://nx.example.test' }));
        return { res, calls };
      });
      assertEquals([r.res.status, (await r.res.json()).error], [422, 'destination-refused']);
      assertEquals(rpcCall(r.calls, 'stage_vault_secret_for_org').length, 0);
      assertEquals(r.calls.filter((c) => c.url.host === 'nx.example.test').length, 0);
    } finally { Deno.resolveDns = original; }
  });

  it('AC-ODC-001 a host resolving to a private address is refused before any request or write', async () => {
    const original = Deno.resolveDns;
    try {
      const r = await withFetchMock(routes(), async ({ calls }) => {
        Deno.resolveDns = ((_h: string, t: string) => Promise.resolve(t === 'A' ? ['10.1.2.3'] : [])) as typeof Deno.resolveDns;
        const res = await handleConnectRequest(await request({}));
        return { res, calls };
      });
      assertEquals([r.res.status, (await r.res.json()).error], [422, 'destination-refused']);
      assertEquals(odooCalls(r.calls).length, 0);
    } finally { Deno.resolveDns = original; }
  });
});

describe('external-connect — FR-ODC-008 the other direction', () => {
  it('FR-ODC-008 an ERPNext connect while Odoo is active → 409 another-erp-active, no vault write', async () => {
    await withFetchMock([
      supabaseSelect('profiles', () => one({ org_id: 'org-1', role: 'Admin' })),
      supabaseSelect('platform_operators', none),
      supabaseSelect('external_org_bindings', () => one({ external_tier: 'odoo' })),
      { label: 'erp', host: 'erp.example.com', pathname: '/api/method/frappe.auth.get_logged_user', response: () => jsonResponse({ message: 'u@example.com' }) },
      supabaseRpc('create_vault_secret_for_org', () => jsonResponse('ref')),
    ], async ({ calls }) => {
      const res = await handleConnectRequest(createAuthedRequest('http://edge.test/connect',
        { tier: 'erpnext', credential: { siteUrl: 'https://erp.example.com', apiKey: 'k', apiSecret: 's' } }, await auth.mintJwt({ sub: 'user-1' })));
      assertEquals([res.status, (await res.json()).error], [409, 'another-erp-active']);
      assertEquals(rpcCall(calls, 'create_vault_secret_for_org').length, 0);
      const check = calls.find((c) => c.url.pathname === '/rest/v1/external_org_bindings')!;
      assertEquals([check.url.searchParams.get('external_tier'), check.url.searchParams.get('status')], ['eq.odoo', 'eq.active']);
    });
  });

  it('FR-ODC-008 the ERPNext-side check failing → 500, fail closed, no vault write', async () => {
    await withFetchMock([
      supabaseSelect('profiles', () => one({ org_id: 'org-1', role: 'Admin' })),
      supabaseSelect('platform_operators', none),
      supabaseSelect('external_org_bindings', () => pgError('boom', 'XX000')),
      { label: 'erp', host: 'erp.example.com', pathname: '/api/method/frappe.auth.get_logged_user', response: () => jsonResponse({ message: 'u@example.com' }) },
      supabaseRpc('create_vault_secret_for_org', () => jsonResponse('ref')),
    ], async ({ calls }) => {
      const res = await handleConnectRequest(createAuthedRequest('http://edge.test/connect',
        { tier: 'erpnext', credential: { siteUrl: 'https://erp.example.com', apiKey: 'k', apiSecret: 's' } }, await auth.mintJwt({ sub: 'user-1' })));
      assertEquals([res.status, (await res.json()).error], [500, 'CONNECT_NOT_COMMITTED']);
      assertEquals(rpcCall(calls, 'create_vault_secret_for_org').length, 0);
    });
  });
});
