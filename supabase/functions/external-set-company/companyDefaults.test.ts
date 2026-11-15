/**
 * external-set-company — company defaults set from PMO (#1599 ECX-3, AC-ECX-020/021). Real handler from ./index.ts; Supabase and
 * the ERP mocked over fetch, the ERP answering as the bed did (`__fixtures__/companyDefaults.json`).
 */
import { afterAll, describe, it } from '@std/testing/bdd';
import { assertEquals, assertMatch } from '@std/assert';
import { handleSetCompanyRequest, setTestJwks } from './index.ts';
import { PENDING_SAVE_WINDOW_MS } from './companyDefaults.ts';
import {
  createAuthedRequest, createJwtAuthority, createTestJwksResolver, installEdgeEnv, jsonResponse, rpcCall, restCall,
  supabaseRpc, supabaseSelect, withFetchMock, type FetchCall, type MockRoute,
} from '../_shared/testing/edgeTestKit.ts';
import fixture from '../../../pmo-portal/src/lib/adapterSeam/erpnext/__fixtures__/companyDefaults.json' with { type: 'json' };

const env = installEdgeEnv();
Deno.env.set('SUPABASE_ANON_KEY', 'test-anon-key');
const auth = await createJwtAuthority(env.SUPABASE_URL);
setTestJwks(createTestJwksResolver(auth));
afterAll(() => { env.restore(); Deno.env.delete('SUPABASE_ANON_KEY'); });

type Case = { label: string; request: { method: string; path: string; body: Record<string, unknown> | null }; status: number; response: Record<string, unknown> };
const bedCase = (label: string) => (fixture as { cases: Case[] }).cases.find((c) => c.label === label)!;
const COMPANY = 'ECX Probe Co';
const ERP = 'erp.example.com';
const one = (body: unknown) => jsonResponse(body, { headers: { 'content-type': 'application/vnd.pgrst.object+json' } });
const none = () => new Response('null', { status: 200, headers: { 'content-type': 'application/json' } });
const pgError = (code: string, message: string) => jsonResponse({ code, message, details: null, hint: null }, { status: 400 });

const ACCOUNTS: Record<string, Record<string, unknown>> = {
  'Creditors - EPC': { name: 'Creditors - EPC', company: COMPANY, is_group: 0, disabled: 0, root_type: 'Liability', account_type: 'Payable' },
  'Debtors - EPC': { name: 'Debtors - EPC', company: COMPANY, is_group: 0, disabled: 0, root_type: 'Asset', account_type: 'Receivable' },
  // the mirror is stale: PMO's chart says this is ours, the ERP refuses it (fixture "payable<-other company acct")
  'Creditors - OTH': { name: 'Creditors - OTH', company: COMPANY, is_group: 0, disabled: 0, root_type: 'Liability', account_type: 'Payable' },
};

interface Opts { role?: string; featureEnabled?: boolean; put?: Case | 'down'; request?: () => Response; tier?: string; record?: () => Response; pending?: boolean }
function routes(o: Opts, state: { company: Record<string, unknown> }): MockRoute[] {
  const put = o.put ?? bedCase('payable<-Payable (accept)');
  return [
    supabaseSelect('profiles', () => one({ org_id: 'org-1', role: o.role ?? 'Admin' })),
    supabaseSelect('platform_operators', () => none()),
    supabaseRpc('actor_authorization_state', () => jsonResponse({ active: true })),
    supabaseRpc('service_feature_enabled', () => jsonResponse(o.featureEnabled ?? true)),
    supabaseSelect('external_org_bindings', () => one({
      site_url: `https://${ERP}`, secret_ref: 'ref', status: 'active', activated_at: '2026-11-01T00:00:00Z', config: { company: COMPANY } })),
    supabaseRpc('read_vault_secret', () => jsonResponse('key:secret')),
    supabaseRpc('request_company_defaults', (c) => o.request?.() ?? jsonResponse({
      id: 'req-1', idempotencyKey: 'setup:company-defaults:b:x', company: COMPANY,
      values: Object.fromEntries(Object.entries((c.bodyJson as { p_values: Record<string, string> }).p_values).map(([k, v]) => [k, v.trim()])) })),
    supabaseRpc('record_company_defaults_result', (c) => o.record?.() ?? jsonResponse((c.bodyJson as { p_rejection: unknown }).p_rejection === null ? { state: 'applied' } : { state: 'rejected' })),
    supabaseRpc('replace_erp_cost_centre_mirror', () => jsonResponse(2)),
    supabaseSelect('erp_company_default_requests', () => jsonResponse(o.pending ? [{ id: 'req-9' }] : [])),
    supabaseSelect('erp_account_mirror', () => jsonResponse([
      { erp_name: 'Creditors - EPC', company: COMPANY, is_group: false, disabled: false, root_type: 'Liability', account_type: 'Payable' },
      { erp_name: 'Cash - EPC', company: COMPANY, is_group: false, disabled: false, root_type: 'Asset', account_type: 'Cash' },
      { erp_name: 'Probe Bank A - EPC', company: COMPANY, is_group: false, disabled: false, root_type: 'Asset', account_type: 'Bank' },
      { erp_name: 'Cost of Goods Sold - EPC', company: COMPANY, is_group: false, disabled: false, root_type: 'Expense', account_type: 'Cost of Goods Sold' },
      { erp_name: 'Debtors - EPC', company: COMPANY, is_group: false, disabled: false, root_type: 'Asset', account_type: 'Receivable' },
      { erp_name: 'Indirect Expenses - EPC', company: COMPANY, is_group: true, disabled: false, root_type: 'Expense', account_type: null },
    ])),
    supabaseSelect('erp_cost_centre_mirror', () => jsonResponse([
      { erp_name: 'Main - EPC', company: COMPANY, is_group: false, disabled: false },
      { erp_name: 'ECX Probe Co - EPC', company: COMPANY, is_group: true, disabled: false }])),
    { label: 'erp-account', method: 'GET', host: ERP, pathname: /^\/api\/resource\/Account\//, response: (c) => {
      const a = ACCOUNTS[decodeURIComponent(c.url.pathname.slice('/api/resource/Account/'.length))];
      return a ? jsonResponse({ data: a }) : jsonResponse({}, { status: 404 });
    } },
    { label: 'erp-cost-centres', method: 'GET', host: ERP, pathname: '/api/resource/Cost%20Center', response: () => jsonResponse({ data: [
      { name: 'Main - EPC', is_group: 0, disabled: 0 }, { name: 'ECX Probe Co - EPC', is_group: 1, disabled: 0 }] }) },
    { label: 'erp-company-get', method: 'GET', host: ERP, pathname: `/api/resource/Company/${encodeURIComponent(COMPANY)}`, response: () => jsonResponse({ data: state.company }) },
    { label: 'erp-company-put', method: 'PUT', host: ERP, pathname: `/api/resource/Company/${encodeURIComponent(COMPANY)}`, response: () => {
      if (put === 'down') return new Response('unavailable', { status: 503 });
      if (put.status === 200) state.company = { ...state.company, ...(put.response as { data: Record<string, unknown> }).data };
      return jsonResponse(put.response, { status: put.status });
    } },
  ];
}

async function call(body: Record<string, unknown>, o: Opts = {}) {
  const jwt = await auth.mintJwt({ sub: 'user-1' });
  const state = { company: { name: COMPANY, default_payable_account: null, default_expense_account: null, default_cash_account: null, default_bank_account: null, cost_center: null } as Record<string, unknown> };
  return await withFetchMock(routes(o, state), async ({ calls }) => {
    const res = await handleSetCompanyRequest(createAuthedRequest('http://edge.test/set-company', { tier: o.tier ?? 'erpnext', ...body }, jwt));
    return { res, json: JSON.parse(await res.text()) as Record<string, unknown>, calls, jwt };
  });
}
const erpCalls = (calls: FetchCall[]) => calls.filter((c) => c.url.host === ERP);
const puts = (calls: FetchCall[]) => erpCalls(calls).filter((c) => c.method === 'PUT');
const resultArgs = (calls: FetchCall[]) => rpcCall(calls, 'record_company_defaults_result').map((c) => c.bodyJson as Record<string, unknown>);

describe('company defaults set from PMO', () => {
  for (const role of ['Admin', 'Finance']) {
    it(`AC-ECX-020 ${role} sets the payable default: the request runs as the caller, one PUT, and only the read-back is recorded`, async () => {
      const r = await call({ setupAction: 'set-company-defaults', values: { payable: 'Creditors - EPC' }, orgId: 'org-other' }, { role });
      assertEquals(r.res.status, 200);
      assertEquals(r.json.written, ['payable']);
      const req = rpcCall(r.calls, 'request_company_defaults')[0];
      assertEquals(req.headers.get('authorization'), `Bearer ${r.jwt}`);   // the database re-asserts role, membership and org
      assertEquals(req.bodyJson, { p_tier: 'erpnext', p_values: { payable: 'Creditors - EPC' } });
      assertEquals(puts(r.calls).map((c) => c.bodyJson), [bedCase('payable<-Payable (accept)').request.body]);
      const [rec] = resultArgs(r.calls);
      assertEquals([rec.p_org_id, rec.p_request_id, rec.p_rejection], ['org-1', 'req-1', null]);
      assertEquals((rec.p_read_back as Record<string, unknown>).payable, 'Creditors - EPC');
      assertEquals(JSON.stringify(r.calls.map((c) => c.url.toString())).includes('org-other'), false);
    });
  }

  it('AC-ECX-021 a Project Manager is refused before the database or the ERP is asked', async () => {
    const r = await call({ setupAction: 'set-company-defaults', values: { payable: 'Creditors - EPC' } }, { role: 'Project Manager' });
    assertEquals(r.res.status, 403);
    assertEquals(rpcCall(r.calls, 'request_company_defaults').length, 0);
    assertEquals(erpCalls(r.calls).length, 0);
  });

  it('AC-ECX-021 a choice the database refuses reaches the ERP not at all, and the reason is shown', async () => {
    const r = await call({ setupAction: 'set-company-defaults', values: { payable: 'Debtors - EPC' } },
      { request: () => pgError('22023', 'Debtors - EPC is not a payable account, so it cannot be the vendor payable account.') });
    assertEquals(r.res.status, 400);
    assertMatch(String(r.json.message), /not a payable account/);
    assertEquals(erpCalls(r.calls).length, 0);
  });

  it('AC-ECX-020 a wrong-type account the stale mirror let through is refused by the ERP record check, with no PUT; the refusal is recorded', async () => {
    const r = await call({ setupAction: 'set-company-defaults', values: { payable: 'Debtors - EPC' } });
    assertEquals(r.res.status, 422);
    assertEquals(puts(r.calls).length, 0);
    assertMatch(String(resultArgs(r.calls)[0].p_rejection), /not a payable account/);
  });

  it('AC-ECX-020 the ERP\'s own refusal (417) is recorded in plain words and nothing is recorded as set', async () => {
    const r = await call({ setupAction: 'set-company-defaults', values: { payable: 'Creditors - OTH' } }, { put: bedCase('payable<-other company acct') });
    assertEquals(r.res.status, 422);
    const [rec] = resultArgs(r.calls);
    assertEquals(rec.p_read_back, null);
    assertMatch(String(rec.p_rejection), /does not belong to company/);
    assertEquals(/<strong>/.test(String(r.json.message)), false);
  });

  it('AC-ECX-020 a refusal because the ERP company changed since PMO read it (bed: 417 TimestampMismatchError) is recorded and says reload', async () => {
    const r = await call({ setupAction: 'set-company-defaults', values: { payable: 'Creditors - EPC' } }, { put: bedCase('stale modified') });
    assertEquals([r.res.status, r.json.error], [422, 'config-rejected']);
    const reload = 'The company accounts were changed in the ERP after PMO read them, so nothing was saved. Reload and try again.';
    assertEquals(r.json.message, reload);
    const [rec] = resultArgs(r.calls);
    assertEquals([rec.p_read_back, rec.p_rejection], [null, reload]);
  });

  it('AC-ECX-021 a request overtaken by a newer one for the connection is refused when its read-back is recorded, in plain words', async () => {
    const newer = 'A newer change to the company accounts was saved for this connection, so this one was not recorded.';
    const r = await call({ setupAction: 'set-company-defaults', values: { payable: 'Creditors - EPC' } },
      { record: () => jsonResponse({ state: 'rejected', reason: newer }) });
    assertEquals([r.res.status, r.json.error, r.json.message], [422, 'config-rejected', newer]);
  });

  it('fail closed: an unreachable ERP records nothing (the request stays pending) and says so', async () => {
    const r = await call({ setupAction: 'set-company-defaults', values: { payable: 'Creditors - EPC' } }, { put: 'down' });
    assertEquals(r.res.status, 502);
    assertEquals(resultArgs(r.calls).length, 0);
  });

  it('nothing is written while ERP sync is off for the org', async () => {
    const r = await call({ setupAction: 'set-company-defaults', values: { payable: 'Creditors - EPC' } }, { featureEnabled: false });
    assertEquals([r.res.status, r.json.error], [409, 'feature_off']);
    assertEquals(rpcCall(r.calls, 'request_company_defaults').length, 0);
    assertEquals(erpCalls(r.calls).length, 0);
  });

  it('a tier without a writer yet is refused before the database or the ERP is asked', async () => {
    const r = await call({ setupAction: 'set-company-defaults', values: { payable: 'x' } }, { tier: 'odoo' });
    assertEquals(r.res.status, 400);
    assertEquals(rpcCall(r.calls, 'request_company_defaults').length, 0);
    assertEquals(erpCalls(r.calls).length, 0);
  });

  it('the options read lists the company\'s cost centres from the ERP into the mirror and offers each slot only accounts of its kind', async () => {
    const r = await call({ setupAction: 'company-defaults-options' }, { role: 'Finance' });
    assertEquals(r.res.status, 200);
    const mirror = rpcCall(r.calls, 'replace_erp_cost_centre_mirror')[0].bodyJson as Record<string, unknown>;
    assertEquals([mirror.p_org_id, mirror.p_company], ['org-1', COMPANY]);
    assertEquals(mirror.p_rows, [{ name: 'Main - EPC', isGroup: false, disabled: false }, { name: 'ECX Probe Co - EPC', isGroup: true, disabled: false }]);
    const filters = new URL(erpCalls(r.calls).find((c) => c.url.pathname === '/api/resource/Cost%20Center')!.url).searchParams.get('filters');
    assertEquals(JSON.parse(filters!), [['company', '=', COMPANY]]);
    assertEquals(r.json.options, {
      payable: ['Creditors - EPC'], cash: ['Cash - EPC'], bank: ['Probe Bank A - EPC'], expense: ['Cost of Goods Sold - EPC'], cost_centre: ['Main - EPC'],
    });
    const reads = restCall(r.calls, 'erp_account_mirror');
    assertEquals(reads[0].url.searchParams.get('org_id'), 'eq.org-1');
    assertEquals(reads[0].url.searchParams.get('company'), `eq.${COMPANY}`);
    assertEquals(erpCalls(r.calls).every((c) => c.method === 'GET'), true);
    assertEquals(r.json.pending, false);
  });

  it('the options read says when a request for the connection is still pending, so Save waits for it', async () => {
    const r = await call({ setupAction: 'company-defaults-options' }, { pending: true });
    assertEquals([r.res.status, r.json.pending], [200, true]);
    const [read] = restCall(r.calls, 'erp_company_default_requests');
    assertEquals([read.url.searchParams.get('org_id'), read.url.searchParams.get('external_tier'), read.url.searchParams.get('state')],
      ['eq.org-1', 'eq.erpnext', 'eq.pending']);
    assertEquals(read.url.searchParams.get('company'), `eq.${COMPANY}`);
    const since = Date.parse(read.url.searchParams.get('requested_at')!.replace(/^gte\./, ''));
    assertEquals(Math.abs(Date.now() - PENDING_SAVE_WINDOW_MS - since) < 60_000, true);   // a long-stuck request does not count
  });
});
