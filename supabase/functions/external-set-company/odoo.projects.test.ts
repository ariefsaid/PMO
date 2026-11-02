/**
 * external-set-company — the Odoo project-link verbs (#1504 S6, AC-ODC-050/053, FR-ODC-070/071). Real handler from ./index.ts;
 * Supabase mocked over fetch. The verbs never call Odoo: they read the mirror and write through the actor-checked RPCs,
 * which decide who may link. Odoo's Project application is never involved (AC-ODC-051 asserts that on the bed).
 */
import { afterAll, describe, it } from '@std/testing/bdd';
import { assertEquals } from '@std/assert';
import { handleSetCompanyRequest, setTestJwks } from './index.ts';
import {
  createAuthedRequest, createJwtAuthority, createTestJwksResolver, installEdgeEnv, jsonResponse, rpcCall,
  supabaseRpc, supabaseSelect, withFetchMock, type FetchCall, type MockRoute,
} from '../_shared/testing/edgeTestKit.ts';

const env = installEdgeEnv();
const auth = await createJwtAuthority(env.SUPABASE_URL);
setTestJwks(createTestJwksResolver(auth));
afterAll(() => env.restore());

const PROJECT = '0b000000-0000-4000-8000-0000000000c1';
const one = (body: unknown) => jsonResponse(body, { headers: { 'content-type': 'application/vnd.pgrst.object+json' } });
const none = () => new Response('null', { status: 200, headers: { 'content-type': 'application/json' } });
const pgError = (code: string, message: string) => jsonResponse({ code, message, details: null, hint: null }, { status: 400 });

interface Opts { accounts?: number; role?: string; active?: boolean; plan?: number | null; rpc?: Record<string, (c: FetchCall) => Response> }
function routes(o: Opts): MockRoute[] {
  const rpc = (fn: string) => supabaseRpc(fn, o.rpc?.[fn] ?? (() => jsonResponse(null)));
  return [
    supabaseSelect('profiles', () => one({ org_id: 'org-1', role: o.role ?? 'Admin' })),
    supabaseSelect('platform_operators', () => none()),
    supabaseRpc('actor_authorization_state', () => jsonResponse({ active: o.active ?? true })),
    supabaseSelect('external_org_bindings', () => one({ config: o.plan === null ? {} : { analytic_plan_id: o.plan ?? 7 } })),
    supabaseSelect('external_master_records', (c) => {
      const kind = (c.url.searchParams.get('kind') ?? '').replace('eq.', '');
      return jsonResponse(kind === 'analytic_plan'
        ? [{ external_id: '7', name: 'Projects' }, { external_id: '8', name: 'Other' }]
        : o.accounts !== undefined
          ? Array.from({ length: o.accounts }, (_, i) => ({ external_id: String(i + 1), code: `A${i}`, name: `Account ${i}` }))
          : [{ external_id: '101', code: 'PRJ-1', name: 'Bridge One' }, { external_id: '102', code: 'PRJ-2', name: 'Bridge Two' }]);
    }),
    supabaseSelect('external_project_bindings', () => jsonResponse([{ project_id: PROJECT, external_container_id: '101' }])),
    rpc('link_odoo_cost_account'), rpc('unlink_odoo_cost_account'), rpc('set_odoo_analytic_plan'),
  ];
}
async function call(body: Record<string, unknown>, o: Opts = {}) {
  const jwt = await auth.mintJwt({ sub: 'user-1' });
  return await withFetchMock(routes(o), async ({ calls }) => {
    const res = await handleSetCompanyRequest(createAuthedRequest('http://edge.test/set-company', { tier: 'odoo', ...body }, jwt));
    return { res, json: JSON.parse(await res.text()) as Record<string, unknown>, calls };
  });
}
const mirrorRead = (calls: FetchCall[], kind: string) => calls.find((c) => c.url.pathname === '/rest/v1/external_master_records' && c.url.searchParams.get('kind') === `eq.${kind}`)!;

describe('Odoo router — list-projects', () => {
  it('FR-ODC-071 lists only the chosen plan\'s live accounts of this org, with who holds each, and never calls Odoo', async () => {
    const r = await call({ setupAction: 'list-projects' });
    assertEquals(r.res.status, 200);
    assertEquals(r.json, { planId: 7, accounts: [{ id: '101', code: 'PRJ-1', name: 'Bridge One' }, { id: '102', code: 'PRJ-2', name: 'Bridge Two' }], truncated: false, linked: [{ projectId: PROJECT, accountId: '101' }] });
    const read = mirrorRead(r.calls, 'analytic_account');
    assertEquals([read.url.searchParams.get('org_id'), read.url.searchParams.get('external_tier'), read.url.searchParams.get('parent_external_id'), read.url.searchParams.get('active'), read.url.searchParams.get('tombstoned_at')],
      ['eq.org-1', 'eq.odoo', 'eq.7', 'eq.true', 'is.null']);
    assertEquals(r.calls.filter((c) => c.url.host.startsWith('odoo')).length, 0);
  });

  it('a plan with more accounts than one page says so, and returns exactly one page', async () => {
    const r = await call({ setupAction: 'list-projects' }, { accounts: 1001 });
    assertEquals([r.json.truncated, (r.json.accounts as unknown[]).length], [true, 1000]);
    assertEquals(mirrorRead(r.calls, 'analytic_account').url.searchParams.get('limit'), '1001');
  });

  it('with no plan chosen it offers the plans to choose from and no accounts', async () => {
    const r = await call({ setupAction: 'list-projects' }, { plan: null });
    assertEquals(r.json, { planId: null, plans: [{ id: '7', name: 'Projects' }, { id: '8', name: 'Other' }], accounts: [], linked: [] });
    assertEquals(r.calls.some((c) => c.url.pathname === '/rest/v1/external_master_records' && c.url.searchParams.get('kind') === 'eq.analytic_account'), false);
  });

  it('an inactive member is refused', async () => {
    const r = await call({ setupAction: 'list-projects' }, { active: false });
    assertEquals(r.res.status, 403);
  });
});

describe('Odoo router — link-project / unlink-project', () => {
  it('AC-ODC-050 link-project calls the actor-checked RPC with the CALLER as actor and the org from their profile', async () => {
    const r = await call({ setupAction: 'link-project', projectId: PROJECT, accountId: '101', orgId: 'org-other', actorId: 'someone-else' }, { role: 'Project Manager' });
    assertEquals(r.res.status, 200);
    assertEquals(rpcCall(r.calls, 'link_odoo_cost_account')[0].bodyJson, { p_org_id: 'org-1', p_actor_id: 'user-1', p_project_id: PROJECT, p_account_id: '101' });
  });

  for (const [code, message, status] of [['42501', 'current authority required', 403], ['23505', 'cost account already linked to PRJ-26-0001', 409], ['P0001', 'not a cost account of the chosen plan', 409]] as const) {
    it(`AC-ODC-050 an RPC refusal ${code} → ${status}, in the database's plain words`, async () => {
      const r = await call({ setupAction: 'link-project', projectId: PROJECT, accountId: '101' }, { rpc: { link_odoo_cost_account: () => pgError(code, message) } });
      assertEquals(r.res.status, status);
      assertEquals(code === '42501' ? 'Not allowed for your role' : message, r.json.message);
    });
  }

  it('an unexpected database failure is a generic 500, never its text', async () => {
    const r = await call({ setupAction: 'link-project', projectId: PROJECT, accountId: '101' }, { rpc: { link_odoo_cost_account: () => pgError('XX000', 'relation "secret_table" missing') } });
    assertEquals(r.res.status, 500);
    assertEquals(JSON.stringify(r.json).includes('secret_table'), false);
  });

  it('a project id that is not a uuid and an account id that is not a number never reach the database', async () => {
    for (const body of [{ projectId: 'x', accountId: '101' }, { projectId: PROJECT, accountId: '1; drop' }, { projectId: PROJECT }]) {
      const r = await call({ setupAction: 'link-project', ...body });
      assertEquals(r.res.status, 400);
      assertEquals(rpcCall(r.calls, 'link_odoo_cost_account').length, 0);
    }
  });

  it('AC-ODC-053 unlink-project calls its RPC as the caller; a project in use is refused with the database\'s words', async () => {
    const ok = await call({ setupAction: 'unlink-project', projectId: PROJECT });
    assertEquals(ok.res.status, 200);
    assertEquals(rpcCall(ok.calls, 'unlink_odoo_cost_account')[0].bodyJson, { p_org_id: 'org-1', p_actor_id: 'user-1', p_project_id: PROJECT });
    const used = await call({ setupAction: 'unlink-project', projectId: PROJECT }, { rpc: { unlink_odoo_cost_account: () => pgError('P0001', 'project link is in use') } });
    assertEquals([used.res.status, used.json.message], [409, 'project link is in use']);
  });
});

describe('Odoo router — set-analytic-plan', () => {
  it('FR-ODC-071 an Admin chooses the plan; the RPC gets the caller and the plan id', async () => {
    const r = await call({ setupAction: 'set-analytic-plan', planId: '7' });
    assertEquals(r.res.status, 200);
    assertEquals(rpcCall(r.calls, 'set_odoo_analytic_plan')[0].bodyJson, { p_org_id: 'org-1', p_actor_id: 'user-1', p_plan_id: '7' });
  });

  it('only an Admin or an Operator reaches the RPC; a plan id that is not a number never does', async () => {
    const eng = await call({ setupAction: 'set-analytic-plan', planId: '7' }, { role: 'Project Manager' });
    assertEquals(eng.res.status, 403);
    const bad = await call({ setupAction: 'set-analytic-plan', planId: 'seven' });
    assertEquals(bad.res.status, 400);
    assertEquals([...eng.calls, ...bad.calls].filter((c) => c.url.pathname.endsWith('/set_odoo_analytic_plan')).length, 0);
  });
});
