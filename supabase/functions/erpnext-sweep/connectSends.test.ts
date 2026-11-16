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
  /** #1599 ECX-4: a direct-cost account Finance asked for under a chosen expense group. */
  account: { id: 'prop-acct', kind: 'account', pmo_ids: ['Materials'], decided_by: 'admin-1', snapshot: { accountName: 'Site materials', parentAccount: 'Direct Expenses - TC' } },
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
  /** #1736: the statuses the database calls an open purchase (the drain takes its set from there, never from a literal). */
  openStatuses?: string[];
  /** #1599: answer this ERP request instead of the fake (undefined: the fake answers). */
  erpAnswer?: (c: FetchCall) => Response | undefined;
  /** #1599: the outbox's claim refuses with this message (a refusal from the outbox itself, before any ERP call). */
  claimRefusal?: string;
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
    supabaseRpc('connect_open_purchase_statuses', () => jsonResponse(o.openStatuses ?? ['Approved', 'Vendor Quoted', 'Quote Selected', 'Ordered', 'Received', 'Vendor Invoiced'])),
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
      if (o.claimRefusal) return jsonResponse({ code: 'P0001', message: o.claimRefusal, details: '' }, { status: 400 });
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
    // #1599: an Operator task (the operator alert sink) and the note a linked account send leaves
    { label: 'error-events-insert', method: 'POST', pathname: '/rest/v1/error_events', response: () => jsonResponse(null, { status: 201 }) },
    { label: 'proposal-note', method: 'PATCH', pathname: '/rest/v1/erp_connect_proposals', response: () => jsonResponse(null, { status: 204 }) },
    { label: 'erp', host: ERP, pathname: /^\/api\//, response: (c: FetchCall) => {
      const answer = o.erpAnswer?.(c);
      if (answer) return answer;
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
    assertEquals(claim, { p_org_id: ORG, p_tier: 'erpnext', p_limit: CONNECT_SENDS_PER_TICK.erpnext });
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

  it('FR-ECA-016 the drain takes the open-purchase statuses from the database, so the queue and the drain cannot drift apart', async () => {
    const skewed = ['Draft', 'Vendor Quoted'];
    const { calls } = await tick({ claimed: [P.item, { ...P.item, id: 'prop-item-2', pmo_ids: ['Pasir'] }], openStatuses: skewed });
    assertEquals(rpcCall(calls, 'connect_open_purchase_statuses').length, 1);   // one read serves every item in the tick
    const reads = calls.filter((c) => c.url.pathname === '/rest/v1/procurement_items');
    assertEquals(reads.length, 2);
    for (const r of reads) assertEquals(r.url.searchParams.get('procurements.status'), 'in.(Draft,Vendor Quoted)');
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

  it('FR-ECA-016 the no-Admin exemption is for items only: another kind marked automatic is still rejected', async () => {
    const { calls } = await tick({ claimed: [{ ...P.party, decided_by: null, snapshot: { auto: true } }] });
    assertEquals(erpPosts(calls).length, 0);
    assert(/no longer an Admin/.test(String(results(calls)[0].p_rejection)));
  });

  it('FR-ECA-016 a queueing error is kept next to a later send error, not overwritten', async () => {
    const { result } = await tick({ claimed: [P.party], enqueueError: '57014', resultError: { 'prop-party': '57014' } });
    assert(String(result.error).includes('enqueue:'), String(result.error));
    assert(String(result.error).includes('party:'), String(result.error));
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

describe('#2250 the default quantum bounds one tick to two sends; the rest wait for later ticks', () => {
  const f = (c: FetchCall, k: string) => c.url.searchParams.get(k)?.replace(/^eq\./, '');
  /** Five distinct valid waiting masters — two parties, two projects, one item — each with its accepting Admin. */
  const FIVE: Proposal[] = [
    { id: 'q-1', kind: 'party', pmo_ids: ['c-1'], decided_by: 'admin-1' },
    { id: 'q-2', kind: 'party', pmo_ids: ['c-2'], decided_by: 'admin-1' },
    { id: 'q-3', kind: 'project', pmo_ids: ['p-1'], decided_by: 'admin-1' },
    { id: 'q-4', kind: 'project', pmo_ids: ['p-2'], decided_by: 'admin-1' },
    { id: 'q-5', kind: 'item', pmo_ids: ['Semen 50 kg'], decided_by: 'admin-1' },
  ];

  /** The queue behind the claim: waiting rows are leased by p_limit and only a recorded result settles one — the SQL's
   * pending/sent state, in a fixture. A row claimed but never recorded keeps its lease: it is neither waiting nor settled. */
  function queueOf(proposals: Proposal[]) {
    const rows = proposals.map((p) => ({ ...p, state: 'waiting' as 'waiting' | 'claimed' | 'settled' }));
    return {
      claim(limit: number) {
        const taken = rows.filter((r) => r.state === 'waiting').slice(0, limit);
        for (const r of taken) r.state = 'claimed';
        return taken;
      },
      settle(id: string) { const r = rows.find((x) => x.id === id); if (r && r.state === 'claimed') r.state = 'settled'; },
      waiting: () => rows.filter((r) => r.state === 'waiting').map((r) => r.id),
      settled: () => rows.filter((r) => r.state === 'settled').map((r) => r.id),
    };
  }

  /** The suite's own mock bed with the claim and the result writer backed by `q`; binding, vault, outbox and ERP routes are the
   * same ones every other test here uses, so the real shipped drain and outbox loop execute over persistent state. */
  function bed(q: ReturnType<typeof queueOf>) {
    const m = routes({});
    const echo: MockRoute[] = [
      // masters answer with the id the drain actually asked for, so all five stay distinct records
      supabaseSelect('companies', (c) => one({ id: f(c, 'id'), name: `PT Baja ${f(c, 'id')}`, type: 'Vendor', erp_tax_id: null })),
      supabaseSelect('projects', (c) => one({ id: f(c, 'id'), name: `Jembatan ${f(c, 'id')}`, code: `CODE-${f(c, 'id')}` })),
      supabaseSelect('procurement_items', (c) => jsonResponse([{ id: f(c, 'name') }])),
      supabaseRpc('claim_connect_sends', (c) => jsonResponse(q.claim(Number((c.bodyJson as { p_limit: number }).p_limit))
        .map((p) => ({ snapshot: {}, ...p, org_id: ORG, external_tier: 'erpnext', state: 'sending', outcome: 'send' })))),
      supabaseRpc('record_connect_send_result', (c) => { q.settle((c.bodyJson as { p_id: string }).p_id); return jsonResponse(null); }),
    ];
    return { outbox: m.outbox, tables: m.tables, erp: m.erp, all: [...echo, ...m.routes] };
  }

  async function stateTick(b: ReturnType<typeof bed>) {
    const sc = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
    return await withFetchMock(b.all, async ({ calls }) => ({ result: await drainConnectSends(sc, org), calls }));
  }

  it('the default budget claims two, settles exactly those two durably, and leaves the rest waiting', async () => {
    const q = queueOf(FIVE);
    const b = bed(q);
    const first = await stateTick(b);
    assertEquals(body(rpcCall(first.calls, 'claim_connect_sends')[0]).p_limit, 2);   // the shipped default, as the literal it must be
    assertEquals(first.result, { sent: 2, rejected: 0, held: 0, pending: 0 });
    assertEquals(q.settled(), ['q-1', 'q-2']);   // exactly the two claimed rows durably completed
    assertEquals(q.waiting(), ['q-3', 'q-4', 'q-5']);   // the rest stay available for the next call
    assertEquals(erpPosts(first.calls).length, 2);   // the real loop dispatched both into the ERP
    assertEquals(b.outbox.map((r) => [r.domain, r.pmo_record_id, r.idempotency_key, r.state]), [
      ['companies', 'c-1', 'seed:party:c-1', 'confirmed'], ['companies', 'c-2', 'seed:party:c-2', 'confirmed'],
    ]);
  });

  it('across ticks the whole queue drains: two, two, one, none — every id once, no duplicate or skipped create', async () => {
    const q = queueOf(FIVE);
    const b = bed(q);
    const ticks: Awaited<ReturnType<typeof stateTick>>[] = [];
    for (let i = 0; i < 4; i += 1) ticks.push(await stateTick(b));
    const [t1, t2, t3, t4] = ticks;
    assertEquals(results(t1.calls).map((r) => r.p_id), ['q-1', 'q-2']);
    assertEquals(results(t2.calls).map((r) => r.p_id), ['q-3', 'q-4']);
    assertEquals(results(t3.calls).map((r) => r.p_id), ['q-5']);
    assertEquals(results(t4.calls).map((r) => r.p_id), []);
    assertEquals(ticks.map((t) => t.result.sent), [2, 2, 1, 0]);   // remainder 0: nothing left after the third tick
    assertEquals(t4.result, { sent: 0, rejected: 0, held: 0, pending: 0 });
    for (const t of ticks) assertEquals(body(rpcCall(t.calls, 'claim_connect_sends')[0]).p_limit, 2);
    assertEquals(q.settled(), FIVE.map((p) => p.id));   // every original id settled exactly once, none skipped
    assertEquals(ticks.reduce((n, t) => n + erpPosts(t.calls).length, 0), 5);   // five creates; a retry never makes a twin
    assertEquals([b.tables.Supplier.length, b.tables.Project.length, b.tables.Item.length], [2, 2, 1]);
    assertEquals(b.tables.Supplier.map((s) => s.supplier_name), ['PT Baja c-1', 'PT Baja c-2']);
    assertEquals(b.outbox.map((r) => [r.idempotency_key, r.state]),
      FIVE.map((p) => [`seed:${p.kind}:${p.pmo_ids[0]}`, 'confirmed']));   // stable idempotency, one confirmed row per seed key
  });
});

/** A Standard-chart slice of the bound company, as the bed holds it (#1599 ECX4-T0). */
const chart = () => ({
  Company: [{ name: 'Test Co', abbr: 'TC' }],
  Account: [
    { name: 'Direct Expenses - TC', account_name: 'Direct Expenses', parent_account: null, company: 'Test Co', root_type: 'Expense', is_group: 1 },
    { name: 'Cost of Goods Sold - TC', account_name: 'Cost of Goods Sold', parent_account: 'Direct Expenses - TC', company: 'Test Co', root_type: 'Expense', is_group: 0 },
    { name: 'Indirect Expenses - TC', account_name: 'Indirect Expenses', parent_account: null, company: 'Test Co', root_type: 'Expense', is_group: 1 },
    { name: 'Old Site Costs - TC', account_name: 'Old Site Costs', parent_account: null, company: 'Test Co', root_type: 'Expense', is_group: 1, disabled: 1 } as Record<string, unknown>,
  ] as Array<Record<string, unknown>>,
});
const operatorTasks = (calls: FetchCall[]) => calls.filter((c) => c.method === 'POST' && c.url.pathname === '/rest/v1/error_events').map(body);
const notes = (calls: FetchCall[]) => calls.filter((c) => c.method === 'PATCH' && c.url.pathname === '/rest/v1/erp_connect_proposals')
  .map((c): Record<string, unknown> => ({ ...body(c), id: c.url.searchParams.get('id'), org: c.url.searchParams.get('org_id'), state: c.url.searchParams.get('state') }));
const ADMIN_TOLD = 'PMO could not create the account; your administrator has been told.';
/** A permission refusal as each bed version answers it (403 PermissionError, wording differs). */
const FORBIDDEN = {
  v15: () => new Response(JSON.stringify({ exc_type: 'PermissionError', _error_message: 'No permission for Account',
    _server_messages: JSON.stringify([JSON.stringify({ message: 'User <strong>bot</strong> does not have doctype access via role permission for document <strong>Account</strong>', title: 'Message' })]) }), { status: 403 }),
  v16: () => new Response(JSON.stringify({ exc_type: 'PermissionError',
    _server_messages: JSON.stringify([JSON.stringify({ message: 'Insufficient Permission for Account', title: 'Not Permitted', indicator: 'red', as_table: false })]) }), { status: 403 }),
};
const isAccountPost = (c: FetchCall) => c.method === 'POST' && decodeURIComponent(c.url.pathname) === '/api/resource/Account';
const isAccountLookup = (c: FetchCall) => c.method === 'GET' && decodeURIComponent(c.url.pathname) === '/api/resource/Account';

describe('#1599 ECX-4 drainConnectSends: direct-cost accounts', () => {
  it('AC-ECX-030 creates one leaf account under the chosen group, through the outbox under seed:account:<category>, and records the ERP name for the map', async () => {
    const { result, calls, tables, outbox } = await tick({ claimed: [P.account], tables: chart() });
    const created = tables.Account.filter((a) => a.created === true);
    assertEquals(created.map((a) => [a.name, a.parent_account, a.company, a.root_type, a.is_group]), [['Site materials - TC', 'Direct Expenses - TC', 'Test Co', 'Expense', 0]]);
    assertEquals(erpPosts(calls).map((c) => body(c)), [{ account_name: 'Site materials', parent_account: 'Direct Expenses - TC', company: 'Test Co' }]);
    assertEquals(outbox.map((r) => [r.domain, r.pmo_record_id, r.idempotency_key, r.state]), [['accounts', 'Materials', 'seed:account:Materials', 'confirmed']]);
    assertEquals(results(calls).map((r) => [r.p_id, r.p_external_id, r.p_rejection ?? null]), [['prop-acct', 'Site materials - TC', null]]);
    assertEquals(result, { sent: 1, rejected: 0, held: 0, pending: 0 });
  });

  it('AC-ECX-030 the requester must still be an Admin or Finance member of the org when the send goes out', async () => {
    const { calls } = await tick({ claimed: [P.account], tables: chart() });
    const actorRead = calls.find((c) => c.method === 'GET' && c.url.pathname === '/rest/v1/profiles')!;
    assertEquals(actorRead.url.searchParams.get('role'), 'in.(Admin,Finance)');
    const gone = await tick({ claimed: [P.account], tables: chart(), actorGone: true });
    assertEquals(erpPosts(gone.calls).length, 0);
    assertEquals(results(gone.calls)[0].p_rejection, 'The person who asked for this account can no longer set up accounts. Ask again.');
  });

  it('AC-ECX-030 a category that already has its account is never sent again: no ERP call, its own account is the result', async () => {
    const { calls, outbox } = await tick({ claimed: [P.account], tables: chart(), linked: { Materials: 'Materials - TC' } });
    assertEquals(calls.filter((c) => c.url.host === ERP).length, 0);
    assertEquals(outbox.length, 0);
    assertEquals(results(calls)[0].p_external_id, 'Materials - TC');
  });

  it('AC-ECX-030 the ERP refusing the parent ends the send as a decision in plain words, and nothing is linked', async () => {
    const leafParent = { ...P.account, snapshot: { accountName: 'Site materials', parentAccount: 'Cost of Goods Sold - TC' } };
    const { result, calls } = await tick({ claimed: [leafParent], tables: chart() });
    const [r] = results(calls);
    assertEquals(r.p_external_id, null);
    assertEquals(r.p_rejection, 'Pick a group account, not a posting account.');   // our sentence, never the ERP's "can not be a ledger"
    assertEquals(erpPosts(calls).length, 0);
    assertEquals(result.rejected, 1);
  });

  it('AC-ECX-030 a request with no name or no group is refused before any ERP call', async () => {
    const blank = { ...P.account, snapshot: { accountName: '  ', parentAccount: 'Direct Expenses - TC' } };
    const noGroup = { ...P.account, id: 'prop-acct-2', snapshot: { accountName: 'Site materials', parentAccount: '' } };
    const { calls, outbox } = await tick({ claimed: [blank, noGroup], tables: chart() });
    assertEquals(calls.filter((c) => c.url.host === ERP).length, 0);
    assertEquals(outbox.length, 0);
    assertEquals(results(calls).map((r) => r.p_rejection), Array(2).fill('Give the account a name and choose the expense group it goes under, then ask again.'));
  });

  it('AC-ECX-030 an account the ERP already holds under that name that cannot hold direct costs is refused in plain words, and the outbox row stays retryable (never held)', async () => {
    const tables = chart();
    tables.Account.push({ name: 'Site materials - TC', account_name: 'Site materials', parent_account: 'Direct Expenses - TC', company: 'Test Co', root_type: 'Expense', is_group: 1 });
    const { result, calls, outbox } = await tick({ claimed: [P.account], tables });
    assertEquals(results(calls)[0].p_rejection, 'The ERP already has an account named Site materials that cannot hold direct costs. Choose another name.');
    assertEquals(outbox.map((r) => r.state), ['failed']);
    assertEquals(erpPosts(calls).length, 0);
    assertEquals([result.rejected, result.held], [1, 0]);
  });

  it('AC-ECX-030 a parent group turned off after the chart was mirrored is refused before the create, in plain words, and nothing is created', async () => {
    const off = { ...P.account, snapshot: { accountName: 'Site materials', parentAccount: 'Old Site Costs - TC' } };
    const { calls, tables } = await tick({ claimed: [off], tables: chart() });
    assertEquals(results(calls)[0].p_rejection, 'Old Site Costs - TC is turned off. Pick another expense group.');
    assertEquals(erpPosts(calls).length, 0);
    assertEquals(tables.Account.filter((a) => a.created === true), []);
  });

  it('AC-ECX-030 a permission refusal, on either ERP version and at lookup or create, ends in one sentence for Finance and an Operator task, never an ERP step', async () => {
    const runs = [
      await tick({ claimed: [P.account], tables: chart(), erpAnswer: (c) => (isAccountPost(c) ? FORBIDDEN.v15() : undefined) }),
      await tick({ claimed: [P.account], tables: chart(), erpAnswer: (c) => (isAccountPost(c) ? FORBIDDEN.v16() : undefined) }),
      await tick({ claimed: [P.account], tables: chart(), erpAnswer: (c) => (isAccountLookup(c) ? FORBIDDEN.v16() : undefined) }),
    ];
    for (const { calls, result, tables } of runs) {
      assertEquals(results(calls).map((r) => [r.p_external_id, r.p_rejection]), [[null, ADMIN_TOLD]]);
      assertEquals(operatorTasks(calls), [{ fn: 'erpnext-sweep', error_code: 'ERP_INTEGRATION_USER_CANNOT_CREATE_ACCOUNTS', context_id: 'prop-acct', org_id: ORG }]);
      assertEquals(tables.Account.filter((a) => a.created === true), []);
      assertEquals(result.rejected, 1);
    }
  });

  it('AC-ECX-030 a refusal PMO cannot read ends in the same sentence and an Operator task, never "check it in the ERP"', async () => {
    const unreadable = () => new Response(JSON.stringify({ exc_type: 'ValidationError', _server_messages: JSON.stringify([JSON.stringify({ message: 'https://erp.example.com/app/account' })]) }), { status: 417 });
    const { calls } = await tick({ claimed: [P.account], tables: chart(), erpAnswer: (c) => (isAccountPost(c) ? unreadable() : undefined) });
    assertEquals(results(calls)[0].p_rejection, ADMIN_TOLD);
    assertEquals(operatorTasks(calls).map((t) => t.error_code), ['ERP_ACCOUNT_SEND_REFUSED']);
  });

  it('AC-ECX-030 a refusal from the outbox itself (not the ERP) is never shown verbatim: the same sentence and an Operator task', async () => {
    const { calls } = await tick({ claimed: [P.account], tables: chart(), claimRefusal: 'procurement-create-refused: some_rule' });
    assertEquals(erpPosts(calls).length, 0);
    const [r] = results(calls);
    assertEquals(r.p_rejection, ADMIN_TOLD);
    assertEquals(operatorTasks(calls).map((t) => t.error_code), ['ERP_ACCOUNT_SEND_REFUSED']);
  });

  it('AC-ECX-030 an account send that ends after its last try, or is held undecided, raises an Operator task; one still being retried raises none', async () => {
    const trouble = { claimed: [P.account], tables: chart(), resultError: { 'prop-acct': '57014' } };
    assertEquals(operatorTasks((await tick(trouble)).calls), []);
    assertEquals(operatorTasks((await tick({ ...trouble, failureEnds: true })).calls).map((t) => [t.error_code, t.context_id]), [['ERP_ACCOUNT_SEND_STUCK', 'prop-acct']]);
    const held = { id: 'ob-0', domain: 'accounts', pmo_record_id: 'Materials', idempotency_key: 'seed:account:Materials', state: 'held', external_record_id: null, canonical: null, claim_generation: 1, payload_digest: null };
    const h = await tick({ claimed: [P.account], tables: chart(), outbox: [held] });
    assertEquals(rpcCall(h.calls, 'record_connect_send_held').map(body), [{ p_org_id: ORG, p_id: 'prop-acct' }]);
    assertEquals(operatorTasks(h.calls).map((t) => [t.error_code, t.context_id]), [['ERP_ACCOUNT_SEND_UNCONFIRMED', 'prop-acct']]);
  });

  it('AC-ECX-030 a replayed account answer is read back from the ERP: a turned-off or posting account, or one under another name, is refused and never linked; a matching usable account is linked', async () => {
    const replayed = { id: 'ob-0', domain: 'accounts', pmo_record_id: 'Materials', idempotency_key: 'seed:account:Materials', state: 'confirmed', external_record_id: 'Site materials - TC', canonical: null, claim_generation: 1, payload_digest: null };
    const withAccount = (extra: Record<string, unknown>) => {
      const tables = chart();
      tables.Account.push({ name: 'Site materials - TC', account_name: 'Site materials', parent_account: 'Direct Expenses - TC', company: 'Test Co', root_type: 'Expense', is_group: 0, disabled: 0, ...extra });
      return tables;
    };
    const REFUSED = 'The ERP account that answers this request is not the one you asked for or cannot hold direct costs. Ask again with the name you want.';
    const run = (extra: Record<string, unknown>) => tick({ claimed: [P.account], tables: withAccount(extra), outbox: [{ ...replayed }] });
    for (const [label, extra] of [['turned off', { disabled: 1 }], ['a group', { is_group: 1 }], ['another company', { company: 'Other Co' }], ['another name', { account_name: 'Cement' }]] as const) {
      const { calls, result } = await run(extra);
      assertEquals(results(calls).map((r) => [r.p_external_id ?? null, r.p_rejection]), [[null, REFUSED]], label);
      assertEquals([result.sent, result.rejected], [0, 1], label);
      assertEquals(erpPosts(calls).length, 0, label);
    }
    const ok = await run({});
    assertEquals(results(ok.calls).map((r) => [r.p_external_id, r.p_rejection ?? null]), [['Site materials - TC', null]]);
    assertEquals(ok.result.sent, 1);
  });

  it('AC-ECX-030 an account of that name already under another group is linked there and says so; under the chosen group it says nothing', async () => {
    const elsewhere = (name: string) => {
      const tables = chart();
      tables.Account.push({ name, account_name: name.replace(/ - TC$/, ''), parent_account: 'Indirect Expenses - TC', company: 'Test Co', root_type: 'Expense', is_group: 0, disabled: 0 });
      return tables;
    };
    // found at lookup, and (another letter case) only through the ERP's duplicate answer
    for (const name of ['Site materials - TC', 'SITE MATERIALS - TC']) {
      const { calls, result } = await tick({ claimed: [P.account], tables: elsewhere(name) });
      assertEquals(results(calls).map((r) => [r.p_external_id, r.p_rejection ?? null]), [[name, null]]);
      assertEquals(notes(calls), [{ reason_text: 'Site materials already exists under Indirect Expenses - TC; linked there.', id: 'eq.prop-acct', org: `eq.${ORG}`, state: 'eq.applied' }]);
      assertEquals(result.sent, 1);
    }
    assertEquals(notes((await tick({ claimed: [P.account], tables: chart() })).calls), []);
  });
});
