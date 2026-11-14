/**
 * #1504 S8-T3 — the Odoo send drain (`_shared/odooConnectSends.ts`; tested in `_shared`, its first consumer). Supabase is mocked over
 * fetch with a stateful outbox; Odoo is the in-memory JSON-2 fake behind the real client, so lookups and creates behave.
 */
import { afterAll, describe, it } from '@std/testing/bdd';
import { assert, assertEquals } from '@std/assert';
import { createClient } from '@supabase/supabase-js';
import { CONNECT_SENDS_PER_TICK } from './connectSendsCore.ts';
import { drainOdooConnectSends, ODOO_CALLS_PER_SEND } from './odooConnectSends.ts';
import { installEdgeEnv, jsonResponse, rpcCall, supabaseRpc, supabaseSelect, withFetchMock, type FetchCall, type MockRoute } from './testing/edgeTestKit.ts';
import { createFakeOdoo, type FakeOdoo } from '../../../pmo-portal/src/lib/adapterSeam/odoo/fakeOdoo.ts';

const env = installEdgeEnv();
const realSetTimeout = globalThis.setTimeout;
globalThis.setTimeout = ((fn: () => void) => { queueMicrotask(fn); return 0; }) as unknown as typeof setTimeout;
afterAll(() => { env.restore(); globalThis.setTimeout = realSetTimeout; });

const ORG = '0d000000-0000-4000-8000-000000000008';
const ODOO = 'odoo.example.test';
const KEY = 'stored-odoo-key';
const org = { orgId: ORG, bindingId: 'binding-a' };
const one = (body: unknown) => jsonResponse(body, { headers: { 'content-type': 'application/vnd.pgrst.object+json' } });
const none = () => new Response('null', { status: 200, headers: { 'content-type': 'application/json' } });
const body = (c: FetchCall) => c.bodyJson as Record<string, unknown>;
const prop = (id: string, kind: string, pmo: string, decidedBy: string | null = 'admin-1') => ({ id, kind, pmo_ids: [pmo], decided_by: decidedBy, snapshot: {} });
const binding = (config: Record<string, unknown> = {}, over: Record<string, unknown> = {}) => ({
  id: 'binding-a', site_url: `https://${ODOO}`, secret_ref: 'odoo_ref', status: 'active', activated_at: '2026-11-01T00:00:00Z',
  config: { database: 'db1', odoo_company_id: 1, analytic_plan_id: 7, unit_map: {}, ...config }, ...over,
});

interface State { fake: FakeOdoo; outbox: Array<Record<string, unknown>>; loseNextCreate?: boolean }
interface Opts { binding?: Record<string, unknown>; companies?: Record<string, Record<string, unknown>>; reject?: string; revoked?: boolean; mirrorFails?: boolean; projectNumber?: string | null; clientCode?: string | null; actorGone?: boolean; failureEnds?: boolean; claimed: unknown[] }
const newState = (): State => ({ fake: createFakeOdoo({ key: KEY }), outbox: [] });

async function tick(st: State, o: Opts) {
  const f = (c: FetchCall, k: string) => c.url.searchParams.get(k)?.replace(/^eq\./, '');
  const routes: MockRoute[] = [
    supabaseSelect('external_org_bindings', () => jsonResponse([o.binding ?? binding()])),
    supabaseRpc('read_vault_secret', () => jsonResponse(KEY)),
    supabaseRpc('enqueue_new_item_sends', () => jsonResponse(0)),
    supabaseRpc('claim_connect_sends', () => jsonResponse(o.claimed)),
    supabaseRpc('connect_send_existing_link', () => jsonResponse(null)),
    supabaseSelect('companies', (c) => one(o.companies?.[f(c, 'id')!] ?? { id: f(c, 'id'), name: 'PT Sinar Baja', type: 'Vendor', erp_tax_id: '01.234' })),
    // PostgREST answers only the selected columns: the client code and the PMO project number differ, so a read of the wrong one shows
    supabaseSelect('projects', (c) => {
      const row: Record<string, unknown> = {
        id: f(c, 'id'), name: 'Jembatan', code: o.clientCode === undefined ? 'CLIENT-9' : o.clientCode,
        pmo_project_number: o.projectNumber === undefined ? 'PRJ-26-0007' : o.projectNumber,
      };
      const cols = (c.url.searchParams.get('select') ?? '').split(',').map((x) => x.trim());
      return one(Object.fromEntries(Object.entries(row).filter(([k]) => cols.includes(k))));
    }),
    supabaseSelect('procurement_items', () => jsonResponse([{ id: 'i-1' }])),
    supabaseSelect('profiles', () => (o.actorGone ? none() : one({ id: 'admin-1' }))),
    supabaseSelect('external_sync_watermarks', () => none()),
    supabaseRpc('apply_odoo_master_page', () => (o.mirrorFails ? jsonResponse({ code: 'XX000', message: 'x' }, { status: 500 }) : jsonResponse(1))),
    supabaseRpc('record_connect_send_result', () => jsonResponse(null)),
    supabaseRpc('record_connect_send_held', () => jsonResponse(null)),
    supabaseRpc('record_connect_send_failure', () => jsonResponse(o.failureEnds === true)),
    supabaseSelect('external_command_outbox', (c) => {
      const row = st.outbox.find((x) => x.domain === f(c, 'domain') && x.pmo_record_id === f(c, 'pmo_record_id') && x.idempotency_key === f(c, 'idempotency_key'));
      return row ? one(row) : none();
    }),
    { label: 'outbox-insert', method: 'POST', pathname: '/rest/v1/external_command_outbox', response: (c: FetchCall) => {
      const b = body(c);
      const row = { id: `ob-${st.outbox.length + 1}`, domain: b.domain, pmo_record_id: b.pmo_record_id, idempotency_key: b.idempotency_key, state: 'pending', external_record_id: null, canonical: null, claim_generation: 0, payload_digest: null };
      st.outbox.push(row);
      return one(row);
    } },
    { label: 'outbox-update', method: 'PATCH', pathname: '/rest/v1/external_command_outbox', response: (c: FetchCall) => {
      const row = st.outbox.find((x) => x.id === f(c, 'id'))!;
      Object.assign(row, c.bodyJson);
      return jsonResponse([{ id: row.id }]);
    } },
    supabaseRpc('claim_outbox_for_commit', (c) => {
      const row = st.outbox.find((x) => x.id === body(c).p_id)!;
      Object.assign(row, { state: 'committing', claim_generation: Number(row.claim_generation) + 1 });
      return jsonResponse(row);
    }),
    supabaseRpc('quarantine_committing', (c) => {
      const row = st.outbox.find((x) => x.id === body(c).p_id)!;
      if (row.state === 'committing') row.state = 'quarantined';
      return jsonResponse(row);
    }),
    supabaseRpc('record_outbox_ref', () => jsonResponse(1)),
    supabaseRpc('confirm_outbox', (c) => { st.outbox.find((x) => x.id === body(c).p_id)!.state = 'confirmed'; return jsonResponse(1); }),
    supabaseRpc('mark_outbox_held', (c) => { st.outbox.find((x) => x.id === body(c).p_id)!.state = 'held'; return jsonResponse(1); }),
    { label: 'odoo-json2', host: ODOO, pathname: /^\/json\/2\//, response: async (c: FetchCall) => {
      if (o.revoked) return Response.json({ name: 'odoo.exceptions.AccessDenied', message: 'x' }, { status: 401 });
      if (o.reject && c.url.pathname.endsWith('/create')) return Response.json({ name: 'odoo.exceptions.ValidationError', message: o.reject }, { status: 422 });
      const answer = st.fake.fetch(c.url.toString(), { method: 'POST', headers: { Authorization: `bearer ${KEY}` }, body: c.bodyText });
      if (st.loseNextCreate && c.url.pathname.endsWith('/create')) { st.loseNextCreate = false; await answer; throw new TypeError('error sending request: connection reset'); }   // Odoo stored it; the answer never arrived
      return answer;
    } },
  ];
  const sc = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  let odooCalls = -1;
  return await withFetchMock(routes, async ({ calls }) => {
    const result = await drainOdooConnectSends(sc, org, { onCalls: (n) => { odooCalls = n; } });
    return { result, calls, odooCalls };
  });
}
const results = (calls: FetchCall[]) => rpcCall(calls, 'record_connect_send_result').map(body);
const partners = (st: State) => st.fake.rows('res.partner');

describe('S8-T3 drainOdooConnectSends', () => {
  it('AC-ECA-010 three accepted vendors become three partners, each recorded as Vendor:<id> under seed:party:<pmo id>', async () => {
    const st = newState();
    const claimed = ['c-1', 'c-2', 'c-3'].map((id) => prop(`prop-${id}`, 'party', id));
    const { result, calls, odooCalls } = await tick(st, { claimed });
    assertEquals(partners(st).map((p) => p.ref), ['pmo:c-1', 'pmo:c-2', 'pmo:c-3']);
    assertEquals(results(calls).map((r) => [r.p_id, r.p_external_id, r.p_rejection ?? null]),
      partners(st).map((p, i) => [`prop-c-${i + 1}`, `Vendor:${p.id}`, null]));
    assertEquals(st.outbox.map((r) => [r.domain, r.idempotency_key, r.state]), ['c-1', 'c-2', 'c-3'].map((id) => ['companies', `seed:party:${id}`, 'confirmed']));
    assertEquals(result, { sent: 3, rejected: 0, held: 0, pending: 0 });
    assertEquals(odooCalls, 9);   // per party: the outbox's probe, sendMaster's own lookup, the create
    assert(odooCalls <= 3 * ODOO_CALLS_PER_SEND);
  });

  it('AC-ECA-011 a create whose answer is lost, then a second tick: one partner, the result recorded once', async () => {
    const st = newState();
    const claimed = [prop('prop-1', 'party', 'c-1')];
    st.loseNextCreate = true;
    const first = await tick(st, { claimed });
    assertEquals(first.result.pending, 1);
    assertEquals(results(first.calls).length, 0);
    const second = await tick(st, { claimed });
    assertEquals(partners(st).length, 1);
    assertEquals(results(second.calls).map((r) => r.p_external_id), [`Vendor:${partners(st)[0].id}`]);
    assertEquals(second.result.sent, 1);
  });

  it('a partner whose anchor was edited in Odoo is held for a person, never created again (no reissue, Odoo has no unique anchor)', async () => {
    const st = newState();
    const claimed = [prop('prop-1', 'party', 'c-1')];
    st.loseNextCreate = true;
    await tick(st, { claimed });
    partners(st)[0].ref = 'edited by hand';
    const second = await tick(st, { claimed });
    assertEquals(partners(st).length, 1);
    assertEquals(second.result, { sent: 0, rejected: 0, held: 1, pending: 0 });
    assertEquals(rpcCall(second.calls, 'record_connect_send_held').map(body), [{ p_org_id: ORG, p_id: 'prop-1' }]);
    assertEquals(st.outbox[0].state, 'held');
  });

  it('AC-ECA-012 two partners with the anchor are a rejection that says so; the others in the batch still go', async () => {
    const st = newState();
    st.fake.seed('res.partner', [{ id: 50, name: 'a', ref: 'pmo:c-1', parent_id: false }, { id: 51, name: 'b', ref: 'pmo:c-1', parent_id: false }]);
    const { result, calls } = await tick(st, { claimed: [prop('prop-1', 'party', 'c-1'), prop('prop-2', 'party', 'c-2')] });
    assertEquals(results(calls).map((r) => [r.p_id, r.p_rejection ?? null]), [['prop-1', 'Two ERP records match this company. Link the right one by hand.'], ['prop-2', null]]);
    assertEquals(result.rejected, 1);
    assertEquals(result.sent, 1);
  });

  it('a validation refusal is words that name the kind; Odoo\'s own text never reaches the stored rejection', async () => {
    const st = newState();
    const SENTINEL = 'SENTINEL-upstream-body-4417';
    const { result, calls } = await tick(st, { claimed: [prop('prop-1', 'party', 'c-1')], reject: SENTINEL });
    const text = String(results(calls)[0].p_rejection);
    assert(/refused this company/.test(text), text);
    assert(!text.includes(SENTINEL) && !JSON.stringify(calls.map((c) => c.bodyText)).includes('record_connect_send_result' + SENTINEL), text);
    assertEquals(result.rejected, 1);
  });

  it('a revoked key is the connection\'s fault: the sends wait, none is rejected as a decision about its record', async () => {
    const st = newState();
    const { result, calls } = await tick(st, { claimed: [prop('a', 'party', 'c-1'), prop('b', 'party', 'c-2')], revoked: true });
    assertEquals(result, { sent: 0, rejected: 0, held: 0, pending: 2 });
    assertEquals(results(calls).length, 0);
  });

  it('a person is never sent', async () => {
    const st = newState();
    const { result, calls } = await tick(st, { claimed: [prop('prop-e', 'employee', 'u-1')] });
    assert(/person/.test(String(results(calls)[0].p_rejection)));
    assertEquals([st.fake.calls.length, result.rejected], [0, 1]);
  });

  it('a project while no cost-account plan is chosen is rejected in plain words, with no create', async () => {
    const st = newState();
    const { result, calls } = await tick(st, { claimed: [prop('prop-p', 'project', 'p-1')], binding: binding({ analytic_plan_id: null }) });
    assert(/Choose the cost-account plan/.test(String(results(calls)[0].p_rejection)));
    assertEquals([st.fake.rows('account.analytic.account').length, st.outbox.length, result.rejected], [0, 0, 1]);
  });

  it('with the plan chosen a project becomes one cost account in that plan, recorded by its id', async () => {
    const st = newState();
    const { calls } = await tick(st, { claimed: [prop('prop-p', 'project', 'p-1')] });
    const acct = st.fake.rows('account.analytic.account');
    assertEquals(acct.length, 1);
    // AC-ODC-052 / FR-ODC-072: the account carries the PMO project number (what the matcher compares), never the client project code
    assertEquals([acct[0].code, acct[0].name], ['PRJ-26-0007', 'PRJ-26-0007 Jembatan']);
    assertEquals(results(calls).map((r) => r.p_external_id), [String(acct[0].id)]);
  });

  it('AC-ODC-052 a project without a project number is rejected in plain words: no cost account, no "null" anywhere', async () => {
    for (const projectNumber of [null, '  ']) {
      const st = newState();
      const { result, calls } = await tick(st, { claimed: [prop('prop-p', 'project', 'p-1')], projectNumber });
      assert(/project number/.test(String(results(calls)[0].p_rejection)), String(results(calls)[0].p_rejection));
      assertEquals([st.fake.rows('account.analytic.account').length, st.outbox.length, result.rejected], [0, 0, 1]);
    }
  });

  it('AC-ODC-052 a project whose client code is empty still sends: the account is named by the PMO project number, never "null <name>"', async () => {
    for (const clientCode of [null, '']) {
      const st = newState();
      const { calls } = await tick(st, { claimed: [prop('prop-p', 'project', 'p-1')], clientCode });
      const acct = st.fake.rows('account.analytic.account');
      assertEquals([acct.length, acct[0].code, acct[0].name], [1, 'PRJ-26-0007', 'PRJ-26-0007 Jembatan']);
      assertEquals(results(calls).map((r) => [r.p_external_id, r.p_rejection ?? null]), [[String(acct[0].id), null]]);
    }
  });

  it('AC-ODC-052 an account already carrying the project number is found and linked, never duplicated (reconnect/retry)', async () => {
    const st = newState();
    st.fake.seed('account.analytic.account', [{ id: 71, name: 'PRJ-26-0007 Jembatan', code: 'PRJ-26-0007', plan_id: [7, 'P'], company_id: [1, 'C'] }]);
    const { result, calls } = await tick(st, { claimed: [prop('prop-p', 'project', 'p-1')] });
    assertEquals(st.fake.rows('account.analytic.account').length, 1);
    assertEquals([result.sent, result.rejected], [1, 0]);
    assertEquals(results(calls).map((r) => [r.p_external_id, r.p_rejection ?? null]), [['71', null]]);
  });

  it('a sent project\'s cost account is mirrored before the link is recorded, and the directory cursor is passed back unchanged', async () => {
    const st = newState();
    const { calls } = await tick(st, { claimed: [prop('prop-p', 'project', 'p-1')] });
    const names = calls.filter((c) => c.url.pathname.startsWith('/rest/v1/rpc/')).map((c) => c.url.pathname.split('/').pop());
    assert(names.indexOf('apply_odoo_master_page') >= 0 && names.indexOf('apply_odoo_master_page') < names.indexOf('record_connect_send_result'), names.join());
    const page = body(rpcCall(calls, 'apply_odoo_master_page')[0]);
    assertEquals([page.p_org_id, page.p_kind, page.p_cursor], [ORG, 'analytic_account', '']);
    assertEquals((page.p_rows as Array<Record<string, unknown>>).map((r) => [r.external_id, r.code, r.parent_external_id]), [[String(st.fake.rows('account.analytic.account')[0].id), 'PRJ-26-0007', '7']]);
  });

  it('a mirror write that fails leaves the project send waiting: nothing is recorded, and a later look does not create a second account', async () => {
    const st = newState();
    const claimed = [prop('prop-p', 'project', 'p-1')];
    const first = await tick(st, { claimed, mirrorFails: true });
    assertEquals([first.result.pending, results(first.calls).length, st.fake.rows('account.analytic.account').length], [1, 0, 1]);
    assertEquals(rpcCall(first.calls, 'record_connect_send_failure').length, 1);   // M1: the failed mirror counts toward the five-strike rule
    const second = await tick(st, { claimed });
    assertEquals([second.result.sent, st.fake.rows('account.analytic.account').length], [1, 1]);
  });

  it('M1 a mirror that keeps failing ends as a review row once the database says the strikes are spent', async () => {
    const { result, calls } = await tick(newState(), { claimed: [prop('prop-p', 'project', 'p-1')], mirrorFails: true, failureEnds: true });
    assertEquals([result.rejected, result.pending, rpcCall(calls, 'record_connect_send_failure').length], [1, 0, 1]);
  });

  it('M2 a send accepted by an Admin who is no longer one is not sent to Odoo', async () => {
    const st = newState();
    const { result, calls } = await tick(st, { claimed: [prop('prop-party', 'party', 'c-1')], actorGone: true });
    assertEquals(partners(st).length, 0);
    assert(/no longer an Admin/.test(String(results(calls)[0].p_rejection)));
    assertEquals(result.rejected, 1);
  });

  it('an unreachable Odoo connection leaves every row sending: pending counted, no result recorded', async () => {
    const st = newState();
    const { result, calls } = await tick(st, { claimed: [prop('a', 'party', 'c-1'), prop('b', 'party', 'c-2')], binding: binding({}, { status: 'disabled' }) });
    assertEquals(result.pending, 2);
    assertEquals(results(calls).length + rpcCall(calls, 'record_connect_send_held').length, 0);
    assertEquals(st.fake.calls.length, 0);
  });

  it('NFR-ECA-003 every claim and record names this org and no other', async () => {
    const st = newState();
    const { calls } = await tick(st, { claimed: [prop('a', 'party', 'c-1')] });
    assertEquals(body(rpcCall(calls, 'claim_connect_sends')[0]), { p_org_id: ORG, p_tier: 'odoo', p_limit: CONNECT_SENDS_PER_TICK });
    for (const c of rpcCall(calls, 'record_connect_send_result')) assertEquals(body(c).p_org_id, ORG);
  });
});
