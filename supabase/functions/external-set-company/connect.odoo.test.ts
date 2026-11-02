/**
 * external-set-company — the ECA setup verbs for tier `odoo` (#1504 S6-T1, FR-ECA-001/012). Real handler from ./index.ts; Supabase
 * mocked over fetch, Odoo by the in-memory fake. The census is read-only on Odoo and lifts the "no sweep pass" refusal.
 */
import { afterAll, describe, it } from '@std/testing/bdd';
import { assertEquals } from '@std/assert';
import { handleSetCompanyRequest, setTestJwks } from './index.ts';
import {
  countResponse, createAuthedRequest, createJwtAuthority, createTestJwksResolver, installEdgeEnv, jsonResponse, rpcCall,
  supabaseRpc, supabaseSelect, withFetchMock, type FetchCall, type MockRoute,
} from '../_shared/testing/edgeTestKit.ts';
import { createFakeOdoo, type FakeOdoo } from '../../../pmo-portal/src/lib/adapterSeam/odoo/fakeOdoo.ts';

const env = installEdgeEnv();
Deno.env.set('SUPABASE_ANON_KEY', 'test-anon-key');
const auth = await createJwtAuthority(env.SUPABASE_URL);
setTestJwks(createTestJwksResolver(auth));
const realSetTimeout = globalThis.setTimeout;
globalThis.setTimeout = ((fn: () => void) => { queueMicrotask(fn); return 0; }) as unknown as typeof setTimeout;
afterAll(() => { env.restore(); Deno.env.delete('SUPABASE_ANON_KEY'); globalThis.setTimeout = realSetTimeout; });

const ODOO = 'odoo.example.test';
const KEY = 'stored-odoo-key';
const one = (body: unknown) => jsonResponse(body, { headers: { 'content-type': 'application/vnd.pgrst.object+json' } });
const none = () => new Response('null', { status: 200, headers: { 'content-type': 'application/json' } });
const partner = (id: number, over: Record<string, unknown> = {}) => ({ id, name: `P${id}`, vat: false, ref: false, is_company: true, parent_id: false, active: true, supplier_rank: 1, customer_rank: 0, ...over });

interface Opts { role?: string; plan?: number | null; down?: boolean; prepare?: (f: FakeOdoo) => void; rpc?: Record<string, (c: FetchCall) => Response> }
function routes(fake: FakeOdoo, o: Opts): MockRoute[] {
  const rpc = (fn: string, fallback: unknown) => supabaseRpc(fn, o.rpc?.[fn] ?? (() => jsonResponse(fallback)));
  return [
    supabaseSelect('profiles', () => one({ org_id: 'org-1', role: o.role ?? 'Admin' })),
    supabaseSelect('platform_operators', () => none()),
    supabaseRpc('actor_authorization_state', () => jsonResponse({ active: true })),
    supabaseSelect('external_org_bindings', () => one({
      id: 'b1', site_url: `https://${ODOO}`, secret_ref: 'odoo_ref', status: 'active', activated_at: '2026-11-01T00:00:00Z',
      config: { database: 'db1', odoo_company_id: 1, ...(o.plan === null ? {} : { analytic_plan_id: o.plan ?? 7 }) } })),
    supabaseRpc('read_vault_secret', () => jsonResponse(KEY)),
    { label: 'odoo-json2', host: ODOO, pathname: /^\/json\/2\//,
      response: (c: FetchCall) => (o.down ? new Response('no', { status: 503 }) : fake.fetch(c.url.toString(), { method: 'POST', headers: { Authorization: c.headers.get('authorization') ?? '' }, body: c.bodyText })) },
    { label: 'pmo-head', method: 'HEAD', pathname: /^\/rest\/v1\//, response: () => countResponse(2) },
    supabaseSelect('procurement_items', () => jsonResponse([{ id: 'i1', name: 'Semen' }])),
    rpc('start_connect_run', 'run-1'),
    rpc('write_connect_census', null),
    rpc('accept_connect_proposals', { counts: {}, remaining: 0 }),
  ];
}

async function call(body: Record<string, unknown>, o: Opts = {}) {
  const fake = createFakeOdoo({ key: KEY });
  fake.seed('res.company', [{ id: 1, name: 'Main Co', partner_id: [99, 'Main Co'] }]);
  o.prepare?.(fake);
  const jwt = await auth.mintJwt({ sub: 'user-1' });
  return await withFetchMock(routes(fake, o), async ({ calls }) => {
    const res = await handleSetCompanyRequest(createAuthedRequest('http://edge.test/set-company', { tier: 'odoo', ...body }, jwt));
    return { res, json: JSON.parse(await res.text()) as Record<string, unknown>, calls, fake };
  });
}
const rows = (r: { calls: FetchCall[] }) => (rpcCall(r.calls, 'write_connect_census')[0].bodyJson as { p_rows: Array<{ kind: string; pmoCount: number; erpCount: number | null; scenario: string | null }> }).p_rows;

describe('ECA setup verbs for Odoo — census', () => {
  it('FR-ECA-001 an Admin takes the census: both sides counted, nothing written to Odoo, nothing taken from the request body', async () => {
    const r = await call({ setupAction: 'census', orgId: 'org-other' }, { prepare: (f) => {
      f.seed('res.partner', [partner(1), partner(2, { supplier_rank: 0, customer_rank: 1 }), partner(3, { is_company: false, parent_id: [1, 'P1'] })]);
      f.seed('account.analytic.account', [{ id: 10, name: 'Jembatan', code: 'PRJ-26-0001', plan_id: [7, 'Projects'], company_id: false }]);
    } });
    assertEquals([r.res.status, r.json.runId], [200, 'run-1']);
    const start = rpcCall(r.calls, 'start_connect_run')[0].bodyJson as Record<string, unknown>;
    assertEquals([start.p_org_id, start.p_tier, start.p_actor], ['org-1', 'odoo', 'user-1']);
    const party = rows(r).find((x) => x.kind === 'party')!;
    assertEquals([party.pmoCount, party.erpCount, party.scenario], [2, 2, 'S-D']);   // the child contact is not a party
    assertEquals(rows(r).find((x) => x.kind === 'project')?.erpCount, 1);
    assertEquals(rows(r).find((x) => x.kind === 'invoice')?.erpCount, null);   // a money domain Odoo cannot count yet is "not checked", never 0
    assertEquals(r.fake.calls.filter((c) => ['create', 'write', 'unlink'].includes(c.method)).length, 0);
    assertEquals(JSON.stringify(r.calls.map((c) => c.url.toString())).includes('org-other'), false);
  });

  it('people are not served by Odoo yet and no analytic plan is chosen: both count 0 and the census still completes', async () => {
    const r = await call({ setupAction: 'census' }, { plan: null });
    assertEquals(r.res.status, 200);
    assertEquals(rows(r).filter((x) => x.kind === 'employee' || x.kind === 'project').map((x) => x.erpCount), [0, 0]);
  });

  it('NFR-ECA-003 an unreachable Odoo fails the census before any run is started', async () => {
    const r = await call({ setupAction: 'census' }, { down: true });
    assertEquals(r.res.status >= 500, true);
    assertEquals(rpcCall(r.calls, 'start_connect_run').length, 0);
  });

  it('FR-ECA-002 Finance and Engineer cannot take a census', async () => {
    for (const role of ['Finance', 'Engineer']) {
      const r = await call({ setupAction: 'census' }, { role });
      assertEquals(r.res.status, 403);
      assertEquals(rpcCall(r.calls, 'start_connect_run').length, 0);
    }
  });

  it('FR-ECA-012 accept-all for Odoo is the same RPC as for ERPNext, run as the caller, naming the tier', async () => {
    const r = await call({ setupAction: 'accept-proposals', kind: 'party' });
    assertEquals(r.res.status, 200);
    const a = rpcCall(r.calls, 'accept_connect_proposals')[0].bodyJson as Record<string, unknown>;
    assertEquals([a.p_tier, a.p_kind], ['odoo', 'party']);
    assertEquals(r.calls.some((c) => c.url.host === ODOO), false);
  });
});
