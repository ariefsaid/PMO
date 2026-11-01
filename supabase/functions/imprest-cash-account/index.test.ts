/**
 * imprest-cash-account edge fn — Deno unit tests (#1515 S6, AC-IMP-071). The REAL handler (./index.ts) with mocked fetch
 * via edgeTestKit: a Cash account of the bound company is saved; anything else is refused with nothing written; only an
 * active Admin/Finance member may bind; a tier with no validator is refused.
 */
import { describe, it, afterAll } from '@std/testing/bdd';
import { assertEquals } from '@std/assert';
import { handleImprestCashAccountRequest, setTestJwks } from './index.ts';
import {
  createJwtAuthority, installEdgeEnv, withFetchMock, supabaseRpc, supabaseSelect, restCall, rpcCall, jsonResponse,
  createAuthedRequest, createTestJwksResolver, erp, type MockRoute,
} from '../_shared/testing/edgeTestKit.ts';

const env = installEdgeEnv();
const originalResolveDns = Deno.resolveDns;
Deno.resolveDns = ((_hostname: string, recordType: string) => {
  if (recordType === 'A') return Promise.resolve(['8.8.8.8']);
  if (recordType === 'AAAA') return Promise.resolve(['2001:4860:4860::8888']);
  return Promise.reject(new Error('unexpected DNS query'));
}) as typeof Deno.resolveDns;
const auth = await createJwtAuthority(env.SUPABASE_URL);
setTestJwks(createTestJwksResolver(auth));
afterAll(() => { env.restore(); Deno.resolveDns = originalResolveDns; });

const FLOAT = '15150000-0000-0000-0000-0000000000d1';
const ACCOUNT = 'Site Cash F - ACME';
const single = { headers: { 'content-type': 'application/vnd.pgrst.object+json' } };

const patchFloat = (onWrite: () => void): MockRoute => ({
  label: 'supabase-update-imprest_floats', method: 'PATCH', pathname: '/rest/v1/imprest_floats',
  response: () => { onWrite(); return jsonResponse(null); },
});

/** Everything up to the account read: profile, active member, own live float, activated binding, vault secret. */
function through(role = 'Finance', tier = 'erpnext', active = true): MockRoute[] {
  return [
    supabaseSelect('profiles', () => jsonResponse({ org_id: 'org-1', role }, single)),
    supabaseRpc('actor_authorization_state', () => jsonResponse({ role, active })),
    supabaseSelect('imprest_floats', () => jsonResponse([{ id: FLOAT }])),
    supabaseSelect('external_org_bindings', () => jsonResponse([
      { external_tier: tier, secret_ref: 'vault-ref', site_url: 'https://erp.example.com', config: { company: 'ACME' } }])),
    supabaseRpc('read_vault_secret', () => jsonResponse('test-key:test-secret')),
  ];
}
const account = (doc: Record<string, unknown> | null) =>
  erp('erp.example.com', `/api/resource/Account/${encodeURIComponent(ACCOUNT)}`, () =>
    doc ? jsonResponse({ data: doc }) : jsonResponse({ exc_type: 'DoesNotExistError' }, { status: 404 }));
const audit = (sink: unknown[]) => supabaseRpc('log_audit', (call) => { sink.push(call.bodyJson); return jsonResponse(null); });

async function post(body: unknown, sub = 'user-1') {
  return handleImprestCashAccountRequest(createAuthedRequest('http://edge.test/imprest-cash-account', body, await auth.mintJwt({ sub })));
}

describe('imprest-cash-account', () => {
  it('AC-IMP-071 a Cash account of the bound company is saved and audited', async () => {
    const writes: unknown[] = []; const audits: unknown[] = [];
    await withFetchMock([...through(), account({ account_type: 'Cash', company: 'ACME', is_group: 0, disabled: 0 }),
      patchFloat(() => writes.push(1)), audit(audits)], async ({ calls }) => {
      const res = await post({ floatId: FLOAT, account: ACCOUNT });
      assertEquals(res.status, 200);
      assertEquals(await res.json(), { ok: true, floatId: FLOAT, account: ACCOUNT });
      assertEquals(restCall(calls, 'imprest_floats', 'PATCH').length, 1);
      // the float is looked up inside the caller's own org, and the write is org-scoped too
      assertEquals(restCall(calls, 'imprest_floats', 'GET')[0].url.searchParams.get('org_id'), 'eq.org-1');
      assertEquals(restCall(calls, 'imprest_floats', 'PATCH')[0].url.searchParams.get('org_id'), 'eq.org-1');
      assertEquals(JSON.parse(restCall(calls, 'imprest_floats', 'PATCH')[0].bodyText ?? '{}'), { erp_cash_account_ref: ACCOUNT });
      assertEquals((audits[0] as Record<string, unknown>).p_action, 'imprest_float.cash_account');
    });
  });

  for (const [what, doc] of [
    ['a Bank account', { account_type: 'Bank', company: 'ACME', is_group: 0, disabled: 0 }],
    ['another company\'s account', { account_type: 'Cash', company: 'OTHER', is_group: 0, disabled: 0 }],
    ['a disabled account', { account_type: 'Cash', company: 'ACME', is_group: 0, disabled: 1 }],
    ['a group account', { account_type: 'Cash', company: 'ACME', is_group: 1, disabled: 0 }],
    ['an account ERPNext does not have', null],
  ] as const) {
    it(`AC-IMP-071 ${what} is refused 422 and nothing is written`, async () => {
      const writes: unknown[] = [];
      await withFetchMock([...through(), account(doc as Record<string, unknown> | null), patchFloat(() => writes.push(1))], async ({ calls }) => {
        const res = await post({ floatId: FLOAT, account: ACCOUNT });
        assertEquals(res.status, 422);
        assertEquals((await res.json()).error, 'imprest-cash-account-unfit');
        assertEquals(writes.length + restCall(calls, 'imprest_floats', 'PATCH').length, 0);
      });
    });
  }

  for (const role of ['Engineer', 'Project Manager', 'Executive']) {
    it(`AC-IMP-071 ${role === 'Engineer' ? 'an Engineer' : 'a ' + role} is refused 403 before anything else is read`, async () => {
      await withFetchMock([supabaseSelect('profiles', () => jsonResponse({ org_id: 'org-1', role }, single))], async ({ calls }) => {
        const res = await post({ floatId: FLOAT, account: ACCOUNT });
        assertEquals(res.status, 403);
        assertEquals((await res.json()).message, 'Admin or Finance role required');
        assertEquals(restCall(calls, 'imprest_floats').length + rpcCall(calls, 'read_vault_secret').length, 0);
      });
    });
  }

  it('AC-IMP-071 a deactivated Finance member is refused 403', async () => {
    await withFetchMock(through('Finance', 'erpnext', false), async ({ calls }) => {
      assertEquals((await post({ floatId: FLOAT, account: ACCOUNT })).status, 403);
      assertEquals(restCall(calls, 'imprest_floats').length, 0);
    });
  });

  it('AC-IMP-071 a tier with no validator is refused 409, nothing written, no credentials read', async () => {
    await withFetchMock([...through('Admin', 'odoo'), patchFloat(() => { throw new Error('must not write'); })], async ({ calls }) => {
      const res = await post({ floatId: FLOAT, account: ACCOUNT });
      assertEquals(res.status, 409);
      assertEquals((await res.json()).error, 'imprest-cash-account-unsupported');
      assertEquals(rpcCall(calls, 'read_vault_secret').length + restCall(calls, 'imprest_floats', 'PATCH').length, 0);
    });
  });

  it('AC-IMP-071 a float of another org (or an archived one) is 404', async () => {
    const routes = through().map((r) => (r.label === 'supabase-select-imprest_floats' ? supabaseSelect('imprest_floats', () => jsonResponse([])) : r));
    await withFetchMock(routes, async () => {
      assertEquals((await post({ floatId: FLOAT, account: ACCOUNT })).status, 404);
    });
  });

  it('AC-IMP-071 a float that already has an account refuses a re-bind with 409 before the ERP is asked', async () => {
    const routes = through().map((r) => (r.label === 'supabase-select-imprest_floats'
      ? supabaseSelect('imprest_floats', () => jsonResponse([{ id: FLOAT, erp_cash_account_ref: 'Site Cash Old - ACME' }])) : r));
    await withFetchMock([...routes, patchFloat(() => { throw new Error('must not write'); })], async ({ calls }) => {
      const res = await post({ floatId: FLOAT, account: ACCOUNT });
      assertEquals(res.status, 409);
      assertEquals((await res.json()).error, 'imprest-cash-account-locked');
      assertEquals(rpcCall(calls, 'read_vault_secret').length + restCall(calls, 'imprest_floats', 'PATCH').length, 0);
    });
  });

  it('AC-IMP-071 the database lock (a float that already moved cash) surfaces as 409, not 500', async () => {
    const lock: MockRoute = { label: 'supabase-update-imprest_floats', method: 'PATCH', pathname: '/rest/v1/imprest_floats',
      response: () => jsonResponse({ code: 'P0001', message: 'imprest-cash-account-locked' }, { status: 400 }) };
    await withFetchMock([...through(), account({ account_type: 'Cash', company: 'ACME', is_group: 0, disabled: 0 }), lock], async () => {
      const res = await post({ floatId: FLOAT, account: ACCOUNT });
      assertEquals(res.status, 409);
      assertEquals((await res.json()).error, 'imprest-cash-account-locked');
    });
  });

  it('AC-IMP-071 an account already bound to another float of the org is refused 409', async () => {
    const taken: MockRoute = { label: 'supabase-update-imprest_floats', method: 'PATCH', pathname: '/rest/v1/imprest_floats',
      response: () => jsonResponse({ code: '23505', message: 'duplicate key value violates unique constraint "imprest_floats_cash_account_one"' }, { status: 409 }) };
    await withFetchMock([...through(), account({ account_type: 'Cash', company: 'ACME', is_group: 0, disabled: 0 }), taken], async () => {
      const res = await post({ floatId: FLOAT, account: ACCOUNT });
      assertEquals(res.status, 409);
      assertEquals((await res.json()).error, 'imprest-cash-account-taken');
    });
  });

  it('AC-IMP-071 a malformed body is 400 and an unauthenticated call is 401', async () => {
    await withFetchMock([], async () => {
      assertEquals((await post({ floatId: 'nope', account: ACCOUNT })).status, 400);
      assertEquals((await post({ floatId: FLOAT, account: '  ' })).status, 400);
      assertEquals((await handleImprestCashAccountRequest(new Request('http://edge.test/x', { method: 'POST', body: '{}' }))).status, 401);
    });
  });
});
