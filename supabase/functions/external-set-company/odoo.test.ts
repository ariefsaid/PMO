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
import { createFakeOdoo } from '../../../pmo-portal/src/lib/adapterSeam/odoo/fakeOdoo.ts';

const env = installEdgeEnv();
const auth = await createJwtAuthority(env.SUPABASE_URL);
setTestJwks(createTestJwksResolver(auth));
afterAll(() => env.restore());

const ODOO = 'odoo.example.test';
const KEY = 'stored-odoo-key';
const one = (body: unknown) => jsonResponse(body, { headers: { 'content-type': 'application/vnd.pgrst.object+json' } });
const none = () => new Response('null', { status: 200, headers: { 'content-type': 'application/json' } });
const pgError = (message: string) => jsonResponse({ code: 'P0001', message, details: null, hint: null }, { status: 400 });

interface Opts { role?: string; operator?: boolean; active?: boolean; activate?: () => Response; binding?: Record<string, unknown> }
function setup(o: Opts = {}) {
  const fake = createFakeOdoo({ key: KEY });
  fake.seed('res.company', [{ id: 1, name: 'Main Co' }, { id: 2, name: 'Second Co' }]);
  const routes: MockRoute[] = [
    supabaseSelect('profiles', () => one({ org_id: 'org-1', role: o.role ?? 'Admin' })),
    supabaseSelect('platform_operators', () => (o.operator ? one({ user_id: 'user-1' }) : none())),
    supabaseRpc('actor_authorization_state', () => jsonResponse({ active: o.active ?? true })),
    supabaseSelect('external_org_bindings', () => one(o.binding ?? {
      site_url: `https://${ODOO}`, secret_ref: 'odoo_ref', status: 'active', activated_at: null, config: { database: 'db1' } })),
    supabaseRpc('read_vault_secret', () => jsonResponse(KEY)),
    { label: 'odoo-json2', host: ODOO, pathname: /^\/json\/2\//,
      response: (c: FetchCall) => fake.fetch(c.url.toString(), { method: 'POST', headers: { Authorization: c.headers.get('authorization') ?? '' }, body: c.bodyText }) },
    { label: 'odoo-version', host: ODOO, pathname: '/web/webclient/version_info',
      response: () => jsonResponse({ result: { server_version_info: [20, 0, 0, 'final', 0, ''] } }) },
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
    assertEquals(rpcCall(r.calls, 'activate_odoo_binding')[0].bodyJson, {
      p_org_id: 'org-1', p_version_major: 20, p_company_id: 1, p_company_name: 'Main Co', p_config_patch: {}, p_actor_id: 'user-1' });
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
