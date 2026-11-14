/**
 * connect.stock.test.ts — AC-OSP-001 stock matching setup verbs (#1508 S4).
 * Real handler from ./index.ts; Supabase mocked over fetch, Odoo by the in-memory fake.
 */
import { afterAll, describe, it } from '@std/testing/bdd';
import { assertEquals, assertMatch } from '@std/assert';
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
const pgError = (code: string, message: string) => jsonResponse({ code, message, details: null, hint: null }, { status: 400 });

interface Opts {
  role?: string;
  active?: boolean;
  tier?: string;
  bindingTier?: string;
  bindingStatus?: string;
  activatedAt?: string | null;
  companyId?: number | null;
  stockItems?: Array<{ id: string; code: string; name: string }>;
  stockWarehouses?: Array<{ id: string; code: string; name: string }>;
  proposals?: Array<Record<string, unknown>>;
  externalRefs?: Array<{ pmo_record_id: string; external_record_id: string }>;
  rpc?: Record<string, (call: FetchCall) => Response>;
  prepare?: (f: FakeOdoo) => void;
  callerWritesAllowed?: boolean;
}

function routes(fake: FakeOdoo, o: Opts, userJwt: string): MockRoute[] {
  const rpc = (fn: string, fallback: unknown) => supabaseRpc(fn, o.rpc?.[fn] ?? (() => jsonResponse(fallback)));
  return [
    // Direct table write guard: the caller token has no direct write grant in the DB
    {
      label: 'caller-direct-write-guard',
      match: (c: FetchCall) => {
        const authHeader = c.headers.get('authorization') ?? '';
        return !o.callerWritesAllowed && authHeader.includes(userJwt) && ['POST', 'PATCH', 'PUT', 'DELETE'].includes(c.method) && /^\/rest\/v1\/(?!rpc\/)/.test(c.url.pathname);
      },
      response: () => new Response(JSON.stringify({ code: '42501', message: 'permission denied for table' }), { status: 403 }),
    },
    supabaseSelect('profiles', () => one({ org_id: 'org-1', role: o.role ?? 'Admin' })),
    supabaseSelect('platform_operators', () => none()),
    supabaseRpc('actor_authorization_state', () => jsonResponse({ active: o.active ?? true })),
    rpc('service_feature_enabled', true),
    supabaseSelect('external_org_bindings', () => {
      if (o.bindingTier === 'none') return none();
      return one({
        id: 'b1',
        site_url: `https://${ODOO}`,
        secret_ref: 'odoo_ref',
        status: o.bindingStatus ?? 'active',
        activated_at: o.activatedAt === undefined ? '2026-11-01T00:00:00Z' : o.activatedAt,
        external_tier: o.bindingTier ?? 'odoo',
        config: {
          database: 'db1',
          odoo_company_id: o.companyId === undefined ? 1 : o.companyId,
        },
      });
    }),
    supabaseRpc('read_vault_secret', () => jsonResponse(KEY)),
    {
      label: 'odoo-json2',
      host: ODOO,
      pathname: /^\/json\/2\//,
      response: (c: FetchCall) =>
        fake.fetch(c.url.toString(), {
          method: 'POST',
          headers: { Authorization: c.headers.get('authorization') ?? '' },
          body: c.bodyText,
        }),
    },
    supabaseSelect('stock_items', () => jsonResponse(o.stockItems ?? [{ id: 's-item-1', code: 'ITEM-01', name: 'Portland Cement' }])),
    supabaseSelect('stock_warehouses', () => jsonResponse(o.stockWarehouses ?? [{ id: 's-wh-1', code: 'WH', name: 'Main Warehouse' }])),
    supabaseSelect('external_refs', () => jsonResponse(o.externalRefs ?? [])),
    supabaseSelect('erp_connect_runs', () => one({ id: 'run-1', state: 'ready', started_at: '2026-11-15T00:00:00Z' })),
    supabaseSelect('erp_connect_proposals', () => jsonResponse(o.proposals ?? [])),
    rpc('start_connect_run', 'run-1'),
    rpc('stage_connect_master_page', null),
    rpc('replace_connect_proposals', null),
    rpc('accept_connect_proposals', { counts: { stock_item: { link: 1, left_open: 0 } }, remaining: 0 }),
    rpc('decide_connect_review', null),
    rpc('unlink_connect_match', null),
    rpc('list_unlinkable_connect_matches', ['prop-link-1']),
    rpc('search_connect_staged', []),
  ];
}

async function call(body: Record<string, unknown>, o: Opts = {}) {
  const fake = createFakeOdoo({ key: KEY });
  fake.seed('res.company', [{ id: 1, name: 'Main Co', partner_id: [99, 'Main Co'] }]);
  fake.seed('product.product', [
    { id: 101, default_code: 'ITEM-01', name: 'Portland Cement', is_storable: true, company_id: 1, active: true },
  ]);
  fake.seed('stock.warehouse', [
    { id: 1, name: 'Main Warehouse', code: 'WH', lot_stock_id: [201, 'WH/Stock'], view_location_id: 200, company_id: 1, active: true },
  ]);
  fake.seed('stock.location', [
    { id: 201, complete_name: 'WH/Stock', usage: 'internal', company_id: 1, active: true },
  ]);
  o.prepare?.(fake);
  const jwt = await auth.mintJwt({ sub: 'user-1' });
  return await withFetchMock(routes(fake, o, jwt), async ({ calls }) => {
    const res = await handleSetCompanyRequest(
      createAuthedRequest('http://edge.test/set-company', { tier: o.tier ?? 'odoo', ...body }, jwt),
    );
    const text = await res.text();
    let json: Record<string, unknown> = {};
    try {
      json = JSON.parse(text);
    } catch {
      json = { raw: text };
    }
    return { res, json, calls, fake, jwt };
  });
}

describe('AC-OSP-001 stock matching setup verbs', () => {
  it('AC-OSP-001 Admin can propose a stock run, staging Odoo products and locations and writing proposals', async () => {
    const r = await call({ setupAction: 'stock-propose' });
    if (r.res.status !== 200) console.error('DBG propose failed:', r.res.status, r.json);
    assertEquals(r.res.status, 200);
    assertEquals(r.json.ok, true);
    assertEquals(r.json.runId, 'run-1');

    const startCalls = rpcCall(r.calls, 'start_connect_run');
    assertEquals(startCalls.length, 1);
    assertEquals((startCalls[0].bodyJson as Record<string, unknown>).p_tier, 'odoo');

    const stageCalls = rpcCall(r.calls, 'stage_connect_master_page');
    assertEquals(stageCalls.length >= 2, true); // stock_item and stock_warehouse

    const proposalCalls = rpcCall(r.calls, 'replace_connect_proposals');
    assertEquals(proposalCalls.length >= 2, true);
  });

  it('AC-OSP-001 Admin can list stock proposals with plain names, codes, counts, and reasons', async () => {
    const proposals = [
      {
        id: 'prop-1',
        kind: 'stock_item',
        outcome: 'link',
        state: 'open',
        pmo_ids: ['s-item-1'],
        external_ids: ['101'],
        snapshot: { name: 'Portland Cement', code: 'ITEM-01' },
      },
      {
        id: 'prop-2',
        kind: 'stock_warehouse',
        outcome: 'review',
        state: 'open',
        reason: 'ambiguous',
        reason_text: 'No matching record was found in the ERP; it stays only in PMO.',
        pmo_ids: ['s-wh-1'],
        external_ids: [],
        snapshot: {},
      },
    ];
    const r = await call({ setupAction: 'stock-list' }, { proposals });
    assertEquals(r.res.status, 200);
    const json = r.json as { proposals: Array<Record<string, unknown>>; counts: Record<string, Record<string, number>> };
    assertEquals(json.proposals.length, 2);
    assertEquals(json.proposals[0].pmo_name, 'Portland Cement');
    assertEquals(json.proposals[0].pmo_code, 'ITEM-01');
    assertEquals(json.proposals[0].erp_name, 'Portland Cement');
    assertEquals(json.proposals[0].erp_code, 'ITEM-01');
    assertEquals(json.proposals[1].pmo_name, 'Main Warehouse');
    assertEquals(json.proposals[1].reason_text, 'No matching record was found in the ERP; it stays only in PMO.');
    assertEquals(json.counts.stock_item.link, 1);
    assertEquals(json.counts.stock_warehouse.review, 1);
  });

  it('AC-OSP-001 Admin can accept all stock proposals (reads counts and left_open)', async () => {
    const r = await call(
      { setupAction: 'accept-proposals', kind: 'stock_item' },
      {
        rpc: {
          accept_connect_proposals: () =>
            jsonResponse({
              counts: { stock_item: { link: 2, left_open: 1 } },
              remaining: 0,
            }),
        },
      },
    );
    assertEquals(r.res.status, 200);
    const accepts = rpcCall(r.calls, 'accept_connect_proposals');
    assertEquals(accepts.length, 1);
    assertEquals(accepts[0].headers.get('authorization'), `Bearer ${r.jwt}`);
    assertEquals(accepts[0].bodyJson, { p_tier: 'odoo', p_kind: 'stock_item', p_ids: null, p_exclude: null });
    assertEquals(r.json, {
      counts: { stock_item: { link: 2, left_open: 1 } },
      remaining: 0,
    });
  });

  it('AC-OSP-001 Admin can resolve one contested stock review to a chosen pair', async () => {
    const r = await call({
      setupAction: 'decide-review',
      id: 'prop-review-1',
      choice: { action: 'link', pmoId: 's-item-1', externalId: '101' },
    });
    assertEquals(r.res.status, 200);
    const decides = rpcCall(r.calls, 'decide_connect_review');
    assertEquals(decides.length, 1);
    assertEquals(decides[0].headers.get('authorization'), `Bearer ${r.jwt}`);
    assertEquals(decides[0].bodyJson, {
      p_id: 'prop-review-1',
      p_choice: { action: 'link', pmoId: 's-item-1', externalId: '101' },
    });
  });

  it('AC-OSP-001 Admin can dismiss an unclear stock review', async () => {
    const r = await call({
      setupAction: 'decide-review',
      id: 'prop-review-2',
      choice: { action: 'dismiss' },
    });
    assertEquals(r.res.status, 200);
    const decides = rpcCall(r.calls, 'decide_connect_review');
    assertEquals(decides.length, 1);
    assertEquals(decides[0].headers.get('authorization'), `Bearer ${r.jwt}`);
    assertEquals(decides[0].bodyJson, {
      p_id: 'prop-review-2',
      p_choice: { action: 'dismiss' },
    });
  });

  it('AC-OSP-001 Admin can unlink an applied stock match', async () => {
    const r = await call({
      setupAction: 'unlink-match',
      id: 'prop-link-1',
    });
    assertEquals(r.res.status, 200);
    const unlinks = rpcCall(r.calls, 'unlink_connect_match');
    assertEquals(unlinks.length, 1);
    assertEquals(unlinks[0].headers.get('authorization'), `Bearer ${r.jwt}`);
    assertEquals(unlinks[0].bodyJson, { p_id: 'prop-link-1' });
  });

  for (const role of ['Engineer', 'Finance']) {
    it(`AC-OSP-001 non-Admin (${role}) is refused for propose, list, accept, resolve, dismiss, unlink with zero ERP reads and zero DB writes`, async () => {
      for (const setupAction of ['stock-propose', 'stock-list', 'unlink-match']) {
        const r = await call({ setupAction }, { role });
        assertEquals(r.res.status, 403);
        assertEquals(r.calls.filter((c) => c.url.host === ODOO).length, 0);
        assertEquals(rpcCall(r.calls, 'start_connect_run').length, 0);
        assertEquals(rpcCall(r.calls, 'accept_connect_proposals').length, 0);
        assertEquals(rpcCall(r.calls, 'decide_connect_review').length, 0);
        assertEquals(rpcCall(r.calls, 'unlink_connect_match').length, 0);
      }
      const acc = await call({ setupAction: 'accept-proposals', kind: 'stock_item' }, { role });
      assertEquals(acc.res.status, 403);
      const dec = await call({ setupAction: 'decide-review', id: 'p1', choice: { action: 'link', pmoId: 's1', externalId: '101' }, kind: 'stock_item' }, { role });
      assertEquals(dec.res.status, 403);
    });
  }

  it('AC-OSP-001 an ERPNext-bound organization is refused stock matching before any ERP read or DB write', async () => {
    const r = await call({ setupAction: 'stock-propose', tier: 'erpnext' });
    assertEquals(r.res.status, 400);
    assertEquals(r.calls.filter((c) => c.url.host === ODOO).length, 0);
    assertEquals(rpcCall(r.calls, 'start_connect_run').length, 0);
  });

  it('AC-OSP-001 an organization without a chosen Odoo company is refused before any ERP read', async () => {
    const r = await call({ setupAction: 'stock-propose' }, { companyId: null });
    assertEquals(r.res.status >= 400 && r.res.status < 500, true);
    assertEquals(r.calls.filter((c) => c.url.host === ODOO).length, 0);
    assertEquals(rpcCall(r.calls, 'start_connect_run').length, 0);
  });

  it('AC-OSP-001 a database refusal message reaches the caller as a plain 4xx with that message, not a 500', async () => {
    const refusalMsg = 'Stock record is already linked: the PMO record has another ERP record';
    const r = await call(
      {
        setupAction: 'decide-review',
        id: 'prop-review-1',
        choice: { action: 'link', pmoId: 's-item-1', externalId: '101' },
      },
      {
        rpc: {
          decide_connect_review: () => pgError('P0001', refusalMsg),
        },
      },
    );
    assertEquals(r.res.status, 400);
    assertEquals(r.json.message, refusalMsg);
  });
});
