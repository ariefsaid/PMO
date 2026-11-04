/**
 * FR-ODC-047 — the odoo-sweep tick: the real handler from ./index.ts, Supabase mocked over fetch.
 */
import { afterAll, describe, it } from '@std/testing/bdd';
import { assertEquals } from '@std/assert';
import { handleOdooSweepRequest, ODOO_SWEEP_SECRET_ENV } from './index.ts';
import { installEdgeEnv, countResponse, jsonResponse, rpcCall, supabaseRpc, supabaseSelect, withFetchMock, type FetchCall, type MockRoute } from '../_shared/testing/edgeTestKit.ts';
import { createFakeOdoo, type FakeOdoo } from '../../../pmo-portal/src/lib/adapterSeam/odoo/fakeOdoo.ts';

const env = installEdgeEnv();
const SECRET = 'synthetic-sweep-secret';
Deno.env.set(ODOO_SWEEP_SECRET_ENV, SECRET);
// The pacer can only slow a client down, so tests skip its waits by firing timers at once.
const realSetTimeout = globalThis.setTimeout;
globalThis.setTimeout = ((fn: () => void) => { queueMicrotask(fn); return 0; }) as unknown as typeof setTimeout;
afterAll(() => { env.restore(); Deno.env.delete(ODOO_SWEEP_SECRET_ENV); globalThis.setTimeout = realSetTimeout; });

async function tick(orgs: { org_id: string }[], authorization = `Bearer ${SECRET}`, featureEnabled = true) {
  const routes = [
    supabaseSelect('external_org_bindings', (c) =>
      // the org list is one query; each org's resolver read carries an org_id filter
      c.url.searchParams.has('org_id') ? jsonResponse([]) : jsonResponse(orgs)),
    supabaseRpc('service_feature_enabled', () => jsonResponse(featureEnabled)),
    // The lock is held elsewhere, so each enabled org stops right after its claim: this suite is about the fan-out.
    supabaseRpc('claim_erp_sweep_lock', () => jsonResponse(false)),
  ];
  return await withFetchMock(routes, async ({ calls }) => {
    const res = await handleOdooSweepRequest(new Request('http://edge.test/odoo-sweep', { method: 'POST', headers: { Authorization: authorization }, body: '{}' }));
    return { res, json: await res.json(), calls };
  });
}
const nonSupabase = (calls: FetchCall[]) => calls.filter((c) => !c.url.host.startsWith('edge-test.supabase'));

describe('odoo-sweep — FR-ODC-047', () => {
  it('a wrong or missing bearer → 401, nothing read', async () => {
    for (const auth of ['Bearer wrong', '', SECRET]) {
      const r = await tick([], auth);
      assertEquals(r.res.status, 401);
      assertEquals(r.calls.length, 0);
    }
  });

  it('no sweep secret configured → 401 even for an empty bearer', async () => {
    Deno.env.delete(ODOO_SWEEP_SECRET_ENV);
    try {
      const r = await tick([], 'Bearer ');
      assertEquals(r.res.status, 401);
    } finally { Deno.env.set(ODOO_SWEEP_SECRET_ENV, SECRET); }
  });

  it('the org list is tier odoo, active and activated only', async () => {
    const r = await tick([]);
    const q = r.calls.find((c) => c.url.pathname === '/rest/v1/external_org_bindings')!.url.searchParams;
    assertEquals([q.get('external_tier'), q.get('status'), q.get('activated_at')], ['eq.odoo', 'eq.active', 'not.is.null']);
  });

  it('AC-ODC-092 no Odoo org (S-B) → 200 {orgs:0} and no Odoo call', async () => {
    const r = await tick([]);
    assertEquals(r.res.status, 200);
    assertEquals(r.json, { orgs: 0, results: [] });
    assertEquals(nonSupabase(r.calls).length, 0);
  });

  it('FR-PLN-006 erp_sync off holds the org before claiming work', async () => {
    const r = await tick([{ org_id: 'org-a' }], `Bearer ${SECRET}`, false);
    assertEquals(r.res.status, 200);
    assertEquals(r.json.results, [{ org_id: 'org-a', skipped: 'feature-off:erp_sync' }]);
    assertEquals(rpcCall(r.calls, 'service_feature_enabled').map((c) => c.bodyJson), [
      { p_org_id: 'org-a', p_key: 'erp_sync' },
    ]);
    assertEquals(rpcCall(r.calls, 'claim_erp_sweep_lock').length, 0);
  });

  it('two orgs → two lock claims, one per org', async () => {
    const r = await tick([{ org_id: 'org-a' }, { org_id: 'org-b' }]);
    assertEquals(r.res.status, 200);
    assertEquals(rpcCall(r.calls, 'claim_erp_sweep_lock').map((c) => (c.bodyJson as { p_org_id: string }).p_org_id).sort(), ['org-a', 'org-b']);
    assertEquals([...r.json.results].sort((x: { org_id: string }, y: { org_id: string }) => x.org_id.localeCompare(y.org_id)), [{ org_id: 'org-a', skipped: 'lock-held' }, { org_id: 'org-b', skipped: 'lock-held' }]);
  });

  it('consecutive ticks start at a different org, so a slow org never starves the same orgs every tick', async () => {
    const orgs = [{ org_id: 'org-a' }, { org_id: 'org-b' }, { org_id: 'org-c' }];
    const firsts = new Set<string>();
    const realNow = Date.now;
    let now = Date.UTC(2026, 10, 1);
    Date.now = () => now;
    try {
      for (let i = 0; i < 3; i++) {
        const r = await tick(orgs);
        firsts.add((rpcCall(r.calls, 'claim_erp_sweep_lock')[0].bodyJson as { p_org_id: string }).p_org_id);
        now += 5 * 60_000;
      }
    } finally { Date.now = realNow; }
    assertEquals(firsts.size, 3);
  });
});

describe('odoo-sweep — #1783 item 4 the scheduled entry holds purchase on the procurement switch', () => {
  const ORG = '0d000000-0000-4000-8000-000000000004';
  const ODOO = 'odoo.example.test';
  const KEY = 'stored-odoo-key';
  const WRITE = '2026-11-01 10:00:00';
  const binding = {
    id: '0b000000-0000-4000-8000-000000000001', site_url: `https://${ODOO}`, secret_ref: 'odoo_ref', status: 'active',
    activated_at: '2026-11-01T00:00:00Z',
    config: {
      database: 'db1', odoo_company_id: 1,
      capabilities: { observed_at: new Date().toISOString(), missing: [], models: {}, later: { 'purchase.order': true, 'stock.picking': true, 'account.move': true, 'account.payment': true } },
    },
  };
  const seed = (f: FakeOdoo) => {
    f.seed('res.company', [{ id: 1, name: 'Main Co', currency_id: [12, 'IDR'] }]);
    f.seed('product.product', [{ id: 1, name: 'Semen', default_code: 'S1', company_id: false }]);
    f.seed('account.account', [{ id: 1, name: 'Payable', code: '2100', account_type: 'liability_payable', company_ids: [1] }]);
    f.seed('purchase.order', [{ id: 1, name: 'PO00001', state: 'purchase', partner_id: [41, 'Vendor'], company_id: [1, 'Main'], date_order: '2026-10-30 08:00:00', amount_total: 100, amount_untaxed: 100, write_date: WRITE }]);
    f.seed('stock.picking', [{ id: 1, name: 'WH/IN/00001', state: 'assigned', partner_id: [41, 'Vendor'], company_id: [1, 'Main'], picking_type_code: 'incoming', write_date: WRITE }]);
    f.seed('account.move', [
      { id: 1, name: 'BILL/2026/1', state: 'posted', move_type: 'in_invoice', partner_id: [41, 'V'], company_id: [1, 'Main'], invoice_date: '2026-10-30', invoice_date_due: false, ref: 'INV-1', amount_total: 98, amount_untaxed: 100, amount_residual: 98, write_date: WRITE },
      { id: 91, name: 'INV/2026/00091', move_type: 'out_invoice', state: 'posted', partner_id: [41, 'Client A'], company_id: [1, 'Main'], invoice_date: '2026-11-01', invoice_date_due: '2026-12-01', ref: 'PO-91', currency_id: [1, 'IDR'], amount_total: 1110, amount_untaxed: 1000, amount_tax: 110, amount_residual: 710, write_date: '2026-11-02 10:00:00' },
    ]);
    f.seed('account.payment', [{ id: 1, name: 'PAY/2026/1', state: 'paid', payment_type: 'outbound', partner_type: 'supplier', partner_id: [41, 'V'], company_id: [1, 'Main'], amount: 98, date: '2026-10-31', write_date: WRITE }]);
  };
  const one = (body: unknown) => jsonResponse(body, { headers: { 'content-type': 'application/vnd.pgrst.object+json' } });
  const none = () => new Response('null', { status: 200, headers: { 'content-type': 'application/json' } });
  /** Every switch read the tick makes, keyed by the key asked for: erp_sync gates the org, procurement gates its purchase feed. */
  const features = (answers: Record<string, unknown>) =>
    supabaseRpc('service_feature_enabled', (c) => {
      const key = (c.bodyJson as { p_key: string }).p_key;
      if (!(key in answers)) throw new Error(`unexpected feature key ${key}`);
      const answer = answers[key];
      return answer === 'error' ? jsonResponse({ code: 'XX000', message: 'x' }, { status: 500 }) : jsonResponse(answer);
    });
  const sweepRoutes = (procurement: true | false | 'error'): MockRoute[] => {
    const cursors = new Map<string, string>();
    return [
      supabaseSelect('external_org_bindings', (c) => (c.url.searchParams.has('org_id') ? one(binding) : jsonResponse([{ org_id: ORG }]))),
      features({ erp_sync: true, procurement }),
      supabaseRpc('claim_erp_sweep_lock', () => jsonResponse(true)),
      supabaseRpc('release_erp_sweep_lock', () => jsonResponse(true)),
      supabaseRpc('read_vault_secret', () => jsonResponse(KEY)),
      supabaseRpc('outbox_reconcile_candidates', () => jsonResponse([])),
      supabaseSelect('external_sync_watermarks', (c) => { const v = cursors.get(c.url.searchParams.get('domain')!.replace(/^eq\./, '')); return jsonResponse(v === undefined ? [] : [{ watermark_cursor: v }]); }),
      // both feeds are employed: only the procurement switch can hold the purchase passes
      supabaseSelect('external_domain_ownership', (c) => jsonResponse([{ id: `own-${c.url.searchParams.get('domain')}` }])),
      supabaseRpc('apply_odoo_master_page', (c) => { const b = c.bodyJson as { p_kind: string; p_cursor: string }; cursors.set(`master:${b.p_kind}`, b.p_cursor); return jsonResponse(0); }),
      supabaseRpc('mark_odoo_census_seen', () => jsonResponse(null)),
      supabaseRpc('finish_odoo_census', (c) => { const b = c.bodyJson as { p_kind: string; p_cursor: string }; cursors.set(`master:${b.p_kind}`, b.p_cursor); return jsonResponse(0); }),
      supabaseRpc('apply_odoo_purchase_page', (c) => { const b = c.bodyJson as { p_domain: string; p_cursor: string }; cursors.set(`purchase:${b.p_domain}`, b.p_cursor); return jsonResponse(0); }),
      supabaseRpc('mark_odoo_purchase_census_seen', () => jsonResponse(null)),
      supabaseRpc('finish_odoo_purchase_census', (c) => { const b = c.bodyJson as { p_domain: string; p_cursor: string }; cursors.set(`purchase:${b.p_domain}`, b.p_cursor); return jsonResponse(0); }),
      supabaseRpc('apply_odoo_revenue_page', (c) => { const b = c.bodyJson as { p_domain: string; p_cursor: string }; cursors.set(`revenue:${b.p_domain}`, b.p_cursor); return jsonResponse(0); }),
      supabaseRpc('mark_odoo_revenue_census_seen', () => jsonResponse(null)),
      supabaseRpc('finish_odoo_revenue_census', (c) => { const b = c.bodyJson as { p_domain: string; p_cursor: string }; cursors.set(`revenue:${b.p_domain}`, b.p_cursor); return jsonResponse(0); }),
      supabaseRpc('merge_external_org_binding_config', () => jsonResponse(null)),
      supabaseRpc('log_audit', () => jsonResponse(null)),
      // the setup run's pass and the partner feed read these; no open run and no accepted party kind
      supabaseSelect('erp_connect_runs', () => none()),
      supabaseSelect('erp_connect_census', () => none()),
      supabaseSelect('external_master_records', () => jsonResponse([])),
      supabaseSelect('external_refs', () => jsonResponse([])),
      supabaseSelect('companies', () => jsonResponse([])),
      supabaseSelect('projects', () => jsonResponse([])),
      supabaseSelect('profiles', () => jsonResponse([])),
      supabaseSelect('procurement_items', () => jsonResponse([])),
      { label: 'categories-in-use', method: 'HEAD', pathname: '/rest/v1/budget_line_items', response: () => countResponse(0) },
      { label: 'odoo-json2', host: ODOO, pathname: /^\/json\/2\//, response: (c: FetchCall) => fake.fetch(c.url.toString(), { method: 'POST', headers: { Authorization: c.headers.get('authorization') ?? '' }, body: c.bodyText }) },
      { label: 'odoo-version', host: ODOO, pathname: '/web/webclient/version_info', response: () => jsonResponse({ result: { server_version_info: [20, 0] } }) },
    ];
  };
  const fake = createFakeOdoo({ key: KEY });
  const scheduled = async (procurement: true | false | 'error') => {
    fake.calls.length = 0;
    seed(fake);
    return await withFetchMock(sweepRoutes(procurement), async ({ calls }) => {
      const res = await handleOdooSweepRequest(new Request('http://edge.test/odoo-sweep', { method: 'POST', headers: { Authorization: `Bearer ${SECRET}` }, body: '{}' }));
      return { res, json: await res.json() as { results: Array<Record<string, unknown>> }, calls };
    });
  };
  /** Reads only a purchase pass can make, told apart from revenue's on the shared models by the filter it asks for. */
  const purchaseRequests = (calls: FetchCall[]) => calls.filter((c) => c.url.host === ODOO).filter((c) => {
    const [, model = ''] = /^\/json\/2\/([^/]+)\//.exec(c.url.pathname) ?? [];
    const domain = ((c.bodyJson as { domain?: unknown[] } | undefined)?.domain ?? []) as unknown[];
    const leaf = (field: string, value: unknown) => domain.some((t) => Array.isArray(t) && t[0] === field && t[2] === value);
    return model.startsWith('purchase.order') || model === 'stock.picking' || model === 'account.move.line'
      || (model === 'account.move' && leaf('move_type', 'in_invoice'))
      || (model === 'account.payment' && leaf('payment_type', 'outbound'));
  });

  it('AC-1783-04F erp_sync on and procurement off → the scheduled tick holds purchase but sweeps the directory and revenue', async () => {
    const r = await scheduled(false);
    assertEquals(r.res.status, 200);
    // the common boundary is reached from the real entry: erp_sync admits the org, procurement holds only its feed
    assertEquals(rpcCall(r.calls, 'service_feature_enabled').map((c) => c.bodyJson), [{ p_org_id: ORG, p_key: 'erp_sync' }, { p_org_id: ORG, p_key: 'procurement' }]);
    assertEquals(r.json.results.map((x) => [x.ok, x.purchase_hold]), [[true, 'feature-off:procurement']]);
    assertEquals(purchaseRequests(r.calls).length, 0, 'no purchase read reaches Odoo');
    assertEquals(['apply_odoo_purchase_page', 'mark_odoo_purchase_census_seen', 'finish_odoo_purchase_census'].map((fn) => rpcCall(r.calls, fn).length), [0, 0, 0]);
    assertDirectoryAndRevenueRan(r.calls);
  });

  it('AC-1783-04F a procurement switch that cannot be read → the same purchase hold from the scheduled tick', async () => {
    const r = await scheduled('error');
    assertEquals(r.res.status, 200);
    assertEquals(r.json.results.map((x) => [x.ok, x.purchase_hold]), [[true, 'feature-switch-unreadable:procurement']]);
    assertEquals(purchaseRequests(r.calls).length, 0);
    assertEquals(rpcCall(r.calls, 'apply_odoo_purchase_page').length, 0);
    assertDirectoryAndRevenueRan(r.calls);
  });
});

/** The hold is purchase-only: the directory pages and the revenue feed still applied in the same tick. */
function assertDirectoryAndRevenueRan(calls: FetchCall[]) {
  if (rpcCall(calls, 'apply_odoo_master_page').length === 0) throw new Error('the directory still sweeps');
  if (!rpcCall(calls, 'apply_odoo_revenue_page').map((c) => (c.bodyJson as { p_domain: string }).p_domain).includes('sales-invoice')) {
    throw new Error('the revenue feed still applies');
  }
}
