/**
 * external-set-company — the ECA setup verbs (#1605, FR-ECA-001/002/012/015). Real handler from ./index.ts; Supabase and
 * the ERP mocked over fetch. The ERP mock answers GET only: a census must never write to the ERP.
 */
import { afterAll, describe, it } from '@std/testing/bdd';
import { assertEquals } from '@std/assert';
import { handleSetCompanyRequest, setTestJwks } from './index.ts';
import {
  countResponse, createAuthedRequest, createJwtAuthority, createTestJwksResolver, installEdgeEnv, jsonResponse, rpcCall,
  supabaseRpc, supabaseSelect, withFetchMock, type FetchCall, type MockRoute,
} from '../_shared/testing/edgeTestKit.ts';

const env = installEdgeEnv();
Deno.env.set('SUPABASE_ANON_KEY', 'test-anon-key');
const auth = await createJwtAuthority(env.SUPABASE_URL);
setTestJwks(createTestJwksResolver(auth));
afterAll(() => { env.restore(); Deno.env.delete('SUPABASE_ANON_KEY'); });

const ERP = 'erp.example.com';
const one = (body: unknown) => jsonResponse(body, { headers: { 'content-type': 'application/vnd.pgrst.object+json' } });
const none = () => new Response('null', { status: 200, headers: { 'content-type': 'application/json' } });
const pgError = (code: string, message: string) => jsonResponse({ code, message, details: null, hint: null }, { status: 400 });

interface Opts { role?: string; active?: boolean; rpc?: Record<string, (call: FetchCall) => Response>; extra?: MockRoute[] }
function routes(o: Opts = {}): MockRoute[] {
  const rpc = (fn: string, fallback: unknown) => supabaseRpc(fn, o.rpc?.[fn] ?? (() => jsonResponse(fallback)));
  return [
    ...(o.extra ?? []),
    supabaseSelect('profiles', () => one({ org_id: 'org-1', role: o.role ?? 'Admin' })),
    supabaseSelect('platform_operators', () => none()),
    supabaseRpc('actor_authorization_state', () => jsonResponse({ active: o.active ?? true })),
    supabaseSelect('external_org_bindings', () => one({
      site_url: `https://${ERP}`, secret_ref: 'ref', status: 'active', activated_at: '2026-11-01T00:00:00Z', config: { company: 'Example Co' } })),
    supabaseRpc('read_vault_secret', () => jsonResponse('key:secret')),
    { label: 'erp-count', method: 'GET', host: ERP, pathname: '/api/method/frappe.client.get_count', response: () => jsonResponse({ message: 3 }) },
    // PMO counts are head requests; distinct item names are a keyset-paged row read.
    { label: 'pmo-head', method: 'HEAD', pathname: /^\/rest\/v1\//, response: () => countResponse(2) },
    supabaseSelect('procurement_items', (c) => jsonResponse(c.url.searchParams.has('id') && /gt\./.test(c.url.searchParams.get('id') ?? '')
      ? [] : [{ id: 'i1', name: 'Semen' }, { id: 'i2', name: 'Semen' }, { id: 'i3', name: 'Pasir' }])),
    rpc('start_connect_run', 'run-1'),
    rpc('write_connect_census', null),
    rpc('accept_connect_proposals', { counts: {}, remaining: 0 }),
    rpc('decide_connect_review', null),
    rpc('unlink_connect_match', null),
  ];
}

async function call(body: Record<string, unknown>, o: Opts = {}) {
  const jwt = await auth.mintJwt({ sub: 'user-1' });
  return await withFetchMock(routes(o), async ({ calls }) => {
    const res = await handleSetCompanyRequest(createAuthedRequest('http://edge.test/set-company', { tier: 'erpnext', ...body }, jwt));
    const text = await res.text();
    return { res, json: JSON.parse(text) as Record<string, unknown>, calls, jwt };
  });
}
const erpCalls = (calls: FetchCall[]) => calls.filter((c) => c.url.host === ERP);

describe('ECA setup verbs — census', () => {
  it('FR-ECA-001 an Admin takes the census with the org from their profile, never from the body; the ERP is only read', async () => {
    const r = await call({ setupAction: 'census', orgId: 'org-other' });
    assertEquals(r.res.status, 200);
    assertEquals(r.json.runId, 'run-1');
    assertEquals((r.json.census as unknown[]).length, 11);
    const start = rpcCall(r.calls, 'start_connect_run')[0].bodyJson as Record<string, unknown>;
    assertEquals([start.p_org_id, start.p_tier, start.p_actor], ['org-1', 'erpnext', 'user-1']);
    const written = rpcCall(r.calls, 'write_connect_census')[0].bodyJson as { p_org_id: string; p_rows: Array<{ kind: string; pmoCount: number; erpCount: number }> };
    assertEquals(written.p_org_id, 'org-1');
    assertEquals(written.p_rows.find((x) => x.kind === 'party')?.erpCount, 6);   // Supplier + Customer, 3 each
    assertEquals(written.p_rows.find((x) => x.kind === 'item')?.pmoCount, 2);    // "Semen" counted once
    assertEquals(written.p_rows.find((x) => x.kind === 'party')?.pmoCount, 2);
    assertEquals(erpCalls(r.calls).every((c) => c.method === 'GET'), true);
    assertEquals(JSON.stringify(r.calls.map((c) => c.url.toString())).includes('org-other'), false);
  });

  it('NFR-ECA-003 an unreachable ERP fails the census before any run is started', async () => {
    const r = await call({ setupAction: 'census' }, { extra: [{ label: 'erp-down', method: 'GET', host: ERP, pathname: '/api/method/frappe.client.get_count', response: () => new Response('no', { status: 503 }) }] });
    assertEquals(r.res.status >= 500, true);
    assertEquals(rpcCall(r.calls, 'start_connect_run').length, 0);
  });

  it('Minor 6 a tier whose sweep pass does not exist yet takes no census and starts no run', async () => {
    const r = await call({ setupAction: 'census', tier: 'some-future-erp' });
    assertEquals(r.res.status, 400);
    assertEquals(rpcCall(r.calls, 'start_connect_run').length, 0);
    assertEquals(erpCalls(r.calls).length, 0);
  });

  for (const role of ['Engineer', 'Finance']) {
    it(`FR-ECA-002 ${role} cannot take a census, even naming the account kind`, async () => {
      const r = await call({ setupAction: 'census', kind: 'account' }, { role });
      assertEquals(r.res.status, 403);
      assertEquals(rpcCall(r.calls, 'start_connect_run').length, 0);
      assertEquals(erpCalls(r.calls).length, 0);
    });
  }

  it('an inactive member is refused before anything else', async () => {
    const r = await call({ setupAction: 'census' }, { active: false });
    assertEquals(r.res.status, 403);
    assertEquals(rpcCall(r.calls, 'start_connect_run').length, 0);
  });
});

describe('ECA setup verbs — accept, decide, unlink', () => {
  it('FR-ECA-012 an Engineer is refused before any RPC', async () => {
    const r = await call({ setupAction: 'accept-proposals' }, { role: 'Engineer' });
    assertEquals(r.res.status, 403);
    assertEquals(rpcCall(r.calls, 'accept_connect_proposals').length, 0);
  });

  it('FR-ECA-012 accept-all runs as the caller, in bounded calls, until nothing is left (I1)', async () => {
    let n = 0;
    const r = await call({ setupAction: 'accept-proposals', kind: 'party' }, { rpc: { accept_connect_proposals: () => jsonResponse(
      ++n === 1 ? { counts: { party: { link: 500, bring_in: 0, send: 0, left_open: 1 } }, remaining: 20 }
                : { counts: { party: { link: 20, bring_in: 3, send: 0, left_open: 0 } }, remaining: 0 }) } });
    assertEquals(r.res.status, 200);
    const accepts = rpcCall(r.calls, 'accept_connect_proposals');
    assertEquals(accepts.length, 2);
    for (const a of accepts) {
      assertEquals(a.headers.get('authorization'), `Bearer ${r.jwt}`);   // the caller's JWT, never the service key
      assertEquals(a.bodyJson, { p_tier: 'erpnext', p_kind: 'party', p_ids: null });
    }
    assertEquals(r.json, { counts: { party: { link: 520, bring_in: 3, send: 0, left_open: 1 } }, remaining: 0 });
  });

  it('FR-ECA-012 a call that makes no progress stops the loop and reports what is left', async () => {
    const r = await call({ setupAction: 'accept-proposals' }, { rpc: { accept_connect_proposals: () => jsonResponse({ counts: {}, remaining: 7 }) } });
    assertEquals(rpcCall(r.calls, 'accept_connect_proposals').length, 1);
    assertEquals(r.json.remaining, 7);
  });

  it('FR-ECA-012 the loop is bounded per request; the rest is reported for the next request', async () => {
    const r = await call({ setupAction: 'accept-proposals' }, { rpc: { accept_connect_proposals: () => jsonResponse({ counts: { party: { link: 1, bring_in: 0, send: 0, left_open: 0 } }, remaining: 99 }) } });
    assertEquals(rpcCall(r.calls, 'accept_connect_proposals').length, 20);
    assertEquals(r.json.remaining, 99);
  });

  it('Minor 7 the loop also stops on elapsed time, not only on the call count', async () => {
    const realNow = Date.now;
    let clock = realNow();
    Date.now = () => clock;
    try {
      const r = await call({ setupAction: 'accept-proposals' }, { rpc: { accept_connect_proposals: () => {
        clock += 25_000;   // each call is slow
        return jsonResponse({ counts: { party: { link: 1, bring_in: 0, send: 0, left_open: 0 } }, remaining: 99 });
      } } });
      assertEquals(rpcCall(r.calls, 'accept_connect_proposals').length, 3);   // 25 s, 50 s, 75 s: the third call passes the 60 s budget
      assertEquals(r.json.remaining, 99);
    } finally { Date.now = realNow; }
  });

  it('FR-ECA-012 Finance may accept account rows only', async () => {
    const ok = await call({ setupAction: 'accept-proposals', kind: 'account' }, { role: 'Finance' });
    assertEquals(ok.res.status, 200);
    const no = await call({ setupAction: 'accept-proposals', kind: 'party' }, { role: 'Finance' });
    assertEquals(no.res.status, 403);
    assertEquals(rpcCall(no.calls, 'accept_connect_proposals').length, 0);
    const all = await call({ setupAction: 'accept-proposals' }, { role: 'Finance' });
    assertEquals(all.res.status, 403);
  });

  it('FR-ECA-012 decide-review and unlink-match call their RPCs as the caller; unlink is Admin only', async () => {
    const d = await call({ setupAction: 'decide-review', id: 'p1', choice: { action: 'dismiss' } });
    assertEquals(d.res.status, 200);
    const dc = rpcCall(d.calls, 'decide_connect_review')[0];
    assertEquals([dc.headers.get('authorization'), dc.bodyJson], [`Bearer ${d.jwt}`, { p_id: 'p1', p_choice: { action: 'dismiss' } }]);
    const u = await call({ setupAction: 'unlink-match', id: 'p2' });
    assertEquals(rpcCall(u.calls, 'unlink_connect_match')[0].bodyJson, { p_id: 'p2' });
    const f = await call({ setupAction: 'unlink-match', id: 'p2' }, { role: 'Finance' });
    assertEquals(f.res.status, 403);
    assertEquals(rpcCall(f.calls, 'unlink_connect_match').length, 0);
  });

  it('FR-ECA-015 a refused unlink says so in plain words', async () => {
    const r = await call({ setupAction: 'unlink-match', id: 'p2' }, { rpc: { unlink_connect_match: () => pgError('P0001', 'link in use') } });
    assertEquals([r.res.status, r.json.message], [400, 'link in use']);
  });

  it('an RPC failure that is not ours to explain returns a generic message', async () => {
    const r = await call({ setupAction: 'unlink-match', id: 'p2' }, { rpc: { unlink_connect_match: () => pgError('XX000', 'relation "erp_connect_proposals" internal') } });
    assertEquals(r.res.status, 500);
    assertEquals(JSON.stringify(r.json).includes('erp_connect_proposals'), false);
  });
});

describe('ECA setup verbs — list and status', () => {
  it('FR-ECA-012 list-proposals pages by id through the caller client', async () => {
    const rows = Array.from({ length: 200 }, (_, i) => ({ id: `p${String(i).padStart(3, '0')}`, kind: 'party', outcome: 'link' }));
    const r = await call({ setupAction: 'list-proposals', kind: 'party', outcome: 'link', afterId: 'p000' }, { extra: [
      supabaseSelect('erp_connect_proposals', () => jsonResponse(rows))] });
    assertEquals(r.res.status, 200);
    const q = r.calls.find((c) => c.url.pathname === '/rest/v1/erp_connect_proposals')!;
    assertEquals(q.headers.get('authorization'), `Bearer ${r.jwt}`);
    const sp = q.url.searchParams;
    assertEquals([sp.get('external_tier'), sp.get('kind'), sp.get('outcome'), sp.get('id'), sp.get('order'), sp.get('limit')],
      ['eq.erpnext', 'eq.party', 'eq.link', 'gt.p000', 'id.asc', '200']);
    assertEquals([(r.json.proposals as unknown[]).length, r.json.nextAfterId], [200, 'p199']);
  });

  it('FR-ECA-012 Finance lists account rows only', async () => {
    const r = await call({ setupAction: 'list-proposals', kind: 'party' }, { role: 'Finance' });
    assertEquals(r.res.status, 403);
  });

  it('Minor 10 connect-status carries the run, the census and how many sends are waiting', async () => {
    const r = await call({ setupAction: 'connect-status' }, { extra: [
      supabaseSelect('erp_connect_runs', () => one({ id: 'run-1', state: 'ready', finished_at: null, error_class: null })),
      supabaseSelect('erp_connect_census', () => jsonResponse([{ kind: 'party', pmo_count: 2, erp_count: 3, linked_count: 1, inactive_erp_count: 0, scenario: 'S-D', accepted_at: null }])),
      { label: 'sending', method: 'HEAD', pathname: '/rest/v1/erp_connect_proposals', response: () => countResponse(4) },
    ] });
    assertEquals(r.res.status, 200);
    assertEquals(r.json.run, { id: 'run-1', state: 'ready', finished_at: null, error_class: null });
    assertEquals(r.json.waitingForSend, 4);
    assertEquals((r.json.census as unknown[]).length, 1);
    const head = r.calls.find((c) => c.method === 'HEAD' && c.url.pathname === '/rest/v1/erp_connect_proposals')!;
    assertEquals(head.url.searchParams.get('state'), 'eq.sending');
  });

  it('Minor 8 connect-status reports a failed run and its class, not a bare "no run"', async () => {
    const r = await call({ setupAction: 'connect-status' }, { extra: [
      supabaseSelect('erp_connect_runs', () => one({ id: 'run-2', state: 'failed', finished_at: '2026-11-02T00:00:00Z', error_class: 'external-unreachable' })),
      supabaseSelect('erp_connect_census', () => jsonResponse([])),
      { label: 'sending', method: 'HEAD', pathname: '/rest/v1/erp_connect_proposals', response: () => countResponse(0) },
    ] });
    assertEquals((r.json.run as Record<string, unknown>).error_class, 'external-unreachable');
  });

  it('connect-status with no run yet is run: null', async () => {
    const r = await call({ setupAction: 'connect-status' }, { extra: [
      supabaseSelect('erp_connect_runs', () => none()),
      supabaseSelect('erp_connect_census', () => jsonResponse([])),
      { label: 'sending', method: 'HEAD', pathname: '/rest/v1/erp_connect_proposals', response: () => countResponse(0) },
    ] });
    assertEquals([r.res.status, r.json.run, r.json.waitingForSend], [200, null, 0]);
  });

  it('an unknown setup verb stays on the existing path (no connect handling)', async () => {
    const r = await call({ setupAction: 'census-everything' });
    assertEquals(rpcCall(r.calls, 'start_connect_run').length, 0);
  });
});
