/**
 * external-set-company — the Odoo map-once verbs (#1504 S7, AC-ODC-096 wire, AC-ODC-041 U, AC-ODC-070). Real handler from ./index.ts;
 * Supabase mocked over fetch. `propose-config` reads the org's mirror and proposes; `save-defaults` writes through `set_odoo_org_config`
 * once per key with the whole merged object. Odoo is never called.
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

const one = (body: unknown) => jsonResponse(body, { headers: { 'content-type': 'application/vnd.pgrst.object+json' } });
const none = () => new Response('null', { status: 200, headers: { 'content-type': 'application/json' } });
const pgError = (code: string, message: string) => jsonResponse({ code, message, details: null, hint: null }, { status: 400 });

const row = (id: string, name: string, attrs: Record<string, unknown> = {}, code: string | null = null) => ({ external_id: id, name, code, attrs, active: true, tombstoned_at: null });
const MIRROR: Record<string, unknown[]> = {
  account: [row('1', 'Payable', { account_type: 'liability_payable' }, '2100'), row('2', 'Receivable', { account_type: 'asset_receivable' }, '1200'),
    row('3', 'Cash A', { account_type: 'asset_cash' }, '1010'), row('4', 'Cash B', { account_type: 'asset_cash' }, '1020')],
  uom: [row('5', 'm'), row('6', 'm2'), row('7', 'unit')],
  warehouse: [row('1', 'Main', {}, 'WH')],
};

interface Opts { role?: string; active?: boolean; config?: Record<string, unknown>; units?: string[]; mirror?: Record<string, unknown[]>; rpc?: Record<string, (c: FetchCall) => Response> }
function routes(o: Opts): MockRoute[] {
  const rpc = (fn: string, fallback: () => Response) => supabaseRpc(fn, o.rpc?.[fn] ?? fallback);
  return [
    supabaseSelect('profiles', () => one({ org_id: 'org-1', role: o.role ?? 'Admin' })),
    supabaseSelect('platform_operators', () => none()),
    supabaseRpc('actor_authorization_state', () => jsonResponse({ active: o.active ?? true })),
    supabaseSelect('external_org_bindings', () => one({ config: o.config ?? {} })),
    supabaseSelect('external_master_records', (c) => jsonResponse((o.mirror ?? MIRROR)[(c.url.searchParams.get('kind') ?? '').replace('eq.', '')] ?? [])),
    rpc('odoo_pmo_units', () => jsonResponse(o.units ?? ['m', 'm2', 'm3'])),
    rpc('set_odoo_org_config', () => jsonResponse(null)),
  ];
}
async function call(body: Record<string, unknown>, o: Opts = {}) {
  const jwt = await auth.mintJwt({ sub: 'user-1' });
  return await withFetchMock(routes(o), async ({ calls }) => {
    const res = await handleSetCompanyRequest(createAuthedRequest('http://edge.test/set-company', { tier: 'odoo', ...body }, jwt));
    return { res, json: JSON.parse(await res.text()) as Record<string, unknown>, calls };
  });
}
const setCalls = (calls: FetchCall[]) => rpcCall(calls, 'set_odoo_org_config').map((c) => c.bodyJson as Record<string, unknown>);

describe('Odoo router — propose-config', () => {
  it('AC-ODC-096 proposes from this org\'s mirror: unique values pre-filled, ambiguous rows to choose, units with their mapped state', async () => {
    const r = await call({ setupAction: 'propose-config' }, { config: { unit_map: { m: '5', m2: '6' } } });
    assertEquals(r.res.status, 200);
    const proposals = r.json.proposals as Array<Record<string, unknown>>;
    assertEquals(proposals.find((p) => p.key === 'account_defaults.payable'), { key: 'account_defaults.payable', value: '1', reason: 'unique' });
    assertEquals(proposals.find((p) => p.key === 'account_defaults.bank'), { key: 'account_defaults.bank', candidates: ['3', '4'], reason: 'choose' });
    assertEquals(proposals.find((p) => p.key === 'default_warehouse_id'), { key: 'default_warehouse_id', value: '1', reason: 'unique' });
    assertEquals(r.json.units, [{ unit: 'm', mapped: true }, { unit: 'm2', mapped: true }, { unit: 'm3', mapped: false }]);
    assertEquals(proposals.find((p) => p.key === 'unit_map.m3'), { key: 'unit_map.m3', candidates: [], reason: 'choose' });
    assertEquals((r.json.uoms as unknown[]).length, 3);
    assertEquals(r.calls.filter((c) => c.url.host.startsWith('odoo')).length, 0);
  });

  it('every mirror read is scoped to the caller\'s org, tier odoo, live rows', async () => {
    const r = await call({ setupAction: 'propose-config' });
    const reads = r.calls.filter((c) => c.url.pathname === '/rest/v1/external_master_records');
    assertEquals(reads.length, 3);
    for (const read of reads) {
      assertEquals([read.url.searchParams.get('org_id'), read.url.searchParams.get('external_tier'), read.url.searchParams.get('active'), read.url.searchParams.get('tombstoned_at')], ['eq.org-1', 'eq.odoo', 'eq.true', 'is.null']);
    }
    assertEquals(rpcCall(r.calls, 'odoo_pmo_units')[0].bodyJson, { p_org_id: 'org-1' });
  });

  it('AC-ODC-070 a saved default whose record is no longer live is flagged as needing attention', async () => {
    const r = await call({ setupAction: 'propose-config' }, { config: { account_defaults: { payable: '1', bank: '99' }, unit_map: { m: '5', gone: '55' }, default_warehouse_id: '9' } });
    assertEquals(r.json.attention, ['account_defaults.bank', 'unit_map.gone', 'default_warehouse_id']);
    assertEquals(r.json.current, { account_defaults: { payable: '1', bank: '99' }, unit_map: { m: '5', gone: '55' }, default_warehouse_id: '9' });
  });

  it('AC-ODC-070 only Admin and Finance reach it; an Executive, a PM, an Engineer and an inactive member do not', async () => {
    for (const role of ['Executive', 'Project Manager', 'Engineer']) assertEquals((await call({ setupAction: 'propose-config' }, { role })).res.status, 403);
    assertEquals((await call({ setupAction: 'propose-config' }, { active: false })).res.status, 403);
    assertEquals((await call({ setupAction: 'propose-config' }, { role: 'Finance' })).res.status, 200);
  });
});

describe('Odoo router — save-defaults', () => {
  it('AC-ODC-096 "Accept all": one request writes every key it carries, once each, with the whole merged object and the caller as actor', async () => {
    const r = await call({ setupAction: 'save-defaults', account_defaults: { payable: '1' }, unit_map: { m3: '7' }, default_warehouse_id: '1' },
      { role: 'Finance', config: { account_defaults: { bank: '3' }, unit_map: { m: '5' } } });
    assertEquals(r.res.status, 200);
    assertEquals(setCalls(r.calls), [
      { p_org_id: 'org-1', p_actor_id: 'user-1', p_key: 'account_defaults', p_value: { bank: '3', payable: '1' } },
      { p_org_id: 'org-1', p_actor_id: 'user-1', p_key: 'unit_map', p_value: { m: '5', m3: '7' } },
      { p_org_id: 'org-1', p_actor_id: 'user-1', p_key: 'default_warehouse_id', p_value: '1' },
    ]);
    assertEquals(r.json.saved, ['account_defaults', 'unit_map', 'default_warehouse_id']);
  });

  it('a request that names one key writes only that key', async () => {
    const r = await call({ setupAction: 'save-defaults', default_warehouse_id: '1' });
    assertEquals(setCalls(r.calls).map((c) => c.p_key), ['default_warehouse_id']);
  });

  it('AC-ODC-070 a PM, an Engineer, an Executive and an inactive member are refused before any write', async () => {
    for (const o of [{ role: 'Project Manager' }, { role: 'Engineer' }, { role: 'Executive' }, { active: false }]) {
      const r = await call({ setupAction: 'save-defaults', default_warehouse_id: '1' }, o);
      assertEquals(r.res.status, 403);
      assertEquals(setCalls(r.calls).length, 0);
    }
  });

  it('values that are not ids, an empty request and unknown keys never reach the database', async () => {
    for (const body of [{}, { account_defaults: 'x' }, { account_defaults: { payable: 11 } }, { unit_map: { m: '' } }, { default_warehouse_id: 1 }, { default_warehouse_id: '1; drop' }, { database: 'other' }]) {
      const r = await call({ setupAction: 'save-defaults', ...body });
      assertEquals(r.res.status, 400, JSON.stringify(body));
      assertEquals(setCalls(r.calls).length, 0);
    }
  });

  for (const [code, message, status] of [['42501', 'Admin or Finance required', 403], ['P0001', 'not a usable account', 409], ['22023', 'unknown default', 400]] as const) {
    it(`an RPC refusal ${code} → ${status}; the first refusal stops the rest and names what was saved`, async () => {
      let n = 0;
      const r = await call({ setupAction: 'save-defaults', account_defaults: { payable: '1' }, unit_map: { m: '5' } }, { rpc: { set_odoo_org_config: () => (++n === 1 ? jsonResponse(null) : pgError(code, message)) } });
      assertEquals(r.res.status, status);
      assertEquals(r.json.saved, ['account_defaults']);
      assertEquals(setCalls(r.calls).length, 2);
    });
  }

  it('an unexpected database failure is a generic 500, never its text', async () => {
    const r = await call({ setupAction: 'save-defaults', default_warehouse_id: '1' }, { rpc: { set_odoo_org_config: () => pgError('XX000', 'relation "secret_table" missing') } });
    assertEquals(r.res.status, 500);
    assertEquals(JSON.stringify(r.json).includes('secret_table'), false);
  });
});
