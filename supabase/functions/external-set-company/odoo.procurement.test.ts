/**
 * external-set-company — the Odoo purchasing setup verbs (#1505 P2-T8/T9, FR-OPP-001, FR-OPP-093, OQ-OPP-6, PQ-12): `employ-domain` with
 * `domain: 'procurement'`, and the payment journal in `propose-config` / `save-defaults`. Real handler from ./index.ts; Supabase mocked
 * over fetch. Odoo is never called: the verbs read the mirror and write through the actor-checked RPCs (0505, 0509).
 */
import { afterAll, describe, it } from '@std/testing/bdd';
import { assertEquals } from '@std/assert';
import { handleSetCompanyRequest, setTestJwks } from './index.ts';
import {
  createAuthedRequest, createJwtAuthority, createTestJwksResolver, installEdgeEnv, jsonResponse, rpcCall,
  supabaseRpc, supabaseSelect, withFetchMock, type FetchCall, type MockRoute,
} from '../_shared/testing/edgeTestKit.ts';

const env = installEdgeEnv();
const auth = await createJwtAuthority(env.SUPABASE_URL);
setTestJwks(createTestJwksResolver(auth));
afterAll(() => env.restore());

const one = (body: unknown) => jsonResponse(body, { headers: { 'content-type': 'application/vnd.pgrst.object+json' } });
const none = () => new Response('null', { status: 200, headers: { 'content-type': 'application/json' } });
const pgError = (code: string, message: string) => jsonResponse({ code, message, details: null, hint: null }, { status: 400 });

const journal = (id: number, code: string, type: string, name = `Journal ${code}`) => ({ external_id: String(id), code, name, attrs: { type } });
interface Opts { role?: string; operator?: boolean; journals?: Array<ReturnType<typeof journal>>; config?: Record<string, unknown>; rpc?: Record<string, (c: FetchCall) => Response> }
function routes(o: Opts): MockRoute[] {
  const rpc = (fn: string) => supabaseRpc(fn, o.rpc?.[fn] ?? (() => jsonResponse(null)));
  return [
    supabaseSelect('profiles', () => one({ org_id: 'org-1', role: o.role ?? 'Admin' })),
    supabaseSelect('platform_operators', () => (o.operator ? one({ user_id: 'user-1' }) : none())),
    supabaseRpc('actor_authorization_state', () => jsonResponse({ active: true })),
    supabaseSelect('external_org_bindings', () => one({ config: o.config ?? {} })),
    supabaseSelect('external_master_records', () => jsonResponse(o.journals ?? [])),
    rpc('admin_change_domain_ownership'), rpc('set_odoo_payment_journal_default'), rpc('set_odoo_customer_advance_account'),
  ];
}
async function call(body: Record<string, unknown>, o: Opts = {}) {
  const jwt = await auth.mintJwt({ sub: 'user-1' });
  return await withFetchMock(routes(o), async ({ calls }) => {
    const res = await handleSetCompanyRequest(createAuthedRequest('http://edge.test/set-company', { tier: 'odoo', ...body }, jwt));
    return { res, json: JSON.parse(await res.text()) as Record<string, unknown>, calls };
  });
}

describe('Odoo router — employ-domain (P2-T9)', () => {
  it('FR-OPP-001 an Admin employs procurement under odoo through the guarded verb, as the verified actor', async () => {
    const r = await call({ setupAction: 'employ-domain', domain: 'procurement' });
    assertEquals(r.res.status, 200);
    assertEquals(r.json, { ok: true });
    assertEquals(rpcCall(r.calls, 'admin_change_domain_ownership').map((c) => c.bodyJson),
      [{ p_org_id: 'org-1', p_external_tier: 'odoo', p_domain: 'procurement', p_action: 'employ', p_actor_id: 'user-1' }]);
  });

  it('a platform Operator may employ; every other role is refused before the verb', async () => {
    assertEquals((await call({ setupAction: 'employ-domain', domain: 'procurement' }, { role: 'Engineer', operator: true })).res.status, 200);
    for (const role of ['Finance', 'Executive', 'Project Manager', 'Engineer']) {
      const r = await call({ setupAction: 'employ-domain', domain: 'procurement' }, { role });
      assertEquals(r.res.status, 403, role);
      assertEquals(rpcCall(r.calls, 'admin_change_domain_ownership').length, 0, role);
    }
  });

  it('only procurement is employable under odoo here: another domain is a bad request and reaches no verb', async () => {
    for (const domain of ['revenue', 'timesheets', 'companies', 42, undefined]) {
      const r = await call({ setupAction: 'employ-domain', domain });
      assertEquals(r.res.status, 400, String(domain));
      assertEquals(rpcCall(r.calls, 'admin_change_domain_ownership').length, 0);
    }
  });

  it('the database\'s plain refusals come back as config-rejected with their own words, and a stale snapshot says what to do', async () => {
    const refuse = (message: string) => ({ admin_change_domain_ownership: () => pgError('P0001', message) });
    const erp = await call({ setupAction: 'employ-domain', domain: 'procurement' }, { rpc: refuse('an ERPNext connection is active for this organization') });
    assertEquals(erp.res.status, 422);
    assertEquals(erp.json, { error: 'config-rejected', message: 'an ERPNext connection is active for this organization' });
    const missing = await call({ setupAction: 'employ-domain', domain: 'procurement' }, { rpc: refuse('Odoo is missing account.payment') });
    assertEquals(missing.res.status, 422);
    assertEquals(missing.json.message, 'Odoo is missing account.payment. Check the connection again, then retry.');
    const forbidden = await call({ setupAction: 'employ-domain', domain: 'procurement' }, { rpc: { admin_change_domain_ownership: () => pgError('42501', 'insufficient privilege') } });
    assertEquals(forbidden.res.status, 403);
  });
});

describe('Odoo router — the payment journal in propose-config / save-defaults (P2-T8, OQ-OPP-6)', () => {
  const mirror = (calls: FetchCall[]) => calls.find((c) => c.url.pathname === '/rest/v1/external_master_records')!;

  it('FR-OPP-093 exactly one bank journal is proposed outright; the read is this org\'s live Odoo journals; Odoo is not called', async () => {
    const r = await call({ setupAction: 'propose-config' }, { journals: [journal(11, 'BNK1', 'bank'), journal(13, 'BILL', 'purchase')] });
    assertEquals(r.res.status, 200);
    assertEquals(r.json, { journal: { state: 'proposed', proposed: { id: '11', code: 'BNK1', name: 'Journal BNK1' }, candidates: [{ id: '11', code: 'BNK1', name: 'Journal BNK1', type: 'bank' }], current: null } });
    const read = mirror(r.calls);
    assertEquals([read.url.searchParams.get('org_id'), read.url.searchParams.get('external_tier'), read.url.searchParams.get('kind'), read.url.searchParams.get('active'), read.url.searchParams.get('tombstoned_at')],
      ['eq.org-1', 'eq.odoo', 'eq.journal', 'eq.true', 'is.null']);
  });

  it('one bank and one cash journal still propose the bank one; both are candidates', async () => {
    const r = await call({ setupAction: 'propose-config' }, { journals: [journal(11, 'BNK1', 'bank'), journal(12, 'CSH1', 'cash')] });
    const j = r.json.journal as { state: string; proposed: { id: string }; candidates: Array<{ id: string }> };
    assertEquals([j.state, j.proposed.id, j.candidates.map((c) => c.id)], ['proposed', '11', ['11', '12']]);
  });

  it('two bank journals are a choice, none is none', async () => {
    const two = await call({ setupAction: 'propose-config' }, { journals: [journal(11, 'BNK1', 'bank'), journal(14, 'BNK2', 'bank')] });
    assertEquals((two.json.journal as { state: string; proposed?: unknown }).state, 'choose');
    assertEquals((two.json.journal as { proposed?: unknown }).proposed, undefined);
    const nothing = await call({ setupAction: 'propose-config' }, { journals: [journal(13, 'BILL', 'purchase')] });
    assertEquals(nothing.json.journal, { state: 'none', candidates: [], current: null });
  });

  it('a default already chosen is reported as current, and is not proposed again', async () => {
    const r = await call({ setupAction: 'propose-config' }, { journals: [journal(11, 'BNK1', 'bank'), journal(14, 'BNK2', 'bank')], config: { default_payment_journal_id: 14 } });
    const j = r.json.journal as { state: string; current: { id: string; code: string } };
    assertEquals([j.state, j.current.id, j.current.code], ['set', '14', 'BNK2']);
  });

  it('Admin and Finance may propose and save; other roles are refused', async () => {
    for (const role of ['Admin', 'Finance']) {
      assertEquals((await call({ setupAction: 'propose-config' }, { role })).res.status, 200, role);
      assertEquals((await call({ setupAction: 'save-defaults', default_payment_journal_id: '11' }, { role })).res.status, 200, role);
    }
    for (const role of ['Executive', 'Project Manager', 'Engineer']) {
      assertEquals((await call({ setupAction: 'propose-config' }, { role })).res.status, 403, role);
      const save = await call({ setupAction: 'save-defaults', default_payment_journal_id: '11' }, { role });
      assertEquals(save.res.status, 403, role);
      assertEquals(rpcCall(save.calls, 'set_odoo_payment_journal_default').length, 0, role);
    }
    const operator = await call({ setupAction: 'save-defaults', default_payment_journal_id: '11' }, { role: 'Engineer', operator: true });
    assertEquals(operator.res.status, 200, 'the payment-journal setter still permits a platform Operator');
    assertEquals(rpcCall(operator.calls, 'set_odoo_payment_journal_default').map((c) => c.bodyJson), [
      { p_org_id: 'org-1', p_actor_id: 'user-1', p_journal_id: '11' },
    ]);
  });

  it('save-defaults writes the journal through the actor-checked setter as the verified caller', async () => {
    const r = await call({ setupAction: 'save-defaults', default_payment_journal_id: 11 }, { role: 'Finance' });
    assertEquals(r.json, { saved: true });
    assertEquals(rpcCall(r.calls, 'set_odoo_payment_journal_default').map((c) => c.bodyJson), [{ p_org_id: 'org-1', p_actor_id: 'user-1', p_journal_id: '11' }]);
  });

  it('save-defaults writes the customer-advance account with the verified JWT subject, ignoring a payload actor', async () => {
    const r = await call({ setupAction: 'save-defaults', customer_advance_account_ref: 'account.account:210', actor_id: 'user-attacker' }, { role: 'Finance' });
    assertEquals(r.res.status, 200);
    assertEquals(r.json, { saved: true });
    assertEquals(rpcCall(r.calls, 'set_odoo_customer_advance_account').map((c) => c.bodyJson), [{
      p_org_id: 'org-1', p_actor_id: 'user-1', p_account_ref: 'account.account:210',
    }]);
  });

  it('the database authority rejects an Operator for the new customer-advance account field', async () => {
    for (const role of ['Admin', 'Finance']) {
      const r = await call({ setupAction: 'save-defaults', customer_advance_account_ref: 'account.account:210' }, { role });
      assertEquals(r.res.status, 200, role);
    }
    for (const role of ['Executive', 'Project Manager', 'Engineer']) {
      const r = await call({ setupAction: 'save-defaults', customer_advance_account_ref: 'account.account:210' }, { role });
      assertEquals(r.res.status, 403, role);
      assertEquals(rpcCall(r.calls, 'set_odoo_customer_advance_account').length, 0, role);
    }
    const operator = await call({ setupAction: 'save-defaults', customer_advance_account_ref: 'account.account:210' }, {
      role: 'Engineer', operator: true,
      rpc: { set_odoo_customer_advance_account: () => pgError('42501', 'current authority required') },
    });
    assertEquals(operator.res.status, 403);
    assertEquals(rpcCall(operator.calls, 'set_odoo_customer_advance_account').length, 1, 'the field-specific setter enforces its own Admin/Finance rule');
  });

  it('a malformed customer-advance account reference is rejected before the setter', async () => {
    for (const ref of [undefined, '', 210, '210', 'account.move:210', 'account.account:0', 'account.account:210;drop']) {
      const r = await call({ setupAction: 'save-defaults', customer_advance_account_ref: ref });
      assertEquals(r.res.status, 400, String(ref));
      assertEquals(rpcCall(r.calls, 'set_odoo_customer_advance_account').length, 0, String(ref));
    }
  });

  it('the customer-advance setter returns its plain refusal and authority errors', async () => {
    const no = await call({ setupAction: 'save-defaults', customer_advance_account_ref: 'account.account:210' }, {
      rpc: { set_odoo_customer_advance_account: () => pgError('P0001', 'customer-advance account is not active in the bound Odoo company') },
    });
    assertEquals(no.res.status, 409);
    assertEquals(no.json, { error: 'REFUSED', message: 'customer-advance account is not active in the bound Odoo company' });
    const forbidden = await call({ setupAction: 'save-defaults', customer_advance_account_ref: 'account.account:210' }, {
      rpc: { set_odoo_customer_advance_account: () => pgError('42501', 'current authority required') },
    });
    assertEquals(forbidden.res.status, 403);
  });

  it('a missing or malformed journal id is a bad request and reaches no setter', async () => {
    for (const id of [undefined, '', 'abc', '1; drop', -1, 1.5, {}]) {
      const r = await call({ setupAction: 'save-defaults', default_payment_journal_id: id });
      assertEquals(r.res.status, 400, String(id));
      assertEquals(rpcCall(r.calls, 'set_odoo_payment_journal_default').length, 0);
    }
  });

  it('the setter\'s refusals are plain: not a bank or cash journal is 409, authority is 403', async () => {
    const no = await call({ setupAction: 'save-defaults', default_payment_journal_id: '13' }, { rpc: { set_odoo_payment_journal_default: () => pgError('P0001', 'not a bank or cash journal of this connection') } });
    assertEquals(no.res.status, 409);
    assertEquals(no.json, { error: 'REFUSED', message: 'not a bank or cash journal of this connection' });
    const forbidden = await call({ setupAction: 'save-defaults', default_payment_journal_id: '11' }, { rpc: { set_odoo_payment_journal_default: () => pgError('42501', 'current authority required') } });
    assertEquals(forbidden.res.status, 403);
  });
});
