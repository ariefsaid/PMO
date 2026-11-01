/**
 * AC-ODC-051 (layer B): a project links to a cost account of the chosen plan on the stock bed, and Odoo's Project application
 * is never called. Gated on the dependency, never on CI: ODOO_BED_URL, ODOO_BED_DB and ODOO_BED_KEY from the bed's untracked
 * env file, never printed. The bed is real: two accounts are created in a fresh analytic plan (and one in the default plan),
 * swept into the mirror by the shipped sweep, listed by the shipped `list-projects` verb, then linked by `link-project`.
 * Supabase is mocked; the accounts and the plan are removed afterwards.
 */
import { assert, assertEquals } from '@std/assert';
import { createClient } from '@supabase/supabase-js';
import { handleSetCompanyRequest, setTestJwks } from './index.ts';
import {
  createAuthedRequest, createJwtAuthority, createTestJwksResolver, installEdgeEnv, jsonResponse, rpcCall,
  supabaseRpc, supabaseSelect, withFetchMock, type FetchCall, type MockRoute,
} from '../_shared/testing/edgeTestKit.ts';
import { sweepOdooOrg } from '../_shared/odooSweep.ts';
import { bindCall } from '../../../pmo-portal/src/lib/adapterSeam/odoo/client.ts';

const BED = Deno.env.get('ODOO_BED_URL');
const DB = Deno.env.get('ODOO_BED_DB') ?? '';
const KEY = Deno.env.get('ODOO_BED_KEY') ?? '';
const realFetch = globalThis.fetch;
const PROJECT = '0b000000-0000-4000-8000-0000000000c1';
const ORG = 'org-1';

const one = (body: unknown) => jsonResponse(body, { headers: { 'content-type': 'application/vnd.pgrst.object+json' } });
const none = () => new Response('null', { status: 200, headers: { 'content-type': 'application/json' } });

Deno.test({
  name: 'AC-ODC-051 link without the Project app: the plan\'s accounts are the candidates, the link works, no project.project call',
  ignore: !BED,
  fn: async () => {
    const bed = new URL(BED!);
    const saved = ['ERPNEXT_ALLOW_LOCAL_BENCH', 'ERPNEXT_LOCAL_BENCH_ORIGINS'].map((k) => [k, Deno.env.get(k)] as const);
    const env = installEdgeEnv({ SUPABASE_URL: 'http://127.0.0.1:54321' }); // the host guard admits a local bed only on a local stack
    Deno.env.set('ERPNEXT_ALLOW_LOCAL_BENCH', '1');
    Deno.env.set('ERPNEXT_LOCAL_BENCH_ORIGINS', bed.origin);
    const call = bindCall({ baseUrl: bed.origin, apiKey: KEY, database: DB, fetchImpl: realFetch });
    const stamp = `S6-${Date.now()}`;
    const made: Array<[string, number]> = [];
    const make = async (model: string, vals: Record<string, unknown>) => { const [id] = await call<number[]>(model, 'create', { vals_list: [vals] }); made.push([model, id]); return id; };
    try {
      const plan = await make('account.analytic.plan', { name: `PMO ${stamp}` });
      const a1 = await make('account.analytic.account', { name: `${stamp} one`, code: `${stamp}-1`, plan_id: plan });
      const a2 = await make('account.analytic.account', { name: `${stamp} two`, code: `${stamp}-2`, plan_id: plan });
      const [other] = await call<Array<{ id: number }>>('account.analytic.plan', 'search_read', { domain: [['id', '!=', plan]], fields: ['id'], limit: 1 });
      const stray = other ? await make('account.analytic.account', { name: `${stamp} stray`, code: `${stamp}-X`, plan_id: other.id }) : null;

      const auth = await createJwtAuthority(env.SUPABASE_URL);
      setTestJwks(createTestJwksResolver(auth));
      const binding = { id: 'b1', site_url: bed.origin, secret_ref: 'odoo_ref', status: 'active', activated_at: '2026-11-01T00:00:00Z',
        config: { database: DB, odoo_company_id: 1, analytic_plan_id: plan } };
      const mirror: Array<Record<string, unknown>> = [];
      const cursors = new Map<string, string>();
      const routes: MockRoute[] = [
        supabaseSelect('profiles', () => one({ org_id: ORG, role: 'Admin' })),
        supabaseSelect('platform_operators', none),
        supabaseRpc('actor_authorization_state', () => jsonResponse({ active: true })),
        supabaseSelect('external_org_bindings', () => one(binding)),
        supabaseRpc('read_vault_secret', () => jsonResponse(KEY)),
        supabaseRpc('claim_erp_sweep_lock', () => jsonResponse(true)),
        supabaseRpc('release_erp_sweep_lock', () => jsonResponse(true)),
        supabaseSelect('external_sync_watermarks', (c) => {
          const v = cursors.get(c.url.searchParams.get('domain')!.replace(/^eq\./, ''));
          return jsonResponse(v === undefined ? [] : [{ watermark_cursor: v }]);
        }),
        supabaseRpc('apply_odoo_master_page', (c) => {
          const b = c.bodyJson as { p_kind: string; p_rows: Array<Record<string, unknown>>; p_cursor: string };
          cursors.set(`master:${b.p_kind}`, b.p_cursor);
          mirror.push(...b.p_rows.map((r) => ({ ...r, kind: b.p_kind })));
          return jsonResponse(b.p_rows.length);
        }),
        supabaseRpc('mark_odoo_census_seen', () => jsonResponse(null)),
        supabaseRpc('finish_odoo_census', (c) => { const b = c.bodyJson as { p_kind: string; p_cursor: string }; cursors.set(`master:${b.p_kind}`, b.p_cursor); return jsonResponse(0); }),
        supabaseRpc('merge_external_org_binding_config', () => jsonResponse(null)),
        supabaseRpc('log_audit', () => jsonResponse(null)),
        supabaseSelect('erp_connect_runs', none),
        supabaseSelect('erp_connect_census', none),
        supabaseSelect('external_master_records', (c) => {
          const kind = (c.url.searchParams.get('kind') ?? '').replace('eq.', '');
          const parent = (c.url.searchParams.get('parent_external_id') ?? '').replace('eq.', '');
          return jsonResponse(mirror.filter((r) => r.kind === kind && (!parent || r.parent_external_id === parent)).map((r) => ({ external_id: r.external_id, code: r.code, name: r.name })));
        }),
        supabaseSelect('external_project_bindings', () => jsonResponse([])),
        supabaseRpc('link_odoo_cost_account', () => jsonResponse('binding-1')),
        { label: 'odoo-bed', host: bed.host, response: (c: FetchCall) => realFetch(c.url, { method: c.method, headers: c.headers, body: c.bodyText, redirect: 'manual' }) },
      ];
      await withFetchMock(routes, async ({ calls }) => {
        const sc = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
        const swept = await sweepOdooOrg(sc, ORG, { maxCalls: 300, timeBudgetMs: 120_000 });
        assert('ok' in swept, 'the sweep ran');

        const jwt = await auth.mintJwt({ sub: 'user-1' });
        const listed = await handleSetCompanyRequest(createAuthedRequest('http://edge.test/set-company', { tier: 'odoo', setupAction: 'list-projects' }, jwt));
        const body = await listed.json() as { planId: number; accounts: Array<{ id: string }> };
        assertEquals(body.planId, plan);
        assertEquals(body.accounts.map((a) => a.id).sort(), [String(a1), String(a2)].sort(), 'only the chosen plan\'s accounts are candidates');
        if (stray !== null) assert(!body.accounts.some((a) => a.id === String(stray)), 'an account of another plan is not a candidate');

        const linked = await handleSetCompanyRequest(createAuthedRequest('http://edge.test/set-company', { tier: 'odoo', setupAction: 'link-project', projectId: PROJECT, accountId: String(a1) }, jwt));
        assertEquals(linked.status, 200);
        assertEquals(rpcCall(calls, 'link_odoo_cost_account')[0].bodyJson, { p_org_id: ORG, p_actor_id: 'user-1', p_project_id: PROJECT, p_account_id: String(a1) });
        assertEquals(calls.filter((c) => c.url.host === bed.host && c.url.pathname.includes('/project.project/')).length, 0, 'Odoo\'s Project application is never called');
      });
    } finally {
      for (const [model, id] of made.reverse()) await call(model, 'unlink', { ids: [id] }).catch(() => undefined);
      env.restore();
      for (const [k, v] of saved) v === undefined ? Deno.env.delete(k) : Deno.env.set(k, v);
    }
  },
});
