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
interface Opts { links?: Record<string, string>; accounts?: Record<string, string>; binding?: Record<string, unknown>; fiscal?: { month: string; day: number }; failApplyAt?: number; switched?: boolean; links2?: Record<string, string> }

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
  let rewinds = 0;
  const applies: Page[] = [];
  const snapshots: Array<Record<string, unknown>[]> = [];
  const mirror = new Map<string, PageRow>();
  const census = { seen: [] as string[][], finish: [] as Array<{ expected: number | null }> };
  const yearEnds: Array<{ p_org_id: string; p_month: number; p_day: number }> = [];
  let links = o.links ?? { [P1]: '101', [P2]: '102', [P3]: '102' };
  const accounts = { ...(o.accounts ?? { '501': '5100' }) } as Record<string, string>;
  const routes: MockRoute[] = [
    supabaseSelect('external_org_bindings', () => jsonResponse([{ status: 'active', activated_at: '2026-11-01T00:00:00Z', config: { capabilities: { later: { 'account.move.line': true } }, ...(o.switched === false ? {} : { ledger_basis_at: '2026-11-05T00:00:00Z' }) }, ...o.binding }])),
    supabaseSelect('external_sync_watermarks', (c) => {
      const value = c.url.searchParams.get('domain') === 'eq.ledger-links:odoo' ? fingerprint : cursor;
      return jsonResponse(value === undefined ? [] : [{ watermark_cursor: value }]);
    }),
    { label: 'watermark-rewind', method: 'DELETE', pathname: '/rest/v1/external_sync_watermarks', response: () => { cursor = undefined; rewinds++; return new Response(null, { status: 204 }); } },
    { label: 'watermark-fingerprint', method: 'POST', pathname: '/rest/v1/external_sync_watermarks', response: (c) => { fingerprint = (c.bodyJson as { watermark_cursor: string }).watermark_cursor; return new Response(null, { status: 201 }); } },
    supabaseSelect('external_project_bindings', (c) => jsonResponse(c.url.searchParams.get('id') ? [] : Object.entries(links).map(([project_id, external_container_id], i) => ({ id: `b${i}`, project_id, external_container_id })))),
    supabaseSelect('external_master_records', (c) => jsonResponse(c.url.searchParams.get('id') ? [] : Object.entries(accounts).map(([external_id, code]) => ({ id: `m${external_id}`, external_id, code })))),
    supabaseSelect('erp_gl_entry_mirror', (c) => {
      const after = (c.url.searchParams.get('id') ?? '').replace(/^gt\./, '');
      const rows = [...mirror.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).filter(([id]) => !after || id > after).slice(0, 1000)
        .map(([id, r]) => ({ id, project: r.project, cost_center: null, account: r.account, fiscal_year: r.fiscal_year, debit: r.debit, credit: r.credit }));
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
    supabaseRpc('replace_erp_snapshot', (c) => { snapshots.push((c.bodyJson as { p_rows: Record<string, unknown>[] }).p_rows); return jsonResponse(null); }),
  ];
  return { fake, routes, applies, snapshots, census, mirror, yearEnds, getCursor: () => cursor, addAccount: (id: string, code: string) => { accounts[id] = code; }, relink: (l: Record<string, string>) => { links = l; }, rewinds: () => rewinds };
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
