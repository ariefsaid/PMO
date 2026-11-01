/**
 * ECA3-T7 — the sweep pass that sends PMO masters waiting in `sending` (#1606, FR-ECA-020..022, NFR-ECA-004). Real module; Supabase
 * (with a stateful outbox) and the ERP are mocked over fetch. The ERP is the seam's in-memory fake, so lookups and creates behave.
 */
import { afterAll, describe, it } from '@std/testing/bdd';
import { assert, assertEquals } from '@std/assert';
import { createClient } from '@supabase/supabase-js';
import { CONNECT_SENDS_PER_TICK, drainConnectSends } from './connectSends.ts';
import {
  installEdgeEnv, jsonResponse, rpcCall, supabaseRpc, supabaseSelect, withFetchMock, type FetchCall, type MockRoute,
} from '../_shared/testing/edgeTestKit.ts';
import { fakeErp } from '../../../pmo-portal/src/lib/adapterSeam/erpnext/fakeErp.ts';

// importing the sweep entry point would start its HTTP server; the other sweep suites stub the serve call the same way
(Deno as unknown as { serve: (...a: unknown[]) => unknown }).serve = () => ({ finished: Promise.resolve() });
const { runErpSweepCycle, reconcileOrgOutbox } = await import('./index.ts');
const env = installEdgeEnv();
afterAll(() => env.restore());

const ORG = 'org-a';
const OTHER_ORG = 'org-b';
const ERP = 'erp.example.com';
const IN_FLIGHT_INDEX = 'external_command_outbox_one_inflight_per_record';
const one = (body: unknown) => jsonResponse(body, { headers: { 'content-type': 'application/vnd.pgrst.object+json' } });
const none = () => new Response('null', { status: 200, headers: { 'content-type': 'application/json' } });
const org = { orgId: ORG, bindingId: 'binding-a' };

interface Proposal { id: string; kind: string; pmo_ids: string[]; decided_by?: string | null; snapshot?: Record<string, unknown> }
const P = {
  party: { id: 'prop-party', kind: 'party', pmo_ids: ['c-1'], decided_by: 'admin-1' },
  project: { id: 'prop-project', kind: 'project', pmo_ids: ['p-1'], decided_by: 'admin-1' },
  item: { id: 'prop-item', kind: 'item', pmo_ids: ['Semen 50 kg'], decided_by: 'admin-1' },
  employee: { id: 'prop-emp', kind: 'employee', pmo_ids: ['u-1'], decided_by: 'admin-1' },
  /** ECA3-T12: queued by the sweep itself after setup, so no person decided it. */
  newItem: { id: 'prop-new', kind: 'item', pmo_ids: ['Kabel 10 mm'], decided_by: null, snapshot: { auto: true } },
} satisfies Record<string, Proposal>;

interface Opts {
  claimed?: Proposal[];
  tables?: Record<string, Array<Record<string, unknown>>>;
  /** The next create of this doctype is refused / its answer lost / never reaches the ERP. */
  fault?: Record<string, 'reject' | 'lost-response' | 'transport'>;
  inFlight?: boolean;
  noCompany?: boolean;
  archivedProject?: boolean;
  itemOnOpenPurchase?: boolean;
  /** Outbox rows that exist before the tick (an earlier attempt that left the create undecided). */
  outbox?: Array<Record<string, unknown>>;
  /** C1: ERP ids the records are already linked to, by PMO id. */
  linked?: Record<string, string>;
  /** I1: the result write for this proposal fails with this database error code. */
  resultError?: Record<string, string>;
  /** I1: what `record_connect_send_failure` answers (true: this was the fifth, the send ended). */
  failureEnds?: boolean;
  /** M7: the accepting Admin no longer holds the role. */
  actorGone?: boolean;
  /** I3: every ERP read answers with a server error. */
  erpDown?: boolean;
  /** ECA3-T12: the tick's queueing call fails with this database error code. */
  enqueueError?: string;
}

function routes(o: Opts) {
  const tables = o.tables ?? {};
  const erp = fakeErp(tables);
  const outbox: Array<Record<string, unknown>> = [...(o.outbox ?? [])];
  const f = (c: FetchCall, k: string) => c.url.searchParams.get(k)?.replace(/^eq\./, '');
  const r: MockRoute[] = [
    supabaseSelect('external_org_bindings', () => one({ site_url: `https://${ERP}`, secret_ref: 'ref', status: 'active', activated_at: '2026-11-01T00:00:00Z', config: o.noCompany ? {} : { company: 'Test Co' } })),
    supabaseRpc('read_vault_secret', () => jsonResponse('key:secret')),
    supabaseRpc('enqueue_new_item_sends', () => (o.enqueueError ? jsonResponse({ code: o.enqueueError, message: 'boom', details: '' }, { status: 500 }) : jsonResponse(1))),
    supabaseRpc('claim_connect_sends', () => jsonResponse((o.claimed ?? []).map((p) => ({ snapshot: {}, ...p, org_id: ORG, external_tier: 'erpnext', state: 'sending', outcome: 'send' })))),
    supabaseSelect('companies', () => one({ id: 'c-1', name: 'PT Baja', type: 'Vendor', erp_tax_id: '01.234' })),
    supabaseSelect('projects', () => (o.archivedProject ? none() : one({ id: 'p-1', name: 'Jembatan', code: 'PRJ-1' }))),
    supabaseSelect('procurement_items', () => jsonResponse(o.itemOnOpenPurchase === false ? [] : [{ id: 'i-1' }])),
    supabaseRpc('connect_send_existing_link', (c) => jsonResponse(o.linked?.[(c.bodyJson as { p_pmo: string }).p_pmo] ?? null)),
    supabaseSelect('profiles', () => (o.actorGone ? none() : one({ id: 'admin-1' }))),
    supabaseRpc('record_connect_send_failure', () => jsonResponse(o.failureEnds === true)),
    supabaseRpc('record_connect_send_result', (c) => {
      const b = c.bodyJson as { p_id: string; p_rejection: string | null };
      const code = b.p_rejection === null ? o.resultError?.[b.p_id] : undefined;   // only the link write fails; a rejection is accepted
      return code ? jsonResponse({ code, message: 'duplicate key value violates unique constraint', details: '' }, { status: 409 }) : jsonResponse(null);
    }),
    supabaseRpc('record_connect_send_held', () => jsonResponse(null)),
    supabaseSelect('external_command_outbox', (c) => {
      const row = outbox.find((x) => x.domain === f(c, 'domain') && x.pmo_record_id === f(c, 'pmo_record_id') && x.idempotency_key === f(c, 'idempotency_key'));
      return row ? one(row) : none();
    }),
    { label: 'outbox-insert', method: 'POST', pathname: '/rest/v1/external_command_outbox', response: (c: FetchCall) => {
      if (o.inFlight) return jsonResponse({ code: '23505', message: `duplicate key value violates unique constraint "${IN_FLIGHT_INDEX}"`, details: '' }, { status: 409 });
      const b = c.bodyJson as Record<string, unknown>;
      const row = { id: `ob-${outbox.length + 1}`, domain: b.domain, pmo_record_id: b.pmo_record_id, idempotency_key: b.idempotency_key, state: 'pending', external_record_id: null, canonical: null, claim_generation: 0, payload_digest: null };
      outbox.push(row);
      return one(row);
    } },
    { label: 'outbox-update', method: 'PATCH', pathname: '/rest/v1/external_command_outbox', response: (c: FetchCall) => {
      const row = outbox.find((x) => x.id === f(c, 'id'))!;
      Object.assign(row, c.bodyJson);
      return jsonResponse([{ id: row.id }]);
    } },
    supabaseRpc('claim_outbox_for_commit', (c) => {
      const row = outbox.find((x) => x.id === (c.bodyJson as { p_id: string }).p_id)!;
      Object.assign(row, { state: 'committing', claim_generation: Number(row.claim_generation) + 1 });
      return jsonResponse(row);
    }),
    // a row left committing by an earlier tick is past its lease by the time the next tick looks (the database decides; the mock says it is)
    supabaseRpc('quarantine_committing', (c) => {
      const row = outbox.find((x) => x.id === (c.bodyJson as { p_id: string }).p_id)!;
      if (row.state === 'committing') row.state = 'quarantined';
      return jsonResponse(row);
    }),
    supabaseRpc('record_outbox_ref', () => jsonResponse(1)),
    supabaseRpc('confirm_outbox', (c) => { outbox.find((x) => x.id === (c.bodyJson as { p_id: string }).p_id)!.state = 'confirmed'; return jsonResponse(1); }),
    supabaseRpc('mark_outbox_held', (c) => { outbox.find((x) => x.id === (c.bodyJson as { p_id: string }).p_id)!.state = 'held'; return jsonResponse(1); }),
    { label: 'erp', host: ERP, pathname: /^\/api\//, response: (c: FetchCall) => {
      const doctype = decodeURIComponent(c.url.pathname.split('/').pop()!);
      if (o.erpDown && c.method === 'GET') return new Response('down', { status: 503 });
      if (c.method === 'POST' && o.fault?.[doctype]) erp.arm(o.fault[doctype]);
      return erp.client.fetchImpl(c.url.toString(), { method: c.method, body: c.bodyText });
    } },
  ];
  return { routes: r, erp, outbox, tables };
}

async function tick(o: Opts = {}, binding: { orgId: string; bindingId?: string | null } = org, budget?: number, clock?: { nowMs: () => number; budgetMs: number }) {
  const sc = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const m = routes(o);
  return await withFetchMock(m.routes, async ({ calls }) => ({ result: await drainConnectSends(sc, binding, budget, clock), calls, ...m }));
}
const body = (c: FetchCall) => c.bodyJson as Record<string, unknown>;
const erpPosts = (calls: FetchCall[]) => calls.filter((c) => c.url.host === ERP && c.method === 'POST');
const results = (calls: FetchCall[]) => rpcCall(calls, 'record_connect_send_result').map(body);

describe('ECA3-T7 drainConnectSends', () => {
  it('no connection id: nothing is claimed and nothing is read', async () => {
    const { calls } = await tick({ claimed: [P.party] }, { orgId: ORG });
    assertEquals(calls.length, 0);
  });

  it('AC-ECA-010 claims this org\'s waiting sends within the tick budget, builds each master from the database row, sends it and records the result', async () => {
    const { result, calls, tables } = await tick({ claimed: [P.party, P.project, P.item] });
    const claim = body(rpcCall(calls, 'claim_connect_sends')[0]);
    assertEquals(claim, { p_org_id: ORG, p_tier: 'erpnext', p_limit: CONNECT_SENDS_PER_TICK });
    // the ERP got the PMO row's words: name and tax id from companies, name from projects, the line name for the item
    assertEquals(tables.Supplier[0].supplier_name, 'PT Baja');
    assertEquals(tables.Supplier[0].tax_id, '01.234');
    assertEquals(tables.Project[0].project_name, 'Jembatan');
    assertEquals(tables.Project[0].company, 'Test Co');
    assertEquals(tables.Item[0].item_code, 'Semen 50 kg');
    assertEquals(results(calls).map((r) => [r.p_id, r.p_external_id, r.p_rejection ?? null]),
      [['prop-party', 'Supplier:SUP-1', null], ['prop-project', 'PROJ-1', null], ['prop-item', 'Semen 50 kg', null]]);
    assertEquals(result, { sent: 3, rejected: 0, held: 0, pending: 0 });
  });

  it('FR-ECA-021 each send rides the outbox under seed:<kind>:<pmo id>, in its kind\'s domain, once', async () => {
    const { calls, outbox } = await tick({ claimed: [P.party, P.project, P.item] });
    assertEquals(outbox.map((r) => [r.domain, r.pmo_record_id, r.idempotency_key, r.state]), [
      ['companies', 'c-1', 'seed:party:c-1', 'confirmed'], ['projects', 'p-1', 'seed:project:p-1', 'confirmed'], ['items', 'Semen 50 kg', 'seed:item:Semen 50 kg', 'confirmed'],
    ]);
    const inserts = calls.filter((c) => c.method === 'POST' && c.url.pathname === '/rest/v1/external_command_outbox').map(body);
    for (const i of inserts) assertEquals([i.org_id, i.external_tier, i.operation, i.actor_user_id], [ORG, 'erpnext', 'create', 'admin-1']);
  });

  it('C1 the outbox writes no link for any kind: record_connect_send_result is the one guarded link writer', async () => {
    const { calls } = await tick({ claimed: [P.party, P.project, P.item] });
    assertEquals(rpcCall(calls, 'record_outbox_ref').length, 0);
  });

  it('C1 a record that already has its link is never sent again: no ERP call, no outbox row, its own link is the result', async () => {
    const { result, calls, outbox } = await tick({ claimed: [P.party, P.project, P.item], linked: { 'c-1': 'Supplier:ACME-OLD', 'p-1': 'PROJ-7', 'Semen 50 kg': 'ITM-1' } });
    assertEquals(results(calls).map((r) => [r.p_id, r.p_external_id, r.p_rejection ?? null]),
      [['prop-party', 'Supplier:ACME-OLD', null], ['prop-project', 'PROJ-7', null], ['prop-item', 'ITM-1', null]]);
    assertEquals(calls.filter((c) => c.url.host === ERP).length, 0);
    assertEquals(outbox.length, 0);
    assertEquals(result, { sent: 3, rejected: 0, held: 0, pending: 0 });
  });

  it('I1 a link clash from the result write ends the send as a decision in plain words, never a retry loop', async () => {
    const { result, calls } = await tick({ claimed: [P.party], resultError: { 'prop-party': '23505' } });
    const rs = results(calls);
    assertEquals(rs.length, 2);   // the failed write, then the rejection
    assertEquals(rs[1].p_external_id, null);
    assertEquals(rs[1].p_rejection, 'This record is already linked to another ERP record.');
    assertEquals(result.pending, 0);
    assertEquals(result.rejected, 1);
    assertEquals(rpcCall(calls, 'record_connect_send_failure').length, 0);
  });

  it('I1 trouble nobody can classify is counted; the send ends when the database says it was the last try', async () => {
    const trouble = { claimed: [P.party], resultError: { 'prop-party': '57014' } };
    const early = await tick(trouble);
    assertEquals(early.result, { sent: 0, rejected: 0, held: 0, pending: 1, error: early.result.error });
    assertEquals(rpcCall(early.calls, 'record_connect_send_failure').map(body), [{ p_org_id: ORG, p_id: 'prop-party' }]);
    const last = await tick({ ...trouble, failureEnds: true });
    assertEquals([last.result.rejected, last.result.pending], [1, 0]);
  });

  it('I3 a dead ERP ends the tick at the first send: one read without retry, the rest wait for a later tick', async () => {
    const { result, calls } = await tick({ claimed: [P.party, P.project, P.item], erpDown: true });
    assertEquals(calls.filter((c) => c.url.host === ERP).length, 1);
    assertEquals(result, { sent: 0, rejected: 0, held: 0, pending: 3 });
    assertEquals(results(calls).length, 0);
  });

  it('I3 the tick stops starting sends once its time is spent', async () => {
    let t = 0;
    const { result, calls } = await tick({ claimed: [P.party, P.project, P.item] }, org, undefined, { nowMs: () => (t += 100), budgetMs: 250 });
    assertEquals(result, { sent: 2, rejected: 0, held: 0, pending: 1 });
    assertEquals(results(calls).map((r) => r.p_id), ['prop-party', 'prop-project']);
  });

  it('M7 a send accepted by an Admin who is no longer one is not sent', async () => {
    const { result, calls } = await tick({ claimed: [P.party], actorGone: true });
    assertEquals(erpPosts(calls).length, 0);
    assert(/no longer an Admin/.test(String(results(calls)[0].p_rejection)));
    assertEquals(result.rejected, 1);
  });

  it('the same send is not created twice: a tick over a record the ERP already holds finds it', async () => {
    const { erp, tables } = await tick({ claimed: [P.party], tables: { Supplier: [{ name: 'SUP-9', supplier_name: 'PT Baja', tax_id: '01.234' }] } });
    assertEquals(tables.Supplier.length, 1);
    assertEquals(erp.seen.filter((r) => r.method === 'POST').length, 0);
  });

  it('AC-ECA-012 a send the ERP refuses is recorded as a rejection in plain words and the others still go', async () => {
    const { result, calls } = await tick({ claimed: [P.party, P.project, P.item], fault: { Project: 'reject' } });
    const rs = results(calls);
    assertEquals(rs.map((r) => [r.p_id, r.p_external_id ?? null]), [['prop-party', 'Supplier:SUP-1'], ['prop-project', null], ['prop-item', 'Semen 50 kg']]);
    const refused = rs[1];
    assert(typeof refused.p_rejection === 'string' && /^The ERP refused this project/.test(refused.p_rejection as string), String(refused.p_rejection));
    assertEquals(result, { sent: 2, rejected: 1, held: 0, pending: 0 });
  });

  it('a refusal never carries a host, a token or markup into the words the Admin reads', async () => {
    const { calls } = await tick({ claimed: [P.item], fault: { Item: 'reject' } });
    const text = String(results(calls)[0].p_rejection);
    assert(!text.includes(ERP) && !/[<>]/.test(text) && text.length < 300, text);
  });

  it('an unreachable ERP records nothing: the lease retries the send on a later tick', async () => {
    const { result, calls } = await tick({ claimed: [P.party], fault: { Supplier: 'transport' } });
    assertEquals(results(calls).length + rpcCall(calls, 'record_connect_send_held').length, 0);
    assertEquals(result, { sent: 0, rejected: 0, held: 0, pending: 1 });
  });

  it('a create whose answer is lost records nothing and creates nothing more on the next look', async () => {
    const { result, calls, tables } = await tick({ claimed: [P.party], fault: { Supplier: 'lost-response' } });
    assertEquals(results(calls).length, 0);
    assertEquals(result.pending, 1);
    assertEquals(tables.Supplier.length, 1);
  });

  it('another command for the record already in flight records nothing', async () => {
    const { result, calls } = await tick({ claimed: [P.party], inFlight: true });
    assertEquals(results(calls).length, 0);
    assertEquals(result.pending, 1);
    assertEquals(erpPosts(calls).length, 0);
  });

  it('M1 two ERP records that match are a fact, not an unknown: a rejection that says so, never created, never "could not confirm"', async () => {
    const dup = [{ name: 'PROJ-1', project_name: 'Jembatan', company: 'Test Co' }, { name: 'PROJ-2', project_name: 'Jembatan', company: 'Test Co' }];
    const { result, calls } = await tick({ claimed: [P.project], tables: { Project: dup } });
    assertEquals(rpcCall(calls, 'record_connect_send_held').length, 0);
    assertEquals(results(calls).map((r) => r.p_rejection), ['Two ERP records match this project. Link the right one by hand.']);
    assertEquals(erpPosts(calls).length, 0);
    assertEquals(result.rejected, 1);
  });

  it('a company whose earlier create left no trace is held for a person; a project or item is created again (ERPNext refuses a duplicate of either)', async () => {
    const earlier = (domain: string, id: string, key: string) => ({ id: 'ob-0', domain, pmo_record_id: id, idempotency_key: key, state: 'quarantined', external_record_id: null, canonical: null, claim_generation: 1, payload_digest: null });
    const party = await tick({ claimed: [P.party], outbox: [earlier('companies', 'c-1', 'seed:party:c-1')] });
    assertEquals(party.result, { sent: 0, rejected: 0, held: 1, pending: 0 });
    assertEquals(rpcCall(party.calls, 'record_connect_send_held').map(body), [{ p_org_id: ORG, p_id: 'prop-party' }]);
    assertEquals(party.outbox[0].state, 'held');
    assertEquals(erpPosts(party.calls).length, 0);
    const project = await tick({ claimed: [P.project], outbox: [earlier('projects', 'p-1', 'seed:project:p-1')] });
    assertEquals(project.result, { sent: 1, rejected: 0, held: 0, pending: 0 });
    assertEquals(erpPosts(project.calls).length, 1);
  });

  it('a person is never sent: the ERP needs personal details PMO does not hold, so the row asks to be added there', async () => {
    const { result, calls } = await tick({ claimed: [P.employee] });
    const r = results(calls);
    assertEquals(r.length, 1);
    assert(/birth date and gender/.test(String(r[0].p_rejection)) && r[0].p_external_id === null, String(r[0].p_rejection));
    assertEquals(erpPosts(calls).length, 0);
    assertEquals(calls.filter((c) => c.url.pathname === '/rest/v1/external_command_outbox').length, 0);
    assertEquals(result.rejected, 1);
  });

  it('a master that left PMO since it was accepted is rejected, not sent', async () => {
    const gone = await tick({ claimed: [P.project], archivedProject: true });
    assert(/no longer in PMO/.test(String(results(gone.calls)[0].p_rejection)));
    assertEquals(erpPosts(gone.calls).length, 0);
    const item = await tick({ claimed: [P.item], itemOnOpenPurchase: false });
    assert(/no longer in PMO/.test(String(results(item.calls)[0].p_rejection)));
    assertEquals(erpPosts(item.calls).length, 0);
  });

  it('a connection with no company set sends nothing and settles nothing', async () => {
    const { result, calls } = await tick({ claimed: [P.party], noCompany: true });
    assertEquals(results(calls).length, 0);
    assertEquals(erpPosts(calls).length, 0);
    assert(result.error !== undefined);
  });

  it('a tick spends at most the budget it is given', async () => {
    const { calls } = await tick({ claimed: [] }, org, 3);
    assertEquals(body(rpcCall(calls, 'claim_connect_sends')[0]).p_limit, 3);
  });

  it('NFR-ECA-003 every read and write names this org and no other', async () => {
    const { calls } = await tick({ claimed: [P.party, P.project, P.item] });
    assertEquals(JSON.stringify(calls.map((c) => [c.url.toString(), c.bodyText])).includes(OTHER_ORG), false);
    for (const c of [...rpcCall(calls, 'claim_connect_sends'), ...rpcCall(calls, 'record_connect_send_result')]) assertEquals(body(c).p_org_id, ORG);
    for (const t of ['companies', 'projects', 'procurement_items']) {
      for (const c of calls.filter((x) => x.url.pathname === `/rest/v1/${t}`)) assertEquals(c.url.searchParams.get('org_id'), `eq.${ORG}`);
    }
  });
});

describe('ECA3-T12 new items on open purchases are sent by the sweep, without a person', () => {
  const newItem = (o: Opts = {}) => tick({ claimed: [P.newItem], ...o });
  const kabelInErp = (extra: Record<string, unknown> = {}) => ({ name: 'ITM-77', item_code: 'ITM-77', item_name: 'Kabel 10 mm', ...extra });

  it('FR-ECA-016 a new line after setup is sent once and the admin sees nothing', async () => {
    const first = await newItem({ fault: { Item: 'lost-response' } });   // the create landed, the answer was lost
    assertEquals(first.result.pending, 1);
    const second = await newItem({ tables: first.tables, outbox: first.outbox });   // the lease ran out: the next tick looks again
    assertEquals(second.tables.Item.length, 1);   // one ERP item, not two
    assertEquals(erpPosts(second.calls).length, 0);
    assertEquals(results(second.calls).map((r) => [r.p_id, r.p_rejection ?? null]), [['prop-new', null]]);
    assertEquals(second.result, { sent: 1, rejected: 0, held: 0, pending: 0 });
    assertEquals(rpcCall(second.calls, 'record_connect_send_held').length, 0);
    assertEquals(second.outbox.map((r) => [r.domain, r.idempotency_key]), [['items', 'seed:item:Kabel 10 mm']]);
  });

  it('FR-ECA-016 the sweep queues new items once a tick, before it claims', async () => {
    const { calls } = await newItem();
    const names = calls.filter((c) => c.url.pathname.startsWith('/rest/v1/rpc/')).map((c) => c.url.pathname.split('/').pop());
    assertEquals(names.filter((n) => n === 'enqueue_new_item_sends').length, 1);
    assert(names.indexOf('enqueue_new_item_sends') < names.indexOf('claim_connect_sends'), String(names));
    assertEquals(body(rpcCall(calls, 'enqueue_new_item_sends')[0]), { p_org_id: ORG, p_tier: 'erpnext' });
  });

  it('FR-ECA-016 no connection id: nothing is queued', async () => {
    const { calls } = await tick({ claimed: [] }, { orgId: ORG });
    assertEquals(rpcCall(calls, 'enqueue_new_item_sends').length, 0);
  });

  it('FR-ECA-016 a queueing failure is reported and the waiting sends still go', async () => {
    const { result } = await newItem({ enqueueError: '57014' });
    assertEquals(result.sent, 1);
    assert(String(result.error).startsWith('enqueue:'), String(result.error));
  });

  it('FR-ECA-016 a send the sweep queued needs no accepting Admin; a send with no decider that is not automatic still does', async () => {
    const auto = await newItem();
    assertEquals(auto.calls.filter((c) => c.url.pathname === '/rest/v1/profiles').length, 0);
    assertEquals(auto.result.sent, 1);
    const inserts = auto.calls.filter((c) => c.method === 'POST' && c.url.pathname === '/rest/v1/external_command_outbox').map(body);
    for (const i of inserts) assertEquals(i.actor_user_id ?? null, null);
    const orphan = await tick({ claimed: [{ ...P.newItem, snapshot: {} }] });
    assertEquals(erpPosts(orphan.calls).length, 0);
    assert(/no longer an Admin/.test(String(results(orphan.calls)[0].p_rejection)));
  });

  it('FR-ECA-016 an item that already has its link is not sent again', async () => {
    const { result, calls, outbox } = await newItem({ linked: { 'Kabel 10 mm': 'ITM-77' } });
    assertEquals(calls.filter((c) => c.url.host === ERP).length, 0);
    assertEquals(outbox.length, 0);
    assertEquals(results(calls).map((r) => [r.p_external_id, r.p_rejection ?? null]), [['ITM-77', null]]);
    assertEquals(result.sent, 1);
  });

  it('FR-ECA-020 an ERP item that carries the line name under another code is linked, not duplicated', async () => {
    const { result, calls, tables } = await newItem({ tables: { Item: [kabelInErp()] } });
    assertEquals(tables.Item.length, 1);
    assertEquals(erpPosts(calls).length, 0);
    assertEquals(results(calls).map((r) => [r.p_external_id, r.p_rejection ?? null]), [['ITM-77', null]]);
    assertEquals(result.sent, 1);
  });

  it('FR-ECA-020 a line name that two ERP items carry becomes a review row, never a guess', async () => {
    const { result, calls, tables } = await newItem({ tables: { Item: [kabelInErp(), kabelInErp({ name: 'ITM-78', item_code: 'ITM-78' })] } });
    assertEquals(tables.Item.length, 2);
    assertEquals(erpPosts(calls).length, 0);
    assertEquals(results(calls).map((r) => [r.p_external_id, r.p_rejection]), [[null, 'Two ERP records match this item. Link the right one by hand.']]);
    assertEquals(result.rejected, 1);
  });
});

describe('ECA3-T7 the drain is wired into the sweep and the reconcile pass leaves seed rows alone', () => {
  it('a seed: outbox row is never replayed by the reconcile pass', async () => {
    const candidate = { id: 'o1', domain: 'companies', pmoRecordId: 'c-1', idempotencyKey: 'seed:party:c-1', state: 'failed' as const, externalRecordId: null, canonical: null, claimGeneration: 1, payloadDigest: null };
    const ordinary = { ...candidate, id: 'o2', idempotencyKey: 'plain-key' };
    let built = 0;
    const out = await reconcileOrgOutbox(() => Promise.resolve([candidate, ordinary]), { orgId: ORG, ownedDomains: ['companies'] },
      () => { built += 1; throw new Error('driven'); }, () => Promise.reject(new Error('driven')));
    assertEquals(built, 1);   // only the ordinary key reached buildDeps
    assertEquals(out.errors.map((e) => e.id), ['o2']);
  });

  it('the cycle runs the drain after the connect run, records its error and still runs the next org', async () => {
    const seen: string[] = [];
    const bind = (orgId: string) => ({ orgId, bindingId: `b-${orgId}`, siteUrl: 'https://erp.example.com', secretRef: 'r', company: 'C', config: {}, versionMajor: 16, activatedAt: 'x', ownedDomains: [], lastFullSweepAt: null });
    const order: string[] = [];
    const cycle = await runErpSweepCycle({
      listEmployingOrgs: () => Promise.resolve([bind('o1'), bind('o2')]),
      reconcileOrgOutbox: () => Promise.resolve({ errors: [] } as never),
      sweepOrgDoctypes: () => Promise.resolve({ applied: 0 }),
      feedOrgLedgers: () => Promise.resolve({ gl: 0, ple: 0 } as never),
      refreshOrgAccounting: () => Promise.resolve({}),
      advanceConnectRun: (o) => { order.push(`run:${o.orgId}`); return Promise.resolve({}); },
      drainConnectSends: (o) => { order.push(`send:${o.orgId}`); seen.push(o.orgId); return o.orgId === 'o1' ? Promise.reject(new Error('boom')) : Promise.resolve({}); },
    }, undefined, 'money-only');
    assertEquals(seen, ['o1', 'o2']);
    assertEquals(order, ['run:o1', 'send:o1', 'run:o2', 'send:o2']);
    assertEquals(cycle.perOrg[0].errors, ['sends:boom']);
    assertEquals(cycle.perOrg[1].errors, []);
  });
});
