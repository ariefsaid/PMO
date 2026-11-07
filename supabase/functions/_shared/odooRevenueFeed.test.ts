/** C6 AC-OCI-072/074/075: deployed revenue feed specs, keyset replay and cursor RPC wiring. */
import { afterAll, describe, it } from '@std/testing/bdd';
import { assert, assertEquals, assertRejects } from '@std/assert';
import { createClient } from '@supabase/supabase-js';
import { installEdgeEnv, jsonResponse, rpcCall, supabaseRpc, supabaseSelect, withFetchMock, type FetchCall, type MockRoute } from './testing/edgeTestKit.ts';
import { revenueDomainsReadable, revenueFeedEmployed, runRevenuePass } from './odooRevenueFeed.ts';
import { bindCall } from '../../../pmo-portal/src/lib/adapterSeam/odoo/client.ts';
import { createFakeOdoo, type FakeOdoo } from '../../../pmo-portal/src/lib/adapterSeam/odoo/fakeOdoo.ts';

const env = installEdgeEnv();
const realSetTimeout = globalThis.setTimeout;
globalThis.setTimeout = ((fn: () => void) => { queueMicrotask(fn); return 0; }) as unknown as typeof setTimeout;
afterAll(() => { env.restore(); globalThis.setTimeout = realSetTimeout; });

const ORG = '0d000000-0000-4000-8000-000000000007';
const ODOO = 'odoo.example.test';
const KEY = 'stored-odoo-key';
const budget = (n = 50) => { let left = n; return { left: () => left > 0, spend: () => left-- > 0 }; };

interface Page { p_org_id: string; p_domain: string; p_rows: Array<{ external_id: string; name: string; source_write_date: string; attrs: Record<string, unknown> }>; p_cursor: string; p_prev_cursor?: string }
interface MirrorRow { external_id: string; name: string; source_write_date: string; attrs: Record<string, unknown> }

function harness(prepare: (fake: FakeOdoo) => void, options: { failApplyAt?: number; census?: { seen: string[][]; finish: string[] } } = {}) {
  const fake = createFakeOdoo({ key: KEY });
  prepare(fake);
  const cursors = new Map<string, string>();
  const mirrors = new Map<string, MirrorRow>();
  const applies: Page[] = [];
  let count = 0;
  const routes: MockRoute[] = [
    supabaseSelect('external_sync_watermarks', (call) => {
      const key = call.url.searchParams.get('domain')!.replace(/^eq\./, '');
      const cursor = cursors.get(key);
      return jsonResponse(cursor === undefined ? [] : [{ watermark_cursor: cursor }]);
    }),
    { label: 'separate-watermark-write', method: 'POST', pathname: '/rest/v1/external_sync_watermarks', response: (call) => {
      const rows = Array.isArray(call.bodyJson) ? call.bodyJson : [call.bodyJson];
      for (const row of rows as Array<{ domain: string; watermark_cursor: string }>) cursors.set(row.domain, row.watermark_cursor);
      return jsonResponse(rows);
    } },
    supabaseRpc('apply_odoo_revenue_page', (call) => {
      const page = call.bodyJson as Page;
      applies.push(page);
      if (options.failApplyAt !== undefined && ++count === options.failApplyAt) return jsonResponse({ code: 'P0001', message: 'apply failed' }, { status: 400 });
      for (const row of page.p_rows) {
        const old = mirrors.get(`${page.p_domain}:${row.external_id}`);
        if (!old || old.source_write_date <= row.source_write_date) mirrors.set(`${page.p_domain}:${row.external_id}`, row);
      }
      cursors.set(`revenue:${page.p_domain}`, page.p_cursor);
      return jsonResponse(page.p_rows.length);
    }),
    supabaseRpc('mark_odoo_revenue_census_seen', (call) => {
      options.census?.seen.push((call.bodyJson as { p_ids: string[] }).p_ids);
      return jsonResponse(null);
    }),
    supabaseRpc('finish_odoo_revenue_census', (call) => {
      const body = call.bodyJson as { p_domain: string; p_cursor: string };
      cursors.set(`revenue:${body.p_domain}`, body.p_cursor);
      options.census?.finish.push(body.p_cursor);
      return jsonResponse(null);
    }),
  ];
  return { fake, cursors, mirrors, applies, routes };
}

const client = () => createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const odooCall = (fake: FakeOdoo) => bindCall({ baseUrl: `https://${ODOO}`, apiKey: KEY, database: 'db1', fetchImpl: fake.fetch });
const pages = (calls: FetchCall[]) => rpcCall(calls, 'apply_odoo_revenue_page').map((call) => call.bodyJson as Page);
const invoice = (id: number, over: Record<string, unknown> = {}) => ({
  id, name: `INV/2026/${String(id).padStart(5,'0')}`, move_type: 'out_invoice', state: 'posted', partner_id: [41,'Client A'], company_id: [1,'Main'],
  invoice_date: '2026-11-01', invoice_date_due: '2026-12-01', ref: `PO-${id}`, currency_id: [1,'IDR'],
  amount_total: 1110, amount_untaxed: 1000, amount_tax: 110, amount_residual: 710, write_date: `2026-11-02 10:00:0${id}`, ...over,
});

describe('odooRevenueFeed — AC-OCI-072 / 074 / 075', () => {
  it('AC-OCI-074 applies the invoice figures from Odoo, including residual, under the verified org id', async () => {
    const h = harness((fake) => { fake.seed('account.move', [invoice(1)]); });
    const result = await withFetchMock(h.routes, async ({ calls }) => {
      const pass = await runRevenuePass(client(), ORG, 'sales-invoice', odooCall(h.fake), 1, budget());
      return { calls, pass };
    });
    const page = pages(result.calls)[0];
    assertEquals([page.p_org_id, page.p_domain], [ORG, 'sales-invoice']);
    assertEquals(page.p_rows.map((row) => row.external_id), ['1']);
    assertEquals(page.p_rows[0].attrs, {
      state: 'posted', docstatus: 1, partner: '41', partner_name: 'Client A', date: '2026-11-01', due_date: '2026-12-01',
      reference_number: 'PO-1', currency: 'IDR', anchor_key: null, amount_total: '1110.00', amount_untaxed: '1000.00',
      amount_tax: '110.00', residual: '710.00', status: 'Unpaid',
    });
    assertEquals(result.pass.skipped, 0);
  });

  it('AC-OCI-075 carries the credit note reversed-entry link and never changes the invoice residual into a computed value', async () => {
    const h = harness((fake) => {
      fake.seed('account.move', [invoice(1,{ move_type: 'out_refund', name: 'CN/2026/00001', reversed_entry_id: [99,'INV/2026/00099'] })]);
    });
    const r = await withFetchMock(h.routes, async ({ calls }) => { await runRevenuePass(client(), ORG, 'credit-note', odooCall(h.fake), 1, budget()); return calls; });
    const row = pages(r)[0].p_rows[0];
    assertEquals([row.attrs.reversed_entry_ref, row.attrs.amount_total, row.attrs.residual], ['account.move:99','1110.00','710.00']);
    assertEquals(row.attrs.status, 'Posted');
  });

  it('AC-OCI-072 carries a PMO anchor on an orphan invoice so the database can propose adoption', async () => {
    const h = harness((fake) => {
      fake.seed('account.move', [invoice(1)]);
      fake.seed('ir.model.data', [{ id: 1, module: 'pmo', model: 'account.move', res_id: 1, name: 'si_123e4567_e89b_12d3_a456_426614174001' }]);
    });
    const r = await withFetchMock(h.routes, async ({ calls }) => { await runRevenuePass(client(), ORG, 'sales-invoice', odooCall(h.fake), 1, budget()); return calls; });
    assertEquals(pages(r)[0].p_rows[0].attrs.anchor_key, 'si:123e4567-e89b-12d3-a456-426614174001');
  });

  it('AC-OCI-074 a failed page leaves the cursor and mirrors at the last committed page; replay is idempotent', async () => {
    const seed = (fake: FakeOdoo) => { fake.seed('account.move', [invoice(1),invoice(2),invoice(3)]); };
    const first = harness(seed, { failApplyAt: 2 });
    await withFetchMock(first.routes, async () => {
      await assertRejects(() => runRevenuePass(client(), ORG, 'sales-invoice', odooCall(first.fake), 1, budget(), { pageSize: 2 }));
    });
    const committedCursor = first.cursors.get('revenue:sales-invoice');
    assert(committedCursor, 'the first full page committed its checkpoint');
    assertEquals(committedCursor, first.applies[0].p_cursor, 'the failed next page leaves the cursor at its last committed page');
    assertEquals(first.applies.length, 2);
    assertEquals(first.applies[1].p_rows.map((row) => row.external_id), ['3']);
    assertEquals(first.mirrors.has('sales-invoice:3'), false, 'the failed page leaves no partial mirror state');

    const replay = harness(seed);
    replay.cursors.set('revenue:sales-invoice', committedCursor);
    const r = await withFetchMock(replay.routes, async ({ calls }) => { await runRevenuePass(client(), ORG, 'sales-invoice', odooCall(replay.fake), 1, budget(), { pageSize: 2 }); return calls; });
    assertEquals(pages(r).flatMap((page) => page.p_rows.map((row) => row.external_id)), ['3']);
    assertEquals([...replay.mirrors.keys()], ['sales-invoice:3']);
  });

  it('#1607 each page states the cursor the pass last saw, so a rewind made meanwhile is kept by the database', async () => {
    const h = harness((fake) => { fake.seed('account.move', [invoice(1),invoice(2),invoice(3)]); });
    h.cursors.set('revenue:sales-invoice', 'c0');
    const r = await withFetchMock(h.routes, async ({ calls }) => { await runRevenuePass(client(), ORG, 'sales-invoice', odooCall(h.fake), 1, budget(), { pageSize: 2 }); return calls; });
    const sent = pages(r);
    assertEquals(sent.length, 2);
    assertEquals(sent[0].p_prev_cursor, 'c0');
    assertEquals(sent[1].p_prev_cursor, sent[0].p_cursor);
  });

  it('AC-OCI-074 an Odoo commit with an earlier write_date is found in the next overlap read', async () => {
    const ago = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString().slice(0,19).replace('T',' ');
    const h = harness((fake) => { fake.seed('account.move', [invoice(1,{ write_date: ago(1) })]); });
    await withFetchMock(h.routes, async () => {
      await runRevenuePass(client(), ORG, 'sales-invoice', odooCall(h.fake), 1, budget());
      h.fake.seed('account.move', [invoice(2,{ write_date: ago(3) })]);
    });
    const r = await withFetchMock(h.routes, async ({ calls }) => { await runRevenuePass(client(), ORG, 'sales-invoice', odooCall(h.fake), 1, budget()); return calls; });
    assert(pages(r).flatMap((page) => page.p_rows.map((row) => row.external_id)).includes('2'));
  });
});

describe('odooRevenueFeed — employment, capability and census', () => {
  it('runs only when revenue is employed under Odoo', async () => {
    for (const [rows, expected] of [[[{ id: 'x' }],true],[[],false]] as const) {
      const routes: MockRoute[] = [supabaseSelect('external_domain_ownership',(call) => {
        assertEquals(call.url.searchParams.get('external_tier'),'eq.odoo');
        assertEquals(call.url.searchParams.get('domain'),'eq.revenue');
        assertEquals(call.url.searchParams.get('org_id'),`eq.${ORG}`);
        return jsonResponse(rows);
      })];
      assertEquals(await withFetchMock(routes,() => revenueFeedEmployed(client(),ORG)), expected);
    }
  });

  it('skips a revenue kind whose model is not discovered as readable', () => {
    assertEquals(revenueDomainsReadable(undefined), []);
    const snapshot = { later: { 'account.move': true, 'account.payment': false } } as never;
    assertEquals(revenueDomainsReadable(snapshot), ['sales-invoice','credit-note']);
  });

  it('censuses only inbound customer payments and saves a completion cursor', async () => {
    const census = { seen: [] as string[][], finish: [] as string[] };
    const h = harness((fake) => {
      fake.seed('account.payment', [
        { id: 9, name: 'PAY/9', state: 'paid', payment_type: 'inbound', partner_type: 'customer', partner_id: [41,'Client A'], amount: 25, date: '2026-11-02', currency_id: [1,'IDR'], company_id: [1,'Main'], write_date: '2026-11-02 10:00:00' },
        { id: 10, name: 'PAY/10', state: 'paid', payment_type: 'outbound', partner_type: 'supplier', partner_id: [42,'Vendor'], amount: 25, date: '2026-11-02', currency_id: [1,'IDR'], company_id: [1,'Main'], write_date: '2026-11-02 10:00:00' },
      ]);
    },{ census });
    await withFetchMock(h.routes, async () => { await runRevenuePass(client(),ORG,'incoming-payment',odooCall(h.fake),1,budget()); });
    assertEquals(census.seen.flat(), ['9']);
    assertEquals(census.finish.length, 1);
    assert(JSON.parse(census.finish[0]).census_done_at);
  });
});
