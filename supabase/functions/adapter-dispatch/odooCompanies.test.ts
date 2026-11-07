// #1504 S8-B (AC-ODC-034 logic half, FR-ODC-055): an org that employs `companies` under tier `odoo` sends a company created in PMO to Odoo
// as a partner, through the SHIPPED handler (`./index.ts`, fetch mocked) with the fake Odoo behind the Odoo host. The outbox key follows the PMO
// record, a lost answer is adopted by lookup (never created twice), and an inconclusive lookup holds the command for a person.
// Every route is a FACT about the world the handler reads; `unexpected` names any read not mocked (add a route; never loosen an assertion).
import { describe, it } from '@std/testing/bdd';
import { assert, assertEquals, assertNotEquals } from '@std/assert';
import { createJwtAuthority, createTestJwksResolver, installEdgeEnv, jsonResponse, supabaseRpc, supabaseSelect, withFetchMock, type FetchCall, type MockRoute } from '../_shared/testing/edgeTestKit.ts';
import { createFakeOdoo, type FakeOdoo } from '../../../pmo-portal/src/lib/adapterSeam/odoo/fakeOdoo.ts';
import { ADAPTER_REGISTRY, selectAdapterFactory } from './dispatchAdapters.ts';
import { resolveOdooCompaniesAdapter } from './odooCompanies.ts';

const env = installEdgeEnv();
Deno.env.set('SUPABASE_ANON_KEY', 'test-anon-key');
const auth = await createJwtAuthority(env.SUPABASE_URL);

let servedHandler: ((req: Request) => Promise<Response>) | null = null;
(Deno as unknown as { serve: (h: unknown) => unknown }).serve = (h: unknown) => {
  servedHandler = h as (req: Request) => Promise<Response>;
  return { finished: Promise.resolve() };
};
const { setTestJwks } = await import('./index.ts');
setTestJwks(createTestJwksResolver(auth));
// The Odoo client's pacer and the outbox's backoff only slow things down; fire their timers at once.
const realSetTimeout = globalThis.setTimeout;
globalThis.setTimeout = ((fn: () => void) => { queueMicrotask(fn); return 0; }) as unknown as typeof setTimeout;
addEventListener('unload', () => { env.restore(); globalThis.setTimeout = realSetTimeout; });

const ORG_ID = '11111111-1111-4111-8111-111111111111';
const CALLER = '66666666-6666-4666-8666-666666666666';
const CO_ID = 'dddddddd-dddd-4ddd-8ddd-000000000034';
const ODOO_HOST = 'odoo.example.test';
const KEY = 'odoo-test-key';
const CLIENT_KEY = 'cccccccc-cccc-4ccc-8ccc-000000000034';

const objectResponse = (body: unknown) => jsonResponse(body, { headers: { 'content-type': 'application/vnd.pgrst.object+json' } });
const nullObjectResponse = () => new Response('null', { status: 200, headers: { 'content-type': 'application/json' } });
const param = (call: FetchCall, key: string): string | null => {
  const raw = call.url.searchParams.get(key);
  return raw?.startsWith('eq.') ? decodeURIComponent(raw.slice(3)) : raw;
};
const body = (c: FetchCall) => c.bodyJson as Record<string, unknown>;

const createCommand = (over: Record<string, unknown> = {}) => ({
  domain: 'companies', operation: 'create', idempotencyKey: CLIENT_KEY,
  record: { id: CO_ID, name: 'PT Sinar Baja', type: 'Vendor', erp_doc_kind: 'supplier', erp_tax_id: '01.234.567.8-901.000', ...over },
});

interface State { fake: FakeOdoo; outbox: Map<string, Record<string, unknown>>; loseNextCreate?: boolean }
const newState = (): State => ({ fake: createFakeOdoo({ key: KEY }), outbox: new Map() });
interface World { owns?: Array<'odoo' | 'erpnext'>; odooBinding?: Record<string, unknown> | null }

function routes(unexpected: FetchCall[], st: State, world: World): MockRoute[] {
  const owns = world.owns ?? ['odoo'];
  const rowOf = (id: string) => [...st.outbox.values()].find((r) => r.id === id)!;
  return [
    supabaseSelect('profiles', (call) => call.url.searchParams.has('role') ? jsonResponse([{ id: CALLER }]) : objectResponse({ org_id: ORG_ID })),
    supabaseRpc('domain_owned_by_tier', (call) => jsonResponse(owns.includes((call.bodyJson as { p_tier: 'odoo' | 'erpnext' }).p_tier))),
    supabaseRpc('actor_authorization_state', () => jsonResponse({ role: 'Finance', active: true })),
    supabaseRpc('read_vault_secret', () => jsonResponse(KEY)),
    supabaseSelect('external_org_bindings', (call) => param(call, 'external_tier') === 'odoo'
      ? (world.odooBinding === null ? nullObjectResponse() : objectResponse({
          id: 'b0000000-0000-4000-8000-000000000001', site_url: `https://${ODOO_HOST}`, secret_ref: 'odoo_ref', status: 'active', activated_at: '2026-11-01T00:00:00Z',
          config: { database: 'db1', odoo_company_id: 1, capabilities: { later: {}, models: {} } }, ...world.odooBinding,
        }))
      : nullObjectResponse()),
    supabaseSelect('external_refs', () => nullObjectResponse()),
    { label: 'outbox read', method: 'GET', pathname: '/rest/v1/external_command_outbox', response: (call) => {
      const row = st.outbox.get(`${param(call, 'pmo_record_id')}|${param(call, 'idempotency_key')}`);
      return row ? objectResponse(row) : nullObjectResponse();
    } },
    { label: 'outbox insert', method: 'POST', pathname: '/rest/v1/external_command_outbox', response: (call) => {
      const b = body(call);
      const row = { id: `outbox-${st.outbox.size + 1}`, domain: b.domain, pmo_record_id: b.pmo_record_id, idempotency_key: b.idempotency_key, state: 'pending',
        external_record_id: null, canonical: null, claim_generation: 0, payload_digest: b.payload_digest ?? null, payload: b.payload ?? null };
      st.outbox.set(`${String(b.pmo_record_id)}|${String(b.idempotency_key)}`, row);
      return objectResponse(row);
    } },
    { label: 'outbox update', method: 'PATCH', pathname: '/rest/v1/external_command_outbox', response: (call) => {
      const row = rowOf(param(call, 'id')!);
      Object.assign(row, call.bodyJson);
      return jsonResponse([{ id: row.id }]);
    } },
    supabaseRpc('claim_outbox_for_commit', (call) => { const row = rowOf(body(call).p_id as string); Object.assign(row, { state: 'committing', claim_generation: Number(row.claim_generation) + 1 }); return jsonResponse(row); }),
    supabaseRpc('quarantine_committing', (call) => { const row = rowOf(body(call).p_id as string); if (row.state === 'committing') row.state = 'quarantined'; return jsonResponse(row); }),
    supabaseRpc('mark_outbox_held', (call) => { rowOf(body(call).p_id as string).state = 'held'; return jsonResponse(1); }),
    supabaseRpc('confirm_outbox', (call) => { rowOf(body(call).p_id as string).state = 'confirmed'; return jsonResponse(1); }),
    supabaseRpc('record_outbox_ref', () => jsonResponse(1)),
    supabaseRpc('finalize_outbox', (call) => { const row = rowOf(body(call).p_id as string); Object.assign(row, { state: 'confirmed', external_record_id: body(call).p_external_record_id ?? row.external_record_id }); return jsonResponse(1); }),
    // the read model: the company row the create mirrors into PMO
    { label: 'companies upsert', method: 'POST', pathname: '/rest/v1/companies', response: (call) => jsonResponse([{ ...body(call), org_id: ORG_ID }]) },
    { label: 'notifications', pathname: '/rest/v1/notifications', response: () => jsonResponse([]) },
    { label: 'odoo', host: ODOO_HOST, pathname: /^\/json\/2\//, response: async (call) => {
      const answer = st.fake.fetch(call.url.toString(), { method: 'POST', headers: { Authorization: `bearer ${KEY}` }, body: call.bodyText });
      if (st.loseNextCreate && call.url.pathname.endsWith('/create')) { st.loseNextCreate = false; await answer; throw new TypeError('error sending request: connection reset'); }
      return answer;
    } },
    { label: 'unexpected', response: (call) => { unexpected.push(call); return jsonResponse({ message: 'unmocked' }, { status: 404 }); } },
  ];
}

async function dispatch(command: Record<string, unknown>, st: State, world: World = {}) {
  const unexpected: FetchCall[] = [];
  const logged: string[] = [];
  const realError = console.error, realLog = console.log, realWarn = console.warn;
  const sink = (...args: unknown[]) => { logged.push(args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ')); };
  console.error = sink; console.log = sink; console.warn = sink;
  try {
    const result = await withFetchMock(routes(unexpected, st, world), async ({ calls }) => {
      const jwt = await auth.mintJwt({ sub: CALLER });
      const res = await servedHandler!(new Request('http://edge.test/adapter-dispatch', {
        method: 'POST', headers: { authorization: `Bearer ${jwt}`, 'content-type': 'application/json' }, body: JSON.stringify(command),
      }));
      return { status: res.status, text: await res.text(), calls };
    });
    return { ...result, unexpected, logged };
  } finally { console.error = realError; console.log = realLog; console.warn = realWarn; }
}
const partners = (st: State) => st.fake.rows('res.partner');
const odooRequests = (calls: FetchCall[]) => calls.filter((c) => c.url.host === ODOO_HOST);
const outboxInserts = (calls: FetchCall[]) => calls.filter((c) => c.method === 'POST' && c.url.pathname === '/rest/v1/external_command_outbox');

describe('AC-ODC-034 companies under tier odoo — adapter selection', () => {
  it('an org that employs companies in Odoo gets the Odoo companies factory; ERPNext and ClickUp orgs are unchanged', () => {
    assertEquals(selectAdapterFactory('odoo', 'companies'), resolveOdooCompaniesAdapter);
    assertNotEquals(selectAdapterFactory('odoo', 'companies'), ADAPTER_REGISTRY.companies);
    assertEquals(selectAdapterFactory('erpnext', 'companies'), ADAPTER_REGISTRY.companies);
    assertEquals(selectAdapterFactory(undefined, 'companies'), ADAPTER_REGISTRY.companies);
    assertEquals(selectAdapterFactory('clickup', 'tasks'), ADAPTER_REGISTRY.tasks);
  });
});

describe('AC-ODC-034 a company created in PMO becomes one Odoo partner', () => {
  it('a create makes one partner carrying the PMO anchor and tax id; the outbox key follows the record whatever key the client sent', async () => {
    const st = newState();
    const r = await dispatch(createCommand(), st);
    assertEquals(r.unexpected.map((c) => `${c.method} ${c.url.pathname}${c.url.search}`), [], 'every read is mocked');
    assertEquals(r.status, 200, r.text);
    assertEquals(partners(st).length, 1);
    assertEquals(partners(st)[0], { ...partners(st)[0], name: 'PT Sinar Baja', ref: `pmo:${CO_ID}`, vat: '01.234.567.8-901.000', supplier_rank: 1 });
    assertEquals(JSON.parse(r.text).externalRecordId, `Vendor:${partners(st)[0].id}`);
    assertEquals(outboxInserts(r.calls).map((c) => [body(c).domain, body(c).pmo_record_id, body(c).idempotency_key, body(c).external_tier]), [['companies', CO_ID, `odoo:companies:${CO_ID}`, 'odoo']]);
  });

  it('a record id that is not a UUID is refused 422 before any outbox row or Odoo request', async () => {
    const st = newState();
    const r = await dispatch(createCommand({ id: 'not-a-uuid' }), st);
    assertEquals([r.status, JSON.parse(r.text).message], [422, 'company-record-id-invalid']);
    assertEquals([outboxInserts(r.calls).length, odooRequests(r.calls).length], [0, 0]);
  });

  it('a lost answer, then the same create again: the partner is found by its anchor, never created twice', async () => {
    const st = newState();
    st.loseNextCreate = true;
    const first = await dispatch(createCommand(), st);
    assert(first.status >= 500 || first.status === 502 || first.status === 503 || first.status === 504 || first.status === 409, `${first.status} ${first.text}`);
    assertEquals(partners(st).length, 1);
    const second = await dispatch(createCommand({}), st);
    assertEquals(second.unexpected.length, 0);
    assertEquals(partners(st).length, 1, second.text);
    assertEquals(second.status, 200, second.text);
    assertEquals(JSON.parse(second.text).externalRecordId, `Vendor:${partners(st)[0].id}`);
  });

  it('two partners with the anchor are held for a person: nothing is created, nothing guessed', async () => {
    const st = newState();
    st.fake.seed('res.partner', [{ id: 50, name: 'a', ref: `pmo:${CO_ID}`, parent_id: false }, { id: 51, name: 'b', ref: `pmo:${CO_ID}`, parent_id: false }]);
    st.loseNextCreate = false;
    st.outbox.set(`${CO_ID}|odoo:companies:${CO_ID}`, { id: 'outbox-0', domain: 'companies', pmo_record_id: CO_ID, idempotency_key: `odoo:companies:${CO_ID}`, state: 'quarantined', external_record_id: null, canonical: null, claim_generation: 1, payload_digest: null });
    const r = await dispatch(createCommand(), st);
    assertEquals(partners(st).length, 2);
    assertEquals(st.outbox.get(`${CO_ID}|odoo:companies:${CO_ID}`)!.state, 'held');
    assertNotEquals(r.status, 200);
  });

  it('an anchor edited in Odoo (probe miss after an undecided create) is held, never created again', async () => {
    const st = newState();
    st.loseNextCreate = true;
    await dispatch(createCommand(), st);
    partners(st)[0].ref = 'edited by hand';
    const second = await dispatch(createCommand(), st);
    assertEquals(partners(st).length, 1, 'no second partner');
    assertEquals(st.outbox.get(`${CO_ID}|odoo:companies:${CO_ID}`)!.state, 'held');
    assertNotEquals(second.status, 200);
  });
});

describe('AC-ODC-034 a connection that cannot be used refuses before any outbox row', () => {
  it('an unusable Odoo connection: 4xx, no outbox row, no Odoo request', async () => {
    const st = newState();
    const r = await dispatch(createCommand(), st, { odooBinding: { status: 'disabled' } });
    assert(r.status >= 400 && r.status < 500, `${r.status} ${r.text}`);
    assertEquals([outboxInserts(r.calls).length, odooRequests(r.calls).length, partners(st).length], [0, 0, 0]);
  });

  it('the operator\'s kill switch off: refused, no outbox row, no Odoo request', async () => {
    const st = newState();
    const prior = Deno.env.get('EXTERNAL_CONNECT_ENABLED');
    Deno.env.set('EXTERNAL_CONNECT_ENABLED', 'false');
    try {
      const r = await dispatch(createCommand(), st);
      assert(r.status >= 400 && r.status < 500, `${r.status} ${r.text}`);
      assertEquals([outboxInserts(r.calls).length, odooRequests(r.calls).length], [0, 0]);
    } finally { if (prior === undefined) Deno.env.delete('EXTERNAL_CONNECT_ENABLED'); else Deno.env.set('EXTERNAL_CONNECT_ENABLED', prior); }
  });
});
