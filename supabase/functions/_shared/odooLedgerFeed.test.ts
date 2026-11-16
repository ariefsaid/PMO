/** #1507 S3 AC-ODA-001/002/003/004: the ledger pass over a fake Odoo and a fake PostgREST, budgets, and the tier-neutral actuals refresh. */
import { afterAll, describe, it } from '@std/testing/bdd';
import { assert, assertEquals, assertRejects } from '@std/assert';
import { createClient } from '@supabase/supabase-js';
import { installEdgeEnv, jsonResponse, supabaseRpc, supabaseSelect, withFetchMock, type MockRoute } from './testing/edgeTestKit.ts';
import { ledgerFeedEmployed, runLedgerPass } from './odooLedgerFeed.ts';
import { bindCall } from '../../../pmo-portal/src/lib/adapterSeam/odoo/client.ts';
import { createFakeOdoo, type FakeOdoo } from '../../../pmo-portal/src/lib/adapterSeam/odoo/fakeOdoo.ts';

const env = installEdgeEnv();
const realSetTimeout = globalThis.setTimeout;
globalThis.setTimeout = ((fn: () => void) => { queueMicrotask(fn); return 0; }) as unknown as typeof setTimeout;
afterAll(() => { env.restore(); globalThis.setTimeout = realSetTimeout; });

const ORG = '0d000000-0000-4000-8000-000000000009';
const [P1, P2, P3] = ['00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-0000000000a2', '00000000-0000-4000-8000-0000000000a3'];
const budget = (n = 500) => { let left = n; return { left: () => left > 0, spend: () => left-- > 0 }; };
const client = () => createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });

interface PageRow { erp_name: string; account: string; project: string | null; fiscal_year: string; debit: string; credit: string; is_cancelled: boolean; posting_date: string }
interface Page { p_org_id: string; p_rows: PageRow[]; p_cursor: string }
interface Opts { links?: Record<string, string>; accounts?: Record<string, string>; binding?: Record<string, unknown>; fiscal?: { month: string; day: number }; failApplyAt?: number; switched?: boolean; links2?: Record<string, string>; lastCheckAt?: string; failRecord?: boolean; publishedAt?: string; inventory?: boolean; stockLastCheckAt?: string; stockApplyChanged?: number; stockTie?: string; failStockApplyAt?: number; failSnapshotOnce?: boolean; failStockRecordOnce?: boolean; inventoryCreatedAt?: string; timezone?: string }

const line = (id: number, over: Record<string, unknown> = {}) => ({
  id, move_id: [id, `BILL/${id}`], move_name: `BILL/${id}`, journal_id: [3, 'Bills'], partner_id: [9, 'Vendor'], company_id: [1, 'Main'], currency_id: [1, 'IDR'],
  account_id: [501, '5100 Cost'], date: '2026-06-15', parent_state: 'posted', debit: 100, credit: 0, balance: 100, amount_currency: 100,
  analytic_distribution: false, write_date: `2026-11-02 10:00:${String(id % 60).padStart(2, '0')}`, ...over,
});

function harness(prepare: (fake: FakeOdoo) => void, o: Opts = {}) {
  const fake = createFakeOdoo({ key: 'k' });
  fake.seed('res.company', [{ id: 1, name: 'Main', ...(o.fiscal ? { fiscalyear_last_month: o.fiscal.month, fiscalyear_last_day: o.fiscal.day } : {}) }]);
  prepare(fake);
  let cursor: string | undefined;
  let fingerprint: string | undefined;
  let fingerprintUpdatedAt: string | undefined;
  let rewinds = 0;
  let switched = o.switched !== false;
  let publishedAt: string | undefined = o.publishedAt;
  const applies: Page[] = [];
  const snapshots: Array<Record<string, unknown>[]> = [];
  const mirror = new Map<string, PageRow>();
  const census = { seen: [] as string[][], finish: [] as Array<{ expected: number | null }> };
  const checks: Array<{ p_org_id: string; p_cutoff: string; p_accounts: Array<{ account: string; pmo: unknown; odoo: unknown }>; p_status: string; p_reason: string | null; p_accounts_checked: number; p_feed_position: string }> = [];
  const markers: string[] = [];
  // #2282 the issued-material kind's own cursor, pages, census, checks and stored rows.
  let stockCursor: string | undefined;
  const stockApplies: Array<{ p_org_id: string; p_rows: Array<Record<string, unknown>>; p_cursor: string }> = [];
  const stockStore = new Map<string, Record<string, unknown>>();
  const stockCensus = { seen: [] as string[][], finish: [] as Array<{ expected: number | null }> };
  const stockChecks: Array<Record<string, unknown>> = [];
  const doubleMarks: number[][] = [];
  const yearEnds: Array<{ p_org_id: string; p_month: number; p_day: number }> = [];
  // Any other watermark domain (the stock kind's unpublished and held markers): one value and time each.
  const otherMarks = new Map<string, { watermark_cursor: string; updated_at: string }>();
  let failStockApplyAt = o.failStockApplyAt;
  let failSnapshotOnce = o.failSnapshotOnce === true;
  let failStockRecordOnce = o.failStockRecordOnce === true;
  const marked = new Set<number>();
  let links = o.links ?? { [P1]: '101', [P2]: '102', [P3]: '102' };
  const accounts = { ...(o.accounts ?? { '501': '5100' }) } as Record<string, string>;
  const routes: MockRoute[] = [
    supabaseSelect('external_org_bindings', () => jsonResponse([{ status: 'active', activated_at: '2026-11-01T00:00:00Z', config: { capabilities: { later: { 'account.move.line': true } }, ...(!switched ? {} : { ledger_basis_at: '2026-11-05T00:00:00Z' }) }, ...o.binding }])),
    supabaseSelect('external_sync_watermarks', (c) => {
      if (c.url.searchParams.get('domain') === 'eq.ledger-published:odoo') return jsonResponse(publishedAt ? [{ updated_at: publishedAt }] : []);
      if (c.url.searchParams.get('domain') === 'eq.ledger-stock-cost:odoo') return jsonResponse(stockCursor === undefined ? [] : [{ watermark_cursor: stockCursor }]);
      const other = otherMarks.get((c.url.searchParams.get('domain') ?? '').replace(/^eq\./, ''));
      if (other) return jsonResponse([other]);
      if (/^eq\.ledger-(stock-unpublished|stock-held):odoo$/.test(c.url.searchParams.get('domain') ?? '')) return jsonResponse([]);
      const isFingerprint = c.url.searchParams.get('domain') === 'eq.ledger-links:odoo';
      const value = isFingerprint ? fingerprint : cursor;
      return jsonResponse(value === undefined ? [] : [{ watermark_cursor: value, ...(isFingerprint ? { updated_at: fingerprintUpdatedAt } : {}) }]);
    }),
    { label: 'watermark-rewind', method: 'DELETE', pathname: '/rest/v1/external_sync_watermarks', response: (c) => {
      const domain = (c.url.searchParams.get('domain') ?? '').replace(/^eq\./, '');
      if (domain !== 'ledger:odoo') { otherMarks.delete(domain); return new Response(null, { status: 204 }); }
      cursor = undefined; rewinds++; return new Response(null, { status: 204 });
    } },
    { label: 'watermark-fingerprint', method: 'POST', pathname: '/rest/v1/external_sync_watermarks', response: (c) => {
      const body = c.bodyJson as { domain: string; watermark_cursor: string };
      if (/^ledger-(stock-unpublished|stock-held):odoo$/.test(body.domain)) otherMarks.set(body.domain, { watermark_cursor: body.watermark_cursor, updated_at: (body as unknown as { updated_at: string }).updated_at });
      else if (body.domain === 'ledger-caught-up:odoo') markers.push(body.watermark_cursor);
      else if (body.domain === 'ledger-published:odoo') publishedAt = (body as unknown as { updated_at: string }).updated_at;
      else { fingerprint = body.watermark_cursor; fingerprintUpdatedAt = (body as unknown as { updated_at: string }).updated_at; }
      return new Response(null, { status: 201 });
    } },
    supabaseSelect('odoo_ledger_checks', () => jsonResponse(o.lastCheckAt ? [{ checked_at: o.lastCheckAt }] : [])),
    supabaseRpc('record_odoo_ledger_check', (c) => {
      if (o.failRecord) return jsonResponse({ code: 'P0001', message: 'no' }, { status: 400 });
      checks.push(c.bodyJson as (typeof checks)[number]);
      return new Response(null, { status: 204 });
    }),
    supabaseSelect('external_project_bindings', (c) => jsonResponse(c.url.searchParams.get('id') ? [] : Object.entries(links).map(([project_id, external_container_id], i) => ({ id: `b${i}`, project_id, external_container_id })))),
    supabaseSelect('external_master_records', (c) => jsonResponse(c.url.searchParams.get('id') ? [] : Object.entries(accounts).map(([external_id, code]) => ({ id: `m${external_id}`, external_id, code })))),
    supabaseSelect('erp_gl_entry_mirror', (c) => {
      const after = (c.url.searchParams.get('id') ?? '').replace(/^gt\./, '');
      const rows = [...mirror.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).filter(([id]) => !after || id > after).slice(0, 1000)
        .map(([id, r]) => ({ id, project: r.project, cost_center: null, account: r.account, fiscal_year: r.fiscal_year, debit: r.debit, credit: r.credit, voucher_type: 'account.move', is_cancelled: r.is_cancelled, erp_modified: (r as unknown as { source_write_date: string }).source_write_date }));
      return jsonResponse(rows);
    }),
    supabaseRpc('apply_odoo_ledger_page', (c) => {
      const page = c.bodyJson as Page;
      applies.push(page);
      if (o.failApplyAt !== undefined && applies.length === o.failApplyAt) return jsonResponse({ code: 'P0001', message: 'apply failed' }, { status: 400 });
      // The database counts rows it inserted, changed or removed; an unchanged re-read is 0.
      const keys = new Set(page.p_rows.map((r) => r.erp_name));
      const lineOf = (n: string) => n.split(':')[1];
      const gone = [...mirror.keys()].filter((n) => !keys.has(n) && page.p_rows.some((r) => lineOf(r.erp_name) === lineOf(n)));
      const changedRows = page.p_rows.filter((r) => JSON.stringify(mirror.get(r.erp_name)) !== JSON.stringify(r));
      for (const r of page.p_rows) mirror.set(r.erp_name, r);
      for (const n of gone) mirror.delete(n);
      cursor = page.p_cursor;
      return jsonResponse(changedRows.length + gone.length);
    }),
    supabaseRpc('set_odoo_fiscal_year_end', (c) => { yearEnds.push(c.bodyJson as { p_org_id: string; p_month: number; p_day: number }); return new Response(null, { status: 204 }); }),
    supabaseRpc('mark_odoo_ledger_census_seen', (c) => { census.seen.push((c.bodyJson as { p_line_ids: string[] }).p_line_ids); return jsonResponse(null); }),
    supabaseRpc('finish_odoo_ledger_census', (c) => { census.finish.push({ expected: (c.bodyJson as { p_expected_lines: number | null }).p_expected_lines }); return jsonResponse(0); }),
    supabaseSelect('external_domain_ownership', () => jsonResponse(o.inventory ? [{ created_at: o.inventoryCreatedAt ?? '2026-01-01T00:00:00Z', organizations: { default_timezone: o.timezone ?? 'UTC' } }] : [])),
    supabaseRpc('apply_odoo_stock_cost_page', (c) => {
      const page = c.bodyJson as (typeof stockApplies)[number];
      stockApplies.push(page);
      if (failStockApplyAt !== undefined && stockApplies.length === failStockApplyAt) return jsonResponse({ code: 'P0001', message: 'apply failed' }, { status: 400 });
      let n = 0;
      for (const r of page.p_rows) {
        // The database drops lines posted before the inventory ownership start (D10).
        if (String(r.posting_date) < new Intl.DateTimeFormat('en-CA', { timeZone: o.timezone ?? 'UTC' }).format(new Date(o.inventoryCreatedAt ?? '2026-01-01T00:00:00Z'))) continue;
        const key = String(r.analytic_line_id);
        if (JSON.stringify(stockStore.get(key)) !== JSON.stringify(r)) n++;
        stockStore.set(key, r);
      }
      stockCursor = page.p_cursor;
      return jsonResponse(o.stockApplyChanged ?? n);
    }),
    supabaseRpc('mark_odoo_stock_cost_census_seen', (c) => { stockCensus.seen.push((c.bodyJson as { p_line_ids: string[] }).p_line_ids); return jsonResponse(null); }),
    supabaseRpc('finish_odoo_stock_cost_census', (c) => { stockCensus.finish.push({ expected: (c.bodyJson as { p_expected_lines: number | null }).p_expected_lines }); return jsonResponse(0); }),
    supabaseSelect('odoo_stock_cost_checks', () => jsonResponse(o.stockLastCheckAt ? [{ checked_at: o.stockLastCheckAt }] : [])),
    supabaseRpc('record_odoo_stock_cost_check', (c) => {
      if (failStockRecordOnce) { failStockRecordOnce = false; return jsonResponse({ code: 'P0001', message: 'record failed' }, { status: 400 }); }
      stockChecks.push(c.bodyJson as Record<string, unknown>); return new Response(null, { status: 204 });
    }),
    // The database marks exactly the listed lines (clearing the others) and counts the rows whose marking changed.
    supabaseRpc('mark_odoo_stock_cost_double_counts', (c) => {
      const ids = (c.bodyJson as { p_analytic_line_ids: number[] }).p_analytic_line_ids;
      doubleMarks.push(ids);
      const changed = ids.filter((i) => !marked.has(i)).length + [...marked].filter((i) => !ids.includes(i)).length;
      marked.clear(); for (const i of ids) marked.add(i);
      return jsonResponse(changed);
    }),
    supabaseSelect('odoo_stock_cost_lines', (c) => {
      const after = (c.url.searchParams.get('id') ?? '').replace(/^gt\./, '');
      const rows = [...stockStore.values()].map((r) => ({ id: `sc-${String(r.analytic_line_id).padStart(8, '0')}`, is_cancelled: false, double_count_risk: marked.has(Number(r.analytic_line_id)),
        tie_state: o.stockTie ?? 'tied', ...r })).sort((a, b) => (a.id < b.id ? -1 : 1)).filter((r) => !after || r.id > after)
        .filter((r) => c.url.searchParams.get('double_count_risk') !== 'eq.false' || !r.double_count_risk);
      return jsonResponse(rows);
    }),
    supabaseRpc('replace_erp_snapshot', (c) => {
      if (failSnapshotOnce) { failSnapshotOnce = false; return jsonResponse({ code: 'P0001', message: 'publish failed' }, { status: 400 }); }
      snapshots.push((c.bodyJson as { p_rows: Record<string, unknown>[] }).p_rows); return jsonResponse(null);
    }),
  ];
  return {
    fake, routes, applies, checks, markers, snapshots, census, mirror, yearEnds, stockApplies, stockStore, stockCensus, stockChecks, doubleMarks,
    getStockCursor: () => stockCursor,
    otherMarks,
    clearStockFailure: () => { failStockApplyAt = undefined; },
    switchNow: () => { switched = true; },
    getCursor: () => cursor,
    setCursor: (c: string) => { cursor = c; },
    addAccount: (id: string, code: string) => { accounts[id] = code; },
    relink: (l: Record<string, string>) => { links = l; },
    rewinds: () => rewinds,
    primeLinkFingerprint: async (updatedAt: string) => {
      const byAccount = new Map<string, string[]>();
      for (const [project, account] of Object.entries(links)) byAccount.set(account, [...(byAccount.get(account) ?? []), project]);
      const canonical = [...byAccount].map(([account, projects]) => `${account}:${[...projects].sort().join(',')}`).sort().join(';');
      const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical));
      fingerprint = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
      fingerprintUpdatedAt = updatedAt;
    },
  };
}
/** `refuseCompany`: Odoo answers 403 to the company read, as it does for a key user without access to it. */
const odooCall = (fake: FakeOdoo, refuseCompany = false) => bindCall({
  baseUrl: 'https://odoo.example.test', apiKey: 'k', database: 'db1',
  fetchImpl: ((input: Parameters<typeof fetch>[0], init?: RequestInit) => (refuseCompany && String(input).includes('/res.company/read')
    ? Promise.resolve(Response.json({ name: 'odoo.exceptions.AccessError', message: 'no' }, { status: 403 })) : fake.fetch(input, init))) as typeof fetch,
});
const rowsOf = (applies: Page[]) => applies.flatMap((p) => p.p_rows);

describe('ledgerFeedEmployed — AC-ODA-001', () => {
  it('is on for an activated binding whose snapshot reads account.move.line', async () => {
    const h = harness(() => {});
    assertEquals(await withFetchMock(h.routes, () => ledgerFeedEmployed(client(), ORG)), true);
  });
  it('is off when the capability is missing, unreadable or the binding is not activated', async () => {
    for (const binding of [{ config: { capabilities: { later: { 'account.move.line': false } } } }, { config: {} }, { activated_at: null }, { status: 'degraded' }]) {
      const h = harness(() => {}, { binding });
      assertEquals(await withFetchMock(h.routes, () => ledgerFeedEmployed(client(), ORG)), false, JSON.stringify(binding));
    }
  });
  it('is off, not a thrown tick, when the binding cannot be read', async () => {
    const routes = [supabaseSelect('external_org_bindings', () => jsonResponse({ message: 'down' }, { status: 500 }))];
    assertEquals(await withFetchMock(routes, () => ledgerFeedEmployed(client(), ORG)), false);
  });
});

describe('runLedgerPass — AC-ODA-001/002/003', () => {
  it('AC-ODA-002 splits a line by linked project account, maps the account code and stamps the fiscal year', async () => {
    const h = harness((fake) => fake.seed('account.move.line', [line(1, { analytic_distribution: { '101': 60 }, debit: 100.01 })]), { fiscal: { month: '3', day: 31 } });
    const out = await withFetchMock(h.routes, () => runLedgerPass(client(), ORG, odooCall(h.fake), 1, budget()));
    assertEquals(rowsOf(h.applies).map((r) => [r.erp_name, r.account, r.project, r.debit, r.fiscal_year]), [
      ['odoo:1:101', '5100', '101', '60.01', '2027'],
      ['odoo:1:-', '5100', null, '40.00', '2027'],
    ]);
    assertEquals(out.caughtUp, true);
  });

  it('AC-ODA-002 a year end that is unreadable falls back to the calendar year', async () => {
    const h = harness((fake) => fake.seed('account.move.line', [line(1)]));
    await withFetchMock(h.routes, () => runLedgerPass(client(), ORG, odooCall(h.fake), 1, budget()));
    assertEquals(rowsOf(h.applies)[0].fiscal_year, '2026');
  });

  it('AC-ODA-001 a draft line is kept cancelled; a never-posted draft with no name is skipped and counted', async () => {
    const h = harness((fake) => fake.seed('account.move.line', [line(1, { parent_state: 'draft' }), line(2, { move_name: false, parent_state: 'draft' })]));
    const out = await withFetchMock(h.routes, () => runLedgerPass(client(), ORG, odooCall(h.fake), 1, budget()));
    assertEquals(rowsOf(h.applies).map((r) => [r.erp_name, r.is_cancelled]), [['odoo:1:-', true]]);
    assertEquals(out.skipped, 1);
  });

  it('AC-ODA-001 an account the directory has not mirrored yet holds the feed at that page, visibly: stalled with the line count, never caught up, cursor left', async () => {
    const h = harness((fake) => fake.seed('account.move.line', [line(1, { account_id: [999, '9999 New'] }), line(2), line(3, { account_id: [998, '9998 New'] })]));
    const out = await withFetchMock(h.routes, () => runLedgerPass(client(), ORG, odooCall(h.fake), 1, budget()));
    assertEquals(out, { rows: 0, caughtUp: false, skipped: 0, stalled: 'account', held: 2 });
    assertEquals(h.applies.length, 0);
    assertEquals(h.getCursor(), undefined);
    assertEquals(h.census.finish.length, 0, 'a stalled feed never runs the census');
  });

  it('AC-ODA-001 once the account is mirrored the held page applies from the same cursor', async () => {
    const h = harness((fake) => fake.seed('account.move.line', [line(1, { account_id: [999, '9999 New'] })]));
    await withFetchMock(h.routes, () => runLedgerPass(client(), ORG, odooCall(h.fake), 1, budget()));
    h.addAccount('999', '9999');
    const out = await withFetchMock(h.routes, () => runLedgerPass(client(), ORG, odooCall(h.fake), 1, budget()));
    assertEquals([out.stalled, out.caughtUp, out.rows], [undefined, true, 1]);
  });

  it('AC-ODA-002 a company year end Odoo refuses falls back to the calendar year and says so; a transient failure fails the pass instead', async () => {
    const denied = harness((fake) => fake.seed('account.move.line', [line(1)]));
    const out = await withFetchMock(denied.routes, () => runLedgerPass(client(), ORG, odooCall(denied.fake, true), 1, budget()));
    assertEquals([out.calendarYear, rowsOf(denied.applies)[0].fiscal_year, out.caughtUp], [true, '2026', true]);
    const down = harness((fake) => fake.seed('account.move.line', [line(1)]));
    down.fake.failNext('transport');
    await withFetchMock(down.routes, async () => { await assertRejects(() => runLedgerPass(client(), ORG, odooCall(down.fake), 1, budget())); });
    assertEquals(down.applies.length, 0, 'a hiccup never stamps a page with the wrong year');
  });

  it('AC-ODA-002 persists the company year end for the statements to read, and persists nothing when Odoo refuses it', async () => {
    const h = harness((fake) => fake.seed('account.move.line', [line(1)]), { fiscal: { month: '3', day: 31 } });
    await withFetchMock(h.routes, () => runLedgerPass(client(), ORG, odooCall(h.fake), 1, budget()));
    assertEquals(h.yearEnds, [{ p_org_id: ORG, p_month: 3, p_day: 31 }]);
    const denied = harness((fake) => fake.seed('account.move.line', [line(1)]));
    await withFetchMock(denied.routes, () => runLedgerPass(client(), ORG, odooCall(denied.fake, true), 1, budget()));
    assertEquals(denied.yearEnds, []);
  });

  it('AC-ODA-004 a catch-up census sends every line id and the count the database must see', async () => {
    const h = harness((fake) => fake.seed('account.move.line', [line(1), line(2), line(3)]));
    await withFetchMock(h.routes, () => runLedgerPass(client(), ORG, odooCall(h.fake), 1, budget()));
    assertEquals(h.census.seen.flat().sort(), ['1', '2', '3']);
    assertEquals(h.census.finish, [{ expected: 3 }]);
  });
});

describe('runLedgerPass — NFR-ODA-003 budget', () => {
  it('a 5,000-line backlog stops at the budget with the cursor at the last applied page, and the next pass resumes without gaps', async () => {
    const h = harness((fake) => fake.seed('account.move.line', Array.from({ length: 5000 }, (_, i) => line(i + 1, { write_date: `2026-11-02 10:${String(Math.floor(i / 60) % 60).padStart(2, '0')}:${String(i % 60).padStart(2, '0')}` }))));
    const first = await withFetchMock(h.routes, () => runLedgerPass(client(), ORG, odooCall(h.fake), 1, budget(6), { pageSize: 200 }));
    assertEquals(first.caughtUp, false);
    assert(h.applies.length > 0 && h.applies.length <= 5, `applied ${h.applies.length} pages within 6 calls`);
    assertEquals(h.getCursor(), h.applies.at(-1)!.p_cursor);
    assertEquals(h.census.finish.length, 0, 'no census before the feed catches up');
    const done = await withFetchMock(h.routes, () => runLedgerPass(client(), ORG, odooCall(h.fake), 1, budget(500), { pageSize: 200 }));
    assertEquals(done.caughtUp, true);
    const lines = new Set(rowsOf(h.applies).map((r) => r.erp_name));
    assertEquals(lines.size, 5000);
    assertEquals(h.census.finish, [{ expected: 5000 }]);
  });

  it('with no calls left nothing is read or applied', async () => {
    const h = harness((fake) => fake.seed('account.move.line', [line(1)]));
    const out = await withFetchMock(h.routes, () => runLedgerPass(client(), ORG, odooCall(h.fake), 1, budget(0)));
    assertEquals([h.applies.length, out.caughtUp, out.rows], [0, false, 0]);
  });
});

describe('runLedgerPass — AC-ODA-003 / FR-ODA-053 tier-neutral actuals refresh', () => {
  const seed = (fake: FakeOdoo) => fake.seed('account.move.line', [
    line(1, { analytic_distribution: { '101': 100 }, debit: 300 }),      // one linked project
    line(2, { analytic_distribution: { '102': 100 }, debit: 70 }),       // claimed by two projects: ambiguous
    line(3, { analytic_distribution: { '103': 100 }, debit: 20 }),       // an account no project links
    line(4, { debit: 10 }),                                              // no distribution
  ]);

  it('publishes one snapshot: the linked project owns its sums; ambiguous, unlinked and undistributed amounts stay unattributed', async () => {
    const h = harness(seed);
    const out = await withFetchMock(h.routes, () => runLedgerPass(client(), ORG, odooCall(h.fake), 1, budget()));
    assertEquals(h.snapshots.length, 1);
    const byProject = (id: string | null) => h.snapshots[0].filter((r) => r.project_id === id).reduce((s, r) => s + Number(r.debit), 0);
    assertEquals([byProject(P1), byProject(P2), byProject(P3), byProject(null)], [300, 0, 0, 100]);
    assertEquals(out.rows, 4);
  });

  it('does not rebuild the snapshot when nothing changed', async () => {
    const h = harness(seed);
    await withFetchMock(h.routes, async () => {
      await runLedgerPass(client(), ORG, odooCall(h.fake), 1, budget());
      await runLedgerPass(client(), ORG, odooCall(h.fake), 1, budget());
    });
    assertEquals(h.snapshots.length, 1);
  });

  it('an org with no linked project still publishes, every sum unattributed', async () => {
    const h = harness(seed, { links: {} });
    await withFetchMock(h.routes, () => runLedgerPass(client(), ORG, odooCall(h.fake), 1, budget()));
    assertEquals(h.snapshots[0].every((r) => r.project_id === null), true);
  });

  it('no ledger amount is written to the log', async () => {
    const h = harness(seed);
    const logged: string[] = [];
    const real = console.error;
    console.error = (...a: unknown[]) => { logged.push(a.join(' ')); };
    try { await withFetchMock(h.routes, () => runLedgerPass(client(), ORG, odooCall(h.fake), 1, budget())); } finally { console.error = real; }
    assertEquals(logged, []);
  });
});

describe('runLedgerPass — org basis switch and change-only refresh', () => {
  const seed = (fake: FakeOdoo) => fake.seed('account.move.line', [line(1, { analytic_distribution: { '101': 100 }, debit: 300 }), line(2, { debit: 10 })]);

  it('AC-ODA-003 before an Admin switches the org to Odoo the lines are mirrored and no snapshot is published', async () => {
    const h = harness(seed, { switched: false });
    const out = await withFetchMock(h.routes, () => runLedgerPass(client(), ORG, odooCall(h.fake), 1, budget()));
    assertEquals([out.rows, h.mirror.size, h.snapshots.length], [2, 2, 0]);
  });

  it('AC-ODA-003 once switched, a change publishes and a pass that changed nothing does not', async () => {
    const h = harness(seed);
    await withFetchMock(h.routes, async () => {
      await runLedgerPass(client(), ORG, odooCall(h.fake), 1, budget());
      assertEquals(h.snapshots.length, 1);
      await runLedgerPass(client(), ORG, odooCall(h.fake), 1, budget());
    });
    assertEquals(h.snapshots.length, 1);
  });
});

describe('runLedgerPass — first publish after the switch', () => {
  const seed = (fake: FakeOdoo) => fake.seed('account.move.line', [line(1, { analytic_distribution: { '101': 100 }, debit: 300 })]);

  it('AC-ODA-016 a switched org whose ledger is already stored and quiet publishes once, then only on change', async () => {
    const h = harness(seed, { switched: false });
    const pass = () => withFetchMock(h.routes, () => runLedgerPass(client(), ORG, odooCall(h.fake), 1, budget()));
    await pass();
    assertEquals(h.snapshots.length, 0);
    h.switchNow();
    await pass();
    assertEquals(h.snapshots.length, 1, 'no change in the ledger, still published once after the switch');
    await pass();
    assertEquals(h.snapshots.length, 1);
  });

  it('a publish marker older than the switch is published again; a newer one is not', async () => {
    const stale = harness(seed, { publishedAt: '2026-11-04T00:00:00Z' });
    await withFetchMock(stale.routes, async () => { await runLedgerPass(client(), ORG, odooCall(stale.fake), 1, budget()); });
    assertEquals(stale.snapshots.length, 1);
    const current = harness(seed, { publishedAt: '2026-11-06T00:00:00Z' });
    await withFetchMock(current.routes, async () => { await runLedgerPass(client(), ORG, odooCall(current.fake), 1, budget()); await runLedgerPass(client(), ORG, odooCall(current.fake), 1, budget()); });
    assertEquals(current.snapshots.length, 1, 'only the first pass changed rows');
  });
});

describe('runLedgerPass — AC-ODA-002 a late project link re-attributes the stored lines', () => {
  const seed = (fake: FakeOdoo) => fake.seed('account.move.line', [line(1, { analytic_distribution: { '101': 100 }, debit: 300 })]);

  it('lines fed while the analytic account was unlinked move to the project once it is linked, in a bounded rewind', async () => {
    const h = harness(seed, { links: {} });
    const pass = () => withFetchMock(h.routes, () => runLedgerPass(client(), ORG, odooCall(h.fake), 1, budget()));
    await pass();
    assertEquals([...h.mirror.values()].map((r) => r.project), [null]);
    assertEquals(h.rewinds(), 1, 'the first pass records the link set (nothing stored to rewind)');
    await pass();
    assertEquals(h.rewinds(), 1, 'an unchanged link set rewinds nothing');
    h.relink({ [P1]: '101' });
    await pass();
    assertEquals(h.rewinds(), 2);
    assertEquals([...h.mirror.entries()].map(([n, r]) => [n, r.project]), [['odoo:1:101', '101']]);
    await pass();
    assertEquals(h.rewinds(), 2, 'one rewind per link change, not per pass');
  });

  it('a two-claimant analytic account that becomes one claimant is re-attributed too', async () => {
    const h = harness(seed, { links: { [P2]: '101', [P3]: '101' } });
    const pass = () => withFetchMock(h.routes, () => runLedgerPass(client(), ORG, odooCall(h.fake), 1, budget()));
    await pass();
    assertEquals([...h.mirror.keys()], ['odoo:1:-']);
    h.relink({ [P2]: '101' });
    await pass();
    assertEquals([...h.mirror.keys()], ['odoo:1:101']);
  });
});

describe('runLedgerPass — AC-ODA-008 / S4-T4 reconciliation check', () => {
  const NOW = () => new Date('2026-11-02T12:00:00Z');
  // A first full read stores the cursor at its start minus the overlap (11:50); the check cuts off a further overlap earlier (11:40). Odoo side: 200.00 / 40.00 over account 5100.
  const old = (id: number, over: Record<string, unknown> = {}) => line(id, { write_date: `2026-11-02 08:00:0${id}`, ...over });
  const seed = (fake: FakeOdoo) => fake.seed('account.move.line', [old(1), old(2, { debit: 0, credit: 40, balance: -40 }), line(3, { write_date: '2026-11-02 10:00:00' })]);

  it('AC-ODA-008 a caught-up tick with no earlier check reads Odoo grouped totals at cursor minus overlap and records "matches"', async () => {
    const h = harness(seed);
    const out = await withFetchMock(h.routes, () => runLedgerPass(client(), ORG, odooCall(h.fake), 1, budget(), { now: NOW }));
    assertEquals(out.caughtUp, true);
    assertEquals(h.checks.length, 1);
    assertEquals(h.checks[0].p_status, 'matches');
    assertEquals(h.checks[0].p_cutoff, '2026-11-02T11:40:00.000Z');
    assertEquals(h.checks[0].p_accounts, []);
    assertEquals(h.checks[0].p_accounts_checked, 1);
    assertEquals(h.checks[0].p_feed_position, `${JSON.parse(h.getCursor()!).w}|${JSON.parse(h.getCursor()!).id}`);
    assertEquals(h.markers, ['true']);
  });

  it('AC-ODA-008 one account that differs is recorded with the account, the PMO figure and the Odoo figure; nothing is corrected', async () => {
    const h = harness(seed);
    const orig = h.fake.fetch.bind(h.fake);
    const call = bindCall({ baseUrl: 'https://odoo.example.test', apiKey: 'k', database: 'db1', fetchImpl: (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
      const res = await orig(input, init);
      if (!String(input).includes('/formatted_read_group')) return res;
      const groups = (await res.json()) as Array<Record<string, unknown>>;
      return Response.json(groups.map((g) => ({ ...g, 'debit:sum': Number(g['debit:sum']) + 20 })));
    }) as typeof fetch });
    await withFetchMock(h.routes, () => runLedgerPass(client(), ORG, call, 1, budget(), { now: NOW }));
    assertEquals(h.checks[0].p_status, 'differs');
    assertEquals(h.checks[0].p_accounts, [{ account: '5100', pmo: { debit: '200.00', credit: '40.00' }, odoo: { debit: '220.00', credit: '40.00' } }]);
  });

  it('AC-ODA-008 a failing grouped read records "not-checked" with the error class and never fails the tick', async () => {
    const h = harness(seed);
    const call = bindCall({ baseUrl: 'https://odoo.example.test', apiKey: 'k', database: 'db1', fetchImpl: ((input: Parameters<typeof fetch>[0], init?: RequestInit) =>
      String(input).includes('/formatted_read_group') ? Promise.resolve(Response.json({ name: 'odoo.exceptions.AccessError', message: 'no' }, { status: 403 })) : h.fake.fetch(input, init)) as typeof fetch });
    const out = await withFetchMock(h.routes, () => runLedgerPass(client(), ORG, call, 1, budget(), { now: NOW }));
    assertEquals(out.caughtUp, true);
    assertEquals([h.checks[0].p_status, h.checks[0].p_reason, h.checks[0].p_accounts_checked], ['not-checked', 'access-denied', 0]);
  });

  /** Odoo answers the grouped read with `groups`, whatever the mirror holds. */
  const withGroups = (h: ReturnType<typeof harness>, groups: unknown[], onRead?: () => void) => bindCall({ baseUrl: 'https://odoo.example.test', apiKey: 'k', database: 'db1', fetchImpl: ((input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    if (!String(input).includes('/formatted_read_group')) return h.fake.fetch(input, init);
    onRead?.();
    return Promise.resolve(Response.json(groups));
  }) as typeof fetch });

  it('AC-ODA-008 Odoo answering nothing while the mirror holds lines is "differs", never "matches"', async () => {
    const h = harness(seed);
    await withFetchMock(h.routes, () => runLedgerPass(client(), ORG, withGroups(h, []), 1, budget(), { now: NOW }));
    assertEquals(h.checks[0].p_status, 'differs');
    assertEquals(h.checks[0].p_accounts, [{ account: '5100', pmo: { debit: '200.00', credit: '40.00' }, odoo: { debit: '0.00', credit: '0.00' } }]);
    assertEquals(h.checks[0].p_accounts_checked, 1);
  });

  it('AC-ODA-008 a mirror whose only line is newer than the cut-off and an empty Odoo records "matches" over 0 accounts (the count says nothing was compared)', async () => {
    const h = harness((fake) => fake.seed('account.move.line', [line(3, { write_date: '2026-11-02 11:45:00' })]));
    await withFetchMock(h.routes, () => runLedgerPass(client(), ORG, withGroups(h, []), 1, budget(), { now: NOW }));
    assertEquals([h.checks[0].p_status, h.checks[0].p_accounts_checked], ['matches', 0]);
  });

  it('AC-ODA-008 the mirror holding a line Odoo does not total, in an account only the mirror has, is "differs"', async () => {
    const h = harness(seed);
    await withFetchMock(h.routes, () => runLedgerPass(client(), ORG, withGroups(h, [{ account_id: [501, '5100 Cost'], 'debit:sum': 200, 'credit:sum': 40 }, { account_id: [777, '7770 Other'], 'debit:sum': 5, 'credit:sum': 0 }]), 1, budget(), { now: NOW }));
    assertEquals(h.checks[0].p_status, 'differs');
    assertEquals(h.checks[0].p_accounts_checked, 2);
  });

  it('AC-ODA-008 a feed page applied while the check ran drops the result instead of recording a false difference', async () => {
    const h = harness(seed);
    const call = withGroups(h, [], () => h.setCursor(JSON.stringify({ w: '2026-11-02 11:59:59', id: 99, scan: null })));
    await withFetchMock(h.routes, () => runLedgerPass(client(), ORG, call, 1, budget(), { now: NOW }));
    assertEquals(h.checks.length, 0);
  });

  it('AC-ODA-008 a check that cannot even be recorded does not fail the tick', async () => {
    const h = harness(seed, { failRecord: true });
    const out = await withFetchMock(h.routes, () => runLedgerPass(client(), ORG, odooCall(h.fake), 1, budget(), { now: NOW }));
    assertEquals(out.caughtUp, true);
    assertEquals(h.checks.length, 0);
  });

  it('S4-T4 without a link change, less than an hour after the last check, does not reconcile again', async () => {
    const h = harness(seed, { lastCheckAt: '2026-11-02T11:30:00Z' });
    await h.primeLinkFingerprint('2026-11-02T10:00:00Z');
    const out = await withFetchMock(h.routes, () => runLedgerPass(client(), ORG, odooCall(h.fake), 1, budget(), { now: NOW }));
    assertEquals(out.caughtUp, true);
    assertEquals(h.rewinds(), 0);
    assertEquals(h.checks.length, 0);
  });

  it('S4-T4 a changed project link forces a caught-up reconciliation inside the hourly window', async () => {
    const now = new Date();
    const recentCheckAt = new Date(now.getTime() - 30 * 60_000).toISOString();
    const earlierLinkChangeAt = new Date(now.getTime() - 2 * 60 * 60_000).toISOString();
    const h = harness(seed, { lastCheckAt: recentCheckAt });
    await h.primeLinkFingerprint(earlierLinkChangeAt);
    h.relink({ [P1]: '101', [P2]: '109', [P3]: '102' });

    const out = await withFetchMock(h.routes, () => runLedgerPass(client(), ORG, odooCall(h.fake), 1, budget(), { now: () => new Date() }));

    assertEquals(out.caughtUp, true);
    assertEquals(h.rewinds(), 1);
    assertEquals(h.checks.length, 1, 'a check after the latest link fingerprint change is required despite the hourly throttle');
  });

  it('S4-T4 an hour after the last check it runs again', async () => {
    const h = harness(seed, { lastCheckAt: '2026-11-02T10:59:00Z' });
    await withFetchMock(h.routes, () => runLedgerPass(client(), ORG, odooCall(h.fake), 1, budget(), { now: NOW }));
    assertEquals(h.checks.length, 1);
  });

  it('S4-T4 a feed that is not caught up runs no check and marks "not caught up"', async () => {
    const h = harness((fake) => fake.seed('account.move.line', [line(1, { account_id: [999, '9999 New'] })]));
    const out = await withFetchMock(h.routes, () => runLedgerPass(client(), ORG, odooCall(h.fake), 1, budget(), { now: NOW }));
    assertEquals(out.caughtUp, false);
    assertEquals(h.checks.length, 0);
    assertEquals(h.markers, ['false']);
  });
});

describe('runLedgerPass — #2282 issued material cost kind (AC-IMC-001, 004, 005)', () => {
  // After the fixtures' write dates (08:00 to 09:00) by more than the 10-minute overlap, so the scan hands over past them and nothing here depends on the day or millisecond it runs.
  const NOW = () => new Date('2026-11-14T09:30:00Z');
  const issue = (id: number, over: Record<string, unknown> = {}) => ({
    id, name: 'WH/OUT/00004', category: 'picking_entry', move_line_id: false, account_id: [101, 'Project A'], general_account_id: false,
    product_id: [77, 'Cement'], unit_amount: 2, amount: -240, date: '2026-11-14', company_id: [1, 'Main'], write_date: `2026-11-14 08:00:${String(id % 60).padStart(2, '0')}`, ...over,
  });
  const seedStock = (fake: FakeOdoo, lines: Array<Record<string, unknown>>, moveEntry: unknown = false) => {
    fake.seed('account.analytic.line', lines);
    fake.seed('stock.picking', [{ id: 9001, name: 'WH/OUT/00004', company_id: [1, 'Main'], return_id: false, move_ids: [11] }]);
    fake.seed('stock.move', [{ id: 11, picking_id: [9001, 'WH/OUT/00004'], product_id: [77, 'Cement'], account_move_id: moveEntry }]);
    fake.seed('product.product', [{ id: 77, name: 'Cement', property_account_expense_id: [520, '5200 Materials'], categ_id: false }]);
  };
  const counting = (fake: FakeOdoo) => {
    const urls: string[] = [];
    const call = bindCall({ baseUrl: 'https://odoo.example.test', apiKey: 'k', database: 'db1',
      fetchImpl: ((input: Parameters<typeof fetch>[0], init?: RequestInit) => { urls.push(String(input)); return fake.fetch(input, init); }) as typeof fetch });
    return { call, urls };
  };
  const accounts = { '501': '5100', '520': '5200' };

  it('AC-IMC-001 an org whose inventory Odoo does not own never reads an analytic line', async () => {
    const h = harness((fake) => seedStock(fake, [issue(31)]), { accounts });
    const c = counting(h.fake);
    await withFetchMock(h.routes, () => runLedgerPass(client(), ORG, c.call, 1, budget(), { now: NOW }));
    assertEquals(c.urls.filter((u) => u.includes('account.analytic.line')), []);
    assertEquals(h.stockApplies.length, 0);
  });

  it('AC-IMC-001 a stock line that does not parse is skipped and counted in the result, so the sweep says why the check differs', async () => {
    const h = harness((fake) => seedStock(fake, [issue(31), issue(33, { name: '' })]), { accounts, inventory: true });
    const out = await withFetchMock(h.routes, () => runLedgerPass(client(), ORG, odooCall(h.fake), 1, budget(), { now: NOW }));
    assertEquals([out.stockRows, out.stockSkipped], [1, 1]);
  });

  it('AC-IMC-001 the issue is sent once on its own cursor, with company, picking, account and amount; a line with a journal item is never sent', async () => {
    // One ledger line written after the scan handover, so the two kinds' cursors hold different positions.
    const h = harness((fake) => { fake.seed('account.move.line', [line(1, { write_date: '2026-11-14 09:25:00' })]); seedStock(fake, [issue(31), issue(32, { move_line_id: [88, 'STJ/1'] })]); }, { accounts, inventory: true });
    const out = await withFetchMock(h.routes, () => runLedgerPass(client(), ORG, odooCall(h.fake), 1, budget(), { now: NOW }));
    assertEquals(h.stockApplies.flatMap((p) => p.p_rows).map((r) => [r.analytic_line_id, r.company_id, r.odoo_picking_id, r.account, r.debit, r.credit, r.analytic_account_id, r.fiscal_year]),
      [[31, 1, 9001, '5200', '240.00', '0.00', '101', '2026']]);
    // Each kind's cursor is written by its own apply and holds its own feed's position (the stock scan handed over at NOW minus the overlap).
    assertEquals(h.stockApplies.at(-1)!.p_cursor, h.getStockCursor());
    assertEquals(h.applies.at(-1)!.p_cursor, h.getCursor());
    const [stock, ledger] = [JSON.parse(h.getStockCursor()!), JSON.parse(h.getCursor()!)];
    assertEquals([stock.w, stock.id, stock.scan], ['2026-11-14 09:20:00', 0, null]);
    assertEquals([ledger.w, ledger.id, ledger.scan], ['2026-11-14 09:25:00', 1, null]);
    assertEquals([out.stockRows, out.stockCaughtUp, out.caughtUp], [1, true, true]);
    assertEquals(h.stockCensus.finish, [{ expected: 1 }]);
  });

  it('AC-IMC-002 a changed stock line republishes the actuals with the stock source even when the GL is quiet', async () => {
    const h = harness((fake) => seedStock(fake, [issue(31)]), { accounts, inventory: true, publishedAt: '2026-11-10T00:00:00Z' });
    await withFetchMock(h.routes, () => runLedgerPass(client(), ORG, odooCall(h.fake), 1, budget(), { now: NOW }));
    assertEquals(h.snapshots.length, 1);
    assertEquals(h.snapshots[0].filter((r) => r.source_report === 'Odoo stock issue').map((r) => [r.project_id, r.account, r.net]), [[P1, '5200', 240]]);
  });

  it('AC-IMC-001 an account the directory has not mirrored holds the stock kind and says so; the GL result is intact', async () => {
    const h = harness((fake) => { fake.seed('account.move.line', [line(1)]); seedStock(fake, [issue(31)]); }, { accounts: { '501': '5100' }, inventory: true });
    const out = await withFetchMock(h.routes, () => runLedgerPass(client(), ORG, odooCall(h.fake), 1, budget(), { now: NOW }));
    assertEquals([out.rows, out.caughtUp, out.stalled, out.held, out.stockCaughtUp], [1, true, 'account', 1, false]);
    assertEquals(h.stockApplies.length, 0);
    assertEquals(h.getStockCursor(), undefined);
  });

  it('AC-IMC-001 a product with no category and no expense account holds the stock kind; one audit event names the product and the remedy', async () => {
    const audits: Array<Record<string, unknown>> = [];
    const h = harness((fake) => { seedStock(fake, [issue(31)]); fake.seed('product.product', [{ id: 77, name: 'Loose Sand', property_account_expense_id: false, categ_id: false }]); }, { accounts, inventory: true });
    const routes = [supabaseRpc('log_audit', (c) => { audits.push(c.bodyJson as Record<string, unknown>); return new Response(null, { status: 204 }); }), ...h.routes];
    const out = await withFetchMock(routes, () => runLedgerPass(client(), ORG, odooCall(h.fake), 1, budget(), { now: NOW }));
    assertEquals([out.stalled, out.held, out.stockCaughtUp], ['account', 1, false]);
    // The sweep returns this object in one HTTP response for every organisation: counts and codes only, never a product name.
    assert(!JSON.stringify(out).includes('Loose Sand'), 'a product name travelled in the pass result');
    assertEquals(audits.length, 1);
    assertEquals([audits[0].p_action, audits[0].p_org_id], ['integration.odoo.stock_cost_held', ORG]);
    const detail = audits[0].p_detail as { products: string[]; held: number; remedy: string };
    assertEquals([detail.products, detail.held], [['Loose Sand'], 1]);
    assert(detail.remedy.includes('category or an expense account'));
  });

  it('AC-IMC-001 a hold that lasts writes the audit event once, and again only when the held products change', async () => {
    const audits: Array<Record<string, unknown>> = [];
    const h = harness((fake) => { seedStock(fake, [issue(31)]); fake.seed('product.product', [{ id: 77, name: 'Loose Sand', property_account_expense_id: false, categ_id: false }]); }, { accounts, inventory: true });
    const routes = [supabaseRpc('log_audit', (c) => { audits.push(c.bodyJson as Record<string, unknown>); return new Response(null, { status: 204 }); }), ...h.routes];
    const pass = () => withFetchMock(routes, () => runLedgerPass(client(), ORG, odooCall(h.fake), 1, budget(), { now: NOW }));
    await pass(); await pass(); await pass();
    assertEquals(audits.length, 1);
    h.fake.seed('product.product', [{ id: 77, name: 'Loose Sand', property_account_expense_id: false, categ_id: false }, { id: 78, name: 'Gravel', property_account_expense_id: false, categ_id: false }]);
    h.fake.seed('account.analytic.line', [issue(31), issue(32, { product_id: [78, 'Gravel'], write_date: '2026-11-14 09:00:00' })]);
    await pass();
    assertEquals(audits.map((a) => (a.p_detail as { products: string[] }).products), [['Loose Sand'], ['Loose Sand', 'Gravel']]);
  });

  it('AC-IMC-005 a caught-up stock kind is compared with Odoo and, with no project-tagged journal item, records "matches"', async () => {
    const h = harness((fake) => seedStock(fake, [issue(31)]), { accounts, inventory: true });
    const out = await withFetchMock(h.routes, () => runLedgerPass(client(), ORG, odooCall(h.fake), 1, budget(), { now: NOW }));
    assertEquals(out.stockCheck, 'matches');
    assertEquals(h.doubleMarks, [[]]);
    assertEquals(h.stockChecks.map((c) => [c.p_status, c.p_double_counts, c.p_accounts_checked]), [['matches', 0, 1]]);
  });

  // Odoo links a stock move to its valuation entry through stock.move.account_move_id and never fills account.move.line.stock_move_id (bed, 15 Nov).
  const ENTRY = [700, 'STJ/2026/11/0060 (WH/OUT/00004)'];
  const entryItem = (id: number, over: Record<string, unknown> = {}) => line(id, { move_id: ENTRY, stock_move_id: false, account_id: [501, '5100 Cost'], debit: 240, analytic_distribution: false, ...over });
  const stockPass = (h: ReturnType<typeof harness>, call = odooCall(h.fake)) => withFetchMock(h.routes, () => runLedgerPass(client(), ORG, call, 1, budget(), { now: NOW }));

  it('AC-IMC-005 the stock entry the move names, with an item tagged to the project, is flagged, not counted, and the check says "differs"', async () => {
    const h = harness((fake) => { seedStock(fake, [issue(31)], ENTRY); fake.seed('account.move.line', [entryItem(40, { analytic_distribution: { '101': 100 } }), entryItem(41)]); }, { accounts, inventory: true });
    const out = await stockPass(h);
    assertEquals(h.doubleMarks, [[31]]);
    assertEquals([out.stockCheck, h.stockChecks[0].p_double_counts], ['differs', 1]);
  });

  it('AC-IMC-005 an entry item tagged to ANOTHER project is not silent: the check says "differs" and counts it, but excludes nothing (each side is Odoo\'s own attribution)', async () => {
    const h = harness((fake) => { seedStock(fake, [issue(31)], ENTRY); fake.seed('account.move.line', [entryItem(40, { analytic_distribution: { '999': 100 } }), entryItem(41)]); }, { accounts, inventory: true });
    const out = await stockPass(h);
    assertEquals([out.stockCheck, h.doubleMarks, h.stockChecks[0].p_status, h.stockChecks[0].p_double_counts], ['differs', [[]], 'differs', 1]);
  });

  it('AC-IMC-005 an entry with no analytic tag on any item flags nothing and the check says "matches"', async () => {
    const h = harness((fake) => { seedStock(fake, [issue(31)], ENTRY); fake.seed('account.move.line', [entryItem(40), entryItem(41)]); }, { accounts, inventory: true });
    const out = await stockPass(h);
    assertEquals([out.stockCheck, h.doubleMarks], ['matches', [[]]]);
  });

  it('AC-IMC-005 an item that only the dead stock_move_id relation points at is not read: the entry the move names decides', async () => {
    const h = harness((fake) => { seedStock(fake, [issue(31)], ENTRY); fake.seed('account.move.line', [line(40, { move_id: [999, 'OTHER'], stock_move_id: [11, 'move'], analytic_distribution: { '101': 100 } })]); }, { accounts, inventory: true });
    const out = await stockPass(h);
    assertEquals([out.stockCheck, h.doubleMarks], ['matches', [[]]]);
  });

  it('AC-IMC-005 a move with no valuation entry (periodic) has nothing to find and the check says "matches"', async () => {
    const h = harness((fake) => seedStock(fake, [issue(31)]), { accounts, inventory: true });
    assertEquals((await stockPass(h)).stockCheck, 'matches');
  });

  it('AC-IMC-005 a journal read that fails is "not checked", never "matches", and marks nothing', async () => {
    const h = harness((fake) => { seedStock(fake, [issue(31)], ENTRY); fake.seed('account.move.line', [entryItem(40, { analytic_distribution: { '101': 100 } })]); }, { accounts, inventory: true });
    const base = h.fake.fetch;
    const failing = bindCall({ baseUrl: 'https://odoo.example.test', apiKey: 'k', database: 'db1',
      fetchImpl: ((input: Parameters<typeof fetch>[0], init?: RequestInit) => String(input).includes('/account.move.line/search_read') && String(init?.body).includes('["move_id","in"')
        ? Promise.resolve(new Response('{}', { status: 500 })) : base(input, init)) as typeof fetch });
    const out = await stockPass(h, failing);
    assertEquals([out.stockCheck, h.doubleMarks], ['not-checked', []]);
  });

  for (const [name, move, items] of [
    ['a stock move whose valuation entry is not an id', 'oops', []],
    ['a journal item whose analytic distribution is not an object', ENTRY, [entryItem(40, { analytic_distribution: 'oops' })]],
    ['a journal item whose entry link is not an id', ENTRY, [entryItem(40, { move_id: 700, analytic_distribution: { '101': 100 } })]],
  ] as const) {
    it(`AC-IMC-005 ${name} is "not checked", never "matches"`, async () => {
      const h = harness((fake) => { seedStock(fake, [issue(31)], move); fake.seed('account.move.line', [...items]); }, { accounts, inventory: true });
      const out = await stockPass(h);
      assertEquals(out.stockCheck, 'not-checked');
      assertEquals(h.doubleMarks, []);
    });
  }

  // Review round (#2282): the check covers every counted row, whatever its PMO tie.
  for (const tie of ['no-document', 'pending', 'ambiguous'] as const) {
    it(`AC-IMC-005 a ${tie} row whose entry item is tagged to the same project is flagged and the check says "differs", never "matches"`, async () => {
      const h = harness((fake) => { seedStock(fake, [issue(31)], ENTRY); fake.seed('account.move.line', [entryItem(40, { analytic_distribution: { '101': 100 } })]); }, { accounts, inventory: true, stockTie: tie });
      const out = await stockPass(h);
      assertEquals(h.doubleMarks, [[31]]);
      assertEquals([out.stockCheck, h.stockChecks[0].p_double_counts], ['differs', 1]);
    });
  }

  it('AC-IMC-005 a counted row whose picking cannot be found cannot be checked: "not checked" with its own reason, never "matches"', async () => {
    const h = harness((fake) => { seedStock(fake, [issue(31, { name: 'WH/OUT/GONE' })]); }, { accounts, inventory: true, stockTie: 'no-document' });
    const out = await stockPass(h);
    assertEquals([out.stockCheck, h.stockChecks[0].p_status, h.stockChecks[0].p_reason, h.doubleMarks], ['not-checked', 'not-checked', 'double-count-unresolved-picking', [[]]]);
  });

  // Review round (#2282): rows applied in a pass that does not finish are published, and no check says "matches" over a stale snapshot.
  const twoIssues = (fake: FakeOdoo) => seedStock(fake, [issue(31), issue(32)]);
  const stockRowsOf = (snapshot: Array<Record<string, unknown>>) => snapshot.filter((r) => r.source_report === 'Odoo stock issue').map((r) => [r.project_id, r.account, r.net]);

  it('AC-IMC-002 a later page that fails does not strand the rows an earlier page applied: the pass still publishes them, and no check ran', async () => {
    const h = harness(twoIssues, { accounts, inventory: true, publishedAt: '2026-11-10T00:00:00Z', failStockApplyAt: 2 });
    await h.primeLinkFingerprint('2026-11-09T00:00:00Z');
    const out = await withFetchMock(h.routes, () => runLedgerPass(client(), ORG, odooCall(h.fake), 1, budget(), { pageSize: 1, now: NOW }));
    assertEquals([out.stockFailed, out.stockCheck, h.stockChecks.length], [true, undefined, 0]);
    assertEquals(h.snapshots.length, 1);
    assertEquals(stockRowsOf(h.snapshots[0]), [[P1, '5200', 240]]);
  });

  it('AC-IMC-002 a publish that fails after the rows were applied is retried by the next pass, which has nothing new to apply, and only then is the check recorded', async () => {
    const h = harness(twoIssues, { accounts, inventory: true, publishedAt: '2026-11-10T00:00:00Z', failSnapshotOnce: true });
    await h.primeLinkFingerprint('2026-11-09T00:00:00Z');
    await assertRejects(() => withFetchMock(h.routes, () => runLedgerPass(client(), ORG, odooCall(h.fake), 1, budget(), { now: NOW })));
    assertEquals([h.snapshots.length, h.stockChecks.length], [0, 0]);
    const out = await withFetchMock(h.routes, () => runLedgerPass(client(), ORG, odooCall(h.fake), 1, budget(), { now: NOW }));
    assertEquals(h.snapshots.length, 1);
    assertEquals(stockRowsOf(h.snapshots[0]), [[P1, '5200', 480]]);
    assertEquals([out.stockCheck, h.stockChecks.length], ['matches', 1]);
  });

  it('AC-IMC-005 the hourly comparison starts at the inventory ownership day, as the feed does: an issue posted before it cannot keep the check at "differs"', async () => {
    const h = harness((fake) => seedStock(fake, [issue(31), issue(32, { date: '2026-02-10' })]), { accounts, inventory: true, inventoryCreatedAt: '2026-03-01T00:00:00Z' });
    const out = await stockPass(h);
    assertEquals(h.stockStore.size, 1);
    assertEquals([out.stockCheck, h.stockChecks[0].p_status], ['matches', 'matches']);
  });

  it('AC-IMC-005 the ownership day is read in the organisation\'s time zone, as the database function does', async () => {
    // 2026-02-28 20:00 UTC is already 1 March in Jakarta: the issue dated 28 February is before the start there.
    const h = harness((fake) => seedStock(fake, [issue(31), issue(32, { date: '2026-02-28' })]), { accounts, inventory: true, inventoryCreatedAt: '2026-02-28T20:00:00Z', timezone: 'Asia/Jakarta' });
    assertEquals((await stockPass(h)).stockCheck, 'matches');
  });

  it('AC-IMC-002 linking a project after its issues were stored republishes, though no line changed and the project has no ledger lines', async () => {
    const h = harness((fake) => seedStock(fake, [issue(31)]), { accounts, inventory: true, publishedAt: '2026-11-10T00:00:00Z', links: { [P1]: '999' } });
    await h.primeLinkFingerprint('2026-11-09T00:00:00Z');
    await stockPass(h);
    assertEquals(h.snapshots.length, 1);
    assertEquals(stockRowsOf(h.snapshots[0]).filter(([project]) => project === P1), []);
    h.relink({ [P1]: '101' });
    await stockPass(h);
    assertEquals(h.snapshots.length, 2);
    assertEquals(stockRowsOf(h.snapshots[1]), [[P1, '5200', 240]]);
  });

  it('AC-IMC-005 a marking that changed rows is remembered when recording the check fails: the next pass publishes it first, and the check does not say "matches"', async () => {
    const h = harness((fake) => { seedStock(fake, [issue(31)], ENTRY); fake.seed('account.move.line', [entryItem(40, { analytic_distribution: { '101': 100 } })]); },
      { accounts, inventory: true, publishedAt: '2026-11-10T00:00:00Z', failStockRecordOnce: true });
    await h.primeLinkFingerprint('2026-11-09T00:00:00Z');
    const first = await stockPass(h);
    assertEquals([first.stockCheck, h.stockChecks.length, h.doubleMarks], [undefined, 0, [[31]]]);
    assertEquals(h.otherMarks.has('ledger-stock-unpublished:odoo'), true);
    // The row is flagged in the table, so the next pass leaves it out of the snapshot before it checks.
    const second = await stockPass(h);
    assertEquals(stockRowsOf(h.snapshots[h.snapshots.length - 1]), []);
    assertEquals([second.stockCheck, h.stockChecks[0].p_double_counts], ['differs', 1]);
    assertEquals(h.otherMarks.has('ledger-stock-unpublished:odoo'), false);
  });

  it('AC-IMC-004 a stock kind failure never fails the GL pass', async () => {
    const h = harness((fake) => { fake.seed('account.move.line', [line(1)]); seedStock(fake, [issue(31)]); }, { accounts, inventory: true });
    const routes = h.routes.filter((r) => !String(r.label ?? '').includes('apply_odoo_stock_cost_page'));
    routes.unshift(supabaseRpc('apply_odoo_stock_cost_page', () => jsonResponse({ code: 'P0001', message: 'OSC_COMPANY' }, { status: 400 })));
    const out = await withFetchMock(routes, () => runLedgerPass(client(), ORG, odooCall(h.fake), 1, budget(), { now: NOW }));
    assertEquals([out.rows, out.caughtUp, out.stockFailed], [1, true, true]);
  });
});
