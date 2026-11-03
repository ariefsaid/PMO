/**
 * AC-OPP-074 / AC-OPP-043 / AC-OPP-073 — one Odoo purchase pass (`_shared/odooPurchaseFeed.ts`). Supabase is mocked over fetch
 * with an in-memory cursor store that only the apply RPCs write; Odoo is the in-memory fake. The mapping to the apply RPC
 * (filters, keyset paging, derived status, whole money header, unmapped rows kept) is asserted on the RPC bodies.
 */
import { afterAll, describe, it } from '@std/testing/bdd';
import { assert, assertEquals, assertRejects } from '@std/assert';
import { createClient } from '@supabase/supabase-js';
import { installEdgeEnv, jsonResponse, rpcCall, supabaseRpc, supabaseSelect, withFetchMock, type FetchCall, type MockRoute } from './testing/edgeTestKit.ts';
import { purchaseDomainsReadable, purchaseFeedEmployed, runPurchasePass } from './odooPurchaseFeed.ts';
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

interface ApplyBody { p_org_id: string; p_domain: string; p_rows: Array<{ external_id: string; name: string; source_write_date: string; attrs: Record<string, unknown> }>; p_cursor: string }

function harness(prepare: (f: FakeOdoo) => void, o: { failApplyAt?: number; census?: { seen: string[][]; finish: string[] } } = {}) {
  const fake = createFakeOdoo({ key: KEY });
  prepare(fake);
  const cursors = new Map<string, string>();
  let applies = 0;
  const routes: MockRoute[] = [
    supabaseSelect('external_sync_watermarks', (c) => {
      const v = cursors.get(c.url.searchParams.get('domain')!.replace(/^eq\./, ''));
      return jsonResponse(v === undefined ? [] : [{ watermark_cursor: v }]);
    }),
    supabaseRpc('apply_odoo_purchase_page', (c) => {
      const b = c.bodyJson as ApplyBody;
      if (o.failApplyAt !== undefined && ++applies === o.failApplyAt) return jsonResponse({ code: 'P0001', message: 'x' }, { status: 400 });
      cursors.set(`purchase:${b.p_domain}`, b.p_cursor);
      return jsonResponse(b.p_rows.length);
    }),
    supabaseRpc('mark_odoo_purchase_census_seen', (c) => { o.census?.seen.push((c.bodyJson as { p_ids: string[] }).p_ids); return jsonResponse(null); }),
    supabaseRpc('finish_odoo_purchase_census', (c) => { const b = c.bodyJson as { p_domain: string; p_cursor: string }; cursors.set(`purchase:${b.p_domain}`, b.p_cursor); o.census?.finish.push(b.p_cursor); return jsonResponse(null); }),
  ];
  return { fake, cursors, routes };
}
const client = () => createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const odooCall = (f: FakeOdoo) => bindCall({ baseUrl: `https://${ODOO}`, apiKey: KEY, database: 'db1', fetchImpl: f.fetch });
const applied = (calls: FetchCall[]) => rpcCall(calls, 'apply_odoo_purchase_page').map((c) => c.bodyJson as ApplyBody);

const bill = (id: number, over: Record<string, unknown> = {}) => ({
  id, name: `BILL/2026/${id}`, state: 'posted', move_type: 'in_invoice', partner_id: [41, 'Vendor V'], company_id: [1, 'Main'], invoice_date: '2026-10-30', invoice_date_due: '2026-11-30',
  ref: `INV-${id}`, amount_total: 98, amount_untaxed: 100, amount_residual: 98, write_date: `2026-11-01 10:00:0${id}`, ...over,
});
const lines = (move: number, tax: Array<number | string> = [11, -2]) => [
  { id: move * 10, move_id: [move, 'b'], balance: 100, tax_line_id: false, analytic_distribution: { '88': 100 } },
  ...tax.map((balance, i) => ({ id: move * 10 + i + 1, move_id: [move, 'b'], balance, tax_line_id: [i + 3, 't'], analytic_distribution: false })),
];

describe('odooPurchaseFeed — AC-OPP-074 / 043', () => {
  it('FR-OPP-080 only vendor bills of the activated company are read; the whole money header and derived status ride the page', async () => {
    const h = harness((f) => {
      f.seed('account.move', [bill(1), bill(2, { move_type: 'out_invoice' }), bill(3, { company_id: [2, 'Other'] })]);
      f.seed('account.move.line', lines(1));
    });
    const r = await withFetchMock(h.routes, async ({ calls }) => { await runPurchasePass(client(), ORG, 'bill', odooCall(h.fake), 1, budget()); return calls; });
    const pages = applied(r);
    assertEquals(pages.length, 1);
    assertEquals(pages[0].p_org_id, ORG);
    assertEquals(pages[0].p_rows.map((x) => x.external_id), ['1']);
    assertEquals(pages[0].p_rows[0].attrs.money, { gross: '100.00', vat: '11.00', withheld: '2.00', outstanding: '98.00' });
    assertEquals(pages[0].p_rows[0].attrs.status, 'Received');
    assertEquals(pages[0].p_rows[0].attrs.analytic_ids, ['88']);
  });

  it('AC-OPP-072 the page a native bill rides in carries its currency and the orders it bills (what link-existing compares and guards on)', async () => {
    const h = harness((f) => { f.seed('account.move', [bill(1, { currency_id: [12, 'IDR'], invoice_origin: 'P00012' })]); f.seed('account.move.line', lines(1)); });
    const r = await withFetchMock(h.routes, async ({ calls }) => { await runPurchasePass(client(), ORG, 'bill', odooCall(h.fake), 1, budget()); return calls; });
    const attrs = applied(r)[0].p_rows[0].attrs;
    assertEquals(attrs.currency, 'IDR');
    assertEquals(attrs.source_orders, ['P00012']);
  });

  it('AC-OPP-043 a tax line Odoo returns without a balance sends no header at all (production wiring of the whole-header rule)', async () => {
    const h = harness((f) => { f.seed('account.move', [bill(1)]); f.seed('account.move.line', lines(1, [11, 'x'])); });
    const r = await withFetchMock(h.routes, async ({ calls }) => { await runPurchasePass(client(), ORG, 'bill', odooCall(h.fake), 1, budget()); return calls; });
    assertEquals(applied(r)[0].p_rows[0].attrs.money, null);
  });

  it('FR-OPP-083 an unmapped vendor or project is still sent: the row is stored with a reason by the database, not dropped here', async () => {
    const h = harness((f) => { f.seed('account.move', [bill(1, { partner_id: [999, 'Stranger'] })]); f.seed('account.move.line', [{ id: 1, move_id: [1, 'b'], balance: 100, tax_line_id: false, analytic_distribution: { '777': 100 } }]); });
    const r = await withFetchMock(h.routes, async ({ calls }) => { await runPurchasePass(client(), ORG, 'bill', odooCall(h.fake), 1, budget()); return calls; });
    const row = applied(r)[0].p_rows[0];
    assertEquals([row.attrs.partner, row.attrs.analytic_ids], ['999', ['777']]);
  });

  it('AC-OPP-072 an order or bill carrying a PMO anchor but no link row reaches the database with its key (the orphan proposal)', async () => {
    const h = harness((f) => {
      f.seed('account.move', [bill(1)]); f.seed('account.move.line', lines(1));
      f.seed('ir.model.data', [{ id: 1, module: 'pmo', model: 'account.move', res_id: 1, name: 'bill_123e4567_e89b_12d3_a456_426614174001' }, { id: 2, module: 'base', model: 'account.move', res_id: 1, name: 'x' }]);
    });
    const r = await withFetchMock(h.routes, async ({ calls }) => { await runPurchasePass(client(), ORG, 'bill', odooCall(h.fake), 1, budget()); return calls; });
    assertEquals(applied(r)[0].p_rows[0].attrs.anchor_key, 'bill:123e4567-e89b-12d3-a456-426614174001');
  });

  it('AC-OPP-074 a page that fails halfway leaves the cursor, and a replay sends identical rows; keyset paging crosses a full page', async () => {
    const seed = (f: FakeOdoo) => { f.seed('account.move', [bill(1), bill(2), bill(3)]); f.seed('account.move.line', [...lines(1), ...lines(2), ...lines(3)]); };
    // first apply (the initial scan) succeeds with cursor c1; the second fails
    const h1 = harness(seed, { failApplyAt: 2 });
    await withFetchMock(h1.routes, async () => { await assertRejects(() => runPurchasePass(client(), ORG, 'bill', odooCall(h1.fake), 1, budget(), { pageSize: 2 })); });
    const afterFailure = h1.cursors.get('purchase:bill');
    // a replay from the same stored cursor against a healthy apply sends what the failed run would have
    const h2 = harness(seed);
    if (afterFailure !== undefined) h2.cursors.set('purchase:bill', afterFailure);
    const r2 = await withFetchMock(h2.routes, async ({ calls }) => { await runPurchasePass(client(), ORG, 'bill', odooCall(h2.fake), 1, budget(), { pageSize: 2 }); return calls; });
    const ids = applied(r2).flatMap((p) => p.p_rows.map((x) => x.external_id));
    assert(ids.includes('3'), 'the record the failed page held is sent on the replay');
    const h3 = harness(seed);
    const r3 = await withFetchMock(h3.routes, async ({ calls }) => { await runPurchasePass(client(), ORG, 'bill', odooCall(h3.fake), 1, budget(), { pageSize: 2 }); return calls; });
    const full = applied(r3).flatMap((p) => p.p_rows.map((x) => x.external_id));
    assertEquals(new Set(full), new Set(['1', '2', '3']));
    assert(applied(r3).length >= 2, 'a full page continues to the next page');
  });

  it('AC-OPP-074 a record committed late with an earlier write_date is picked up inside the overlap window', async () => {
    // Odoo's clock is "now" here, so the first pass hands over to the feed at (now - overlap) and the late row sits inside the window.
    const ago = (min: number) => new Date(Date.now() - min * 60_000).toISOString().slice(0, 19).replace('T', ' ');
    const h = harness((f) => { f.seed('account.move', [bill(1, { write_date: ago(1) })]); f.seed('account.move.line', lines(1)); });
    await withFetchMock(h.routes, async () => {
      await runPurchasePass(client(), ORG, 'bill', odooCall(h.fake), 1, budget());
      // Odoo commits bill 2 after the first pass, stamped before bill 1's write_date
      h.fake.seed('account.move', [bill(2, { write_date: ago(3) })]);
      h.fake.seed('account.move.line', lines(2));
    });
    const r = await withFetchMock(h.routes, async ({ calls }) => { await runPurchasePass(client(), ORG, 'bill', odooCall(h.fake), 1, budget()); return calls; });
    assert(applied(r).flatMap((p) => p.p_rows.map((x) => x.external_id)).includes('2'));
  });
});

describe('odooPurchaseFeed — AC-OPP-073 census', () => {
  it('the daily census lists every id Odoo still has, then finishes with a cursor that remembers it', async () => {
    const census = { seen: [] as string[][], finish: [] as string[] };
    const h = harness((f) => { f.seed('account.move', [bill(1), bill(2), bill(5, { move_type: 'out_invoice' })]); f.seed('account.move.line', [...lines(1), ...lines(2)]); }, { census });
    await withFetchMock(h.routes, async () => { await runPurchasePass(client(), ORG, 'bill', odooCall(h.fake), 1, budget()); });
    assertEquals(census.seen.flat(), ['1', '2']);
    assertEquals(census.finish.length, 1);
    assert(JSON.parse(census.finish[0]).census_done_at, 'the cursor carries census_done_at');
  });
});

describe('odooPurchaseFeed — employment and capability gates', () => {
  it('the feed runs only for an org that employed procurement under Odoo', async () => {
    for (const [rows, want] of [[[{ id: 'x' }], true], [[], false]] as const) {
      const routes: MockRoute[] = [supabaseSelect('external_domain_ownership', (c) => {
        assertEquals(c.url.searchParams.get('external_tier'), 'eq.odoo'); assertEquals(c.url.searchParams.get('domain'), 'eq.procurement'); assertEquals(c.url.searchParams.get('org_id'), `eq.${ORG}`);
        return jsonResponse(rows);
      })];
      assertEquals(await withFetchMock(routes, () => purchaseFeedEmployed(client(), ORG)), want);
    }
  });
  it('a domain whose model discovery did not find present and readable is skipped', () => {
    assertEquals(purchaseDomainsReadable(undefined), []);
    const snap = { later: { 'purchase.order': true, 'stock.picking': false, 'account.move': true } } as never;
    assertEquals(purchaseDomainsReadable(snap), ['purchase-order', 'bill']);
  });
});
