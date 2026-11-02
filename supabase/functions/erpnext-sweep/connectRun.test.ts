/**
 * ECA2-T13 — the sweep pass that advances an open connect run (#1605). Real module, Supabase and the ERP mocked over
 * fetch. The pass pages ERP masters into the run's staging table, then proposes ONE kind per tick, and a stuck run ends.
 */
import { afterAll, describe, it } from '@std/testing/bdd';
import { assertEquals } from '@std/assert';
import { createClient } from '@supabase/supabase-js';
import { advanceConnectRuns, CONNECT_CALLS_PER_TICK } from './connectRun.ts';
import {
  countResponse, installEdgeEnv, jsonResponse, rpcCall, supabaseRpc, supabaseSelect, withFetchMock, type FetchCall, type MockRoute,
} from '../_shared/testing/edgeTestKit.ts';

// importing the sweep entry point would start its HTTP server; the other sweep suites stub the serve call the same way
(Deno as unknown as { serve: (...a: unknown[]) => unknown }).serve = () => ({ finished: Promise.resolve() });
const { runErpSweepCycle } = await import('./index.ts');
const env = installEdgeEnv();
afterAll(() => env.restore());

const ORG = 'org-a';
const OTHER_ORG = 'org-b';
const ERP = 'erp.example.com';
const one = (body: unknown) => jsonResponse(body, { headers: { 'content-type': 'application/vnd.pgrst.object+json' } });
const none = () => new Response('null', { status: 200, headers: { 'content-type': 'application/json' } });
const org = { orgId: ORG, bindingId: 'binding-a' };

interface RunRow { id: string; state: string; cursor: Record<string, string | null>; proposed_kinds: string[]; started_at: string }
const NEW_RUN = (over: Partial<RunRow> = {}): RunRow => ({ id: 'run-a', state: 'staging', cursor: {}, proposed_kinds: [], started_at: new Date().toISOString(), ...over });
const DONE = { party: null, item: null, project: null, employee: null, account: null };

interface Opts {
  run?: RunRow | null;
  suppliers?: number;
  companies?: number;
  staged?: Array<Record<string, unknown>>;
  fail?: Response;
  rpc?: Record<string, (call: FetchCall) => Response>;
}

function routes(o: Opts): MockRoute[] {
  const rpc = (fn: string, fallback: unknown = null) => supabaseRpc(fn, o.rpc?.[fn] ?? (() => jsonResponse(fallback)));
  return [
    supabaseSelect('external_org_bindings', () => one({ site_url: `https://${ERP}`, secret_ref: 'ref', status: 'active', activated_at: '2026-11-01T00:00:00Z', config: { company: 'Example Co' } })),
    supabaseRpc('read_vault_secret', () => jsonResponse('key:secret')),
    supabaseSelect('erp_connect_runs', () => (o.run === null ? none() : one(o.run ?? NEW_RUN()))),
    // the keyset-paged PMO and staged reads: a page under 1,000 rows ends the walk
    supabaseSelect('companies', (c) => {
      const after = (c.url.searchParams.get('id') ?? '').replace('gt.', '');
      const all = Array.from({ length: o.companies ?? 0 }, (_, i) => ({ id: `c${String(i).padStart(5, '0')}`, name: `Company ${i}`, type: 'Vendor', erp_tax_id: null }));
      return jsonResponse(all.filter((r) => r.id > after).slice(0, 1000));
    }),
    ...['projects', 'profiles', 'procurement_items'].map((t) => supabaseSelect(t, () => jsonResponse([]))),
    { label: 'categories-in-use', method: 'HEAD', pathname: '/rest/v1/budget_line_items', response: () => countResponse(0) },
    supabaseSelect('erp_connect_staged', () => jsonResponse((o.staged ?? []).map((row) => ({ external_id: String(row.externalId), row })))),
    {
      label: 'erp-list', method: 'GET', host: ERP, pathname: /^\/api\/resource\//,
      response: (c) => {
        if (o.fail) return o.fail;
        const doctype = decodeURIComponent(c.url.pathname.split('/').pop()!);
        const after = (JSON.parse(c.url.searchParams.get('filters') ?? '[]') as string[][]).find((f) => f[0] === 'name')?.[2] ?? '';
        const all = doctype === 'Supplier' ? Array.from({ length: o.suppliers ?? 0 }, (_, i) => ({ name: `S${String(i).padStart(5, '0')}`, supplier_name: `Supplier ${i}`, tax_id: null, disabled: 0 })) : [];
        return jsonResponse({ data: all.filter((r) => r.name > after).slice(0, 200) });
      },
    },
    rpc('stage_connect_master_page'), rpc('replace_connect_proposals'), rpc('fail_connect_run', 'staging'),
  ];
}

async function tick(o: Opts = {}, binding = org) {
  const sc = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  return await withFetchMock(routes(o), async ({ calls }) => ({ result: await advanceConnectRuns(sc, binding), calls }));
}
const erpCalls = (calls: FetchCall[]) => calls.filter((c) => c.url.host === ERP);
const rpcBody = (c: FetchCall) => c.bodyJson as Record<string, unknown>;

describe('ECA2-T13 advanceConnectRuns', () => {
  it('no open run: nothing is read from the ERP and nothing is written', async () => {
    const { result, calls } = await tick({ run: null });
    assertEquals(result, {});
    assertEquals(erpCalls(calls).length, 0);
    assertEquals(calls.filter((c) => c.method === 'POST').length, 0);
  });

  it('NFR-ECA-005 a tick spends at most its ERP call budget and keeps the cursor of the last page', async () => {
    const { result, calls } = await tick({ suppliers: 200 * (CONNECT_CALLS_PER_TICK + 2) });
    assertEquals(result, { state: 'more' });
    assertEquals(erpCalls(calls).length, CONNECT_CALLS_PER_TICK);
    const staged = rpcCall(calls, 'stage_connect_master_page');
    assertEquals(staged.length, CONNECT_CALLS_PER_TICK);
    assertEquals(rpcBody(staged[0]).p_kind, 'party');
    assertEquals(rpcBody(staged[0]).p_next_cursor, 'Supplier:S00199');
    assertEquals(rpcBody(staged.at(-1)!).p_next_cursor, `Supplier:S${String(200 * CONNECT_CALLS_PER_TICK - 1).padStart(5, '0')}`);
    assertEquals(rpcCall(calls, 'replace_connect_proposals').length, 0);   // nothing is proposed until every kind is staged
  });

  it('the run is the org\'s own: every read is scoped to this org and another org\'s run is never touched', async () => {
    const { calls } = await tick({ suppliers: 10 });
    const runRead = calls.find((c) => c.url.pathname === '/rest/v1/erp_connect_runs')!;
    assertEquals([runRead.url.searchParams.get('org_id'), runRead.url.searchParams.get('external_tier'), runRead.url.searchParams.get('binding_id')], [`eq.${ORG}`, 'eq.erpnext', 'eq.binding-a']);   // a run of an earlier connection is never read
    assertEquals(JSON.stringify(calls.map((c) => [c.url.toString(), c.bodyText])).includes(OTHER_ORG), false);
    for (const c of rpcCall(calls, 'stage_connect_master_page')) assertEquals(rpcBody(c).p_org_id, ORG);
  });

  it('once every kind is staged, a tick proposes ONE kind: the next one not yet proposed', async () => {
    const { result, calls } = await tick({ run: NEW_RUN({ state: 'proposing', cursor: DONE, proposed_kinds: ['party', 'item'] }) });
    assertEquals(result, { state: 'more' });
    const writes = rpcCall(calls, 'replace_connect_proposals');
    assertEquals(writes.length, 1);
    assertEquals([rpcBody(writes[0]).p_kind, rpcBody(writes[0]).p_last, rpcBody(writes[0]).p_org_id, rpcBody(writes[0]).p_tier], ['project', true, ORG, 'erpnext']);
    assertEquals(erpCalls(calls).length, 0);
  });

  it('the fifth kind reports ready', async () => {
    const { result } = await tick({ run: NEW_RUN({ state: 'proposing', cursor: DONE, proposed_kinds: ['party', 'item', 'project', 'employee'] }) });
    assertEquals(result, { state: 'ready' });
  });

  it('NFR-ECA-005 2,500 outcomes for one kind reach replace_connect_proposals as three chunks, only the last marking the kind proposed', async () => {
    const { calls } = await tick({ run: NEW_RUN({ state: 'proposing', cursor: DONE }), companies: 2500 });
    const writes = rpcCall(calls, 'replace_connect_proposals');
    assertEquals(writes.map((w) => (rpcBody(w).p_rows as unknown[]).length), [1000, 1000, 500]);
    assertEquals(writes.map((w) => rpcBody(w).p_last), [false, false, true]);
    assertEquals((rpcBody(writes[0]).p_rows as Array<Record<string, unknown>>)[0], { outcome: 'send', pmoIds: ['c00000'], externalIds: [], snapshot: {} });
  });

  it('a kind with nothing to propose still marks itself proposed', async () => {
    const { calls } = await tick({ run: NEW_RUN({ state: 'proposing', cursor: DONE }) });
    const writes = rpcCall(calls, 'replace_connect_proposals');
    assertEquals([writes.length, rpcBody(writes[0]).p_last, (rpcBody(writes[0]).p_rows as unknown[]).length], [1, true, 0]);
  });

  it('a link carries the ERP fields it will apply, and a review says why in plain words', async () => {
    const { calls } = await tick({
      run: NEW_RUN({ state: 'proposing', cursor: DONE }), companies: 1,
      staged: [{ kind: 'party', externalId: 'Supplier:S1', role: 'vendor', name: 'Company 0', taxId: '01.234', active: true }],
    });
    const rows = rpcBody(rpcCall(calls, 'replace_connect_proposals')[0]).p_rows as Array<Record<string, unknown>>;
    assertEquals(rows, [{ outcome: 'link', pmoIds: ['c00000'], externalIds: ['Supplier:S1'], key: 'name',
      snapshot: { name: 'Company 0', taxId: '01.234', code: null, role: 'vendor' } }]);
  });

  it('Minor 8 a tick whose ERP read fails counts one failure by class and does not throw', async () => {
    const { result, calls } = await tick({ suppliers: 10, fail: new Response('down', { status: 503 }) });
    assertEquals(result, { state: 'more' });
    const f = rpcCall(calls, 'fail_connect_run')[0];
    assertEquals([rpcBody(f).p_org_id, rpcBody(f).p_run_id, rpcBody(f).p_error_class, rpcBody(f).p_fatal], [ORG, 'run-a', 'external-unreachable', false]);
    assertEquals(JSON.stringify(f.bodyText).includes(ERP), false);
  });

  it('Minor 8 the database ending the run on the third failure is reported as failed', async () => {
    const { result } = await tick({ suppliers: 10, fail: new Response('down', { status: 503 }), rpc: { fail_connect_run: () => jsonResponse('failed') } });
    assertEquals(result, { state: 'failed' });
  });

  it('Minor 8 a run older than its budget ends at once, without touching the ERP', async () => {
    const { result, calls } = await tick({ run: NEW_RUN({ started_at: new Date(Date.now() - 25 * 3600_000).toISOString() }), suppliers: 10, rpc: { fail_connect_run: () => jsonResponse('failed') } });
    assertEquals(result, { state: 'failed' });
    assertEquals(erpCalls(calls).length, 0);
    const f = rpcCall(calls, 'fail_connect_run')[0];
    assertEquals([rpcBody(f).p_error_class, rpcBody(f).p_fatal], ['budget-exceeded', true]);
  });
});

describe('ECA2-T13 the sweep cycle runs the connect pass for every org and survives one failing', () => {
  it('records a connect error for the org that failed and still runs the next org', async () => {
    const seen: string[] = [];
    const bind = (orgId: string) => ({ orgId, bindingId: `b-${orgId}`, siteUrl: 'https://erp.example.com', secretRef: 'r', company: 'C', config: {}, versionMajor: 16, activatedAt: 'x', ownedDomains: [], lastFullSweepAt: null });
    const cycle = await runErpSweepCycle({
      listEmployingOrgs: () => Promise.resolve([bind('o1'), bind('o2')]),
      reconcileOrgOutbox: () => Promise.resolve({ errors: [] } as never),
      sweepOrgDoctypes: () => Promise.resolve({ applied: 0 }),
      feedOrgLedgers: () => Promise.resolve({ gl: 0, ple: 0 } as never),
      refreshOrgAccounting: () => Promise.resolve({}),
      advanceConnectRun: (o) => { seen.push(o.orgId); return o.orgId === 'o1' ? Promise.reject(new Error('boom')) : Promise.resolve({ state: 'more' }); },
    }, undefined, 'money-only');
    assertEquals(seen, ['o1', 'o2']);
    assertEquals(cycle.perOrg[0].errors, ['connect:boom']);
    assertEquals(cycle.perOrg[1].errors, []);
  });
});
