// #1505 O2 P6 (AC-OPP-054, FR-OPP-044/053/060/062): the vendor-payment gates for an org that employs procurement under tier `odoo`, through
// the SHIPPED handler (`./index.ts`, fetch mocked) with the fake Odoo behind the Odoo host: the case's approver, the person who entered
// the bill and a third Finance user each pay under their own JWT, with a payload that claims another `paid_by`. Only the third
// succeeds; the payer recorded is the JWT subject; a refusal leaves no outbox row and no Odoo request. A bill whose read-back is
// flagged needs-attention is refused too, and the ERPNext tier keeps the shipped gate (no bill-author arm).
//
// Every route below is a FACT about the world the handler reads; `unexpected` names any read not mocked (add a route that answers it as a
// fact; never loosen an assertion).
import { describe, it } from '@std/testing/bdd';
import { assert, assertEquals } from '@std/assert';
import {
  createJwtAuthority,
  createTestJwksResolver,
  installEdgeEnv,
  jsonResponse,
  supabaseRpc,
  supabaseSelect,
  withFetchMock,
  type FetchCall,
  type MockRoute,
} from '../_shared/testing/edgeTestKit.ts';
import { createFakeOdoo } from '../../../pmo-portal/src/lib/adapterSeam/odoo/fakeOdoo.ts';

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
addEventListener('unload', () => env.restore());

const ORG_ID = '11111111-1111-4111-8111-111111111111';
const APPROVER_ID = '22222222-2222-4222-8222-222222222222';
/** The person who entered the bill: a Finance user, so the role gate alone passes them. */
const AUTHOR_ID = '77777777-7777-4777-8777-777777777777';
const PAYER_ID = '66666666-6666-4666-8666-666666666666';
const PROC_ID = '33333333-3333-4333-8333-333333333333';
const INV_ID = '55555555-5555-4555-8555-555555555555';
const VENDOR_ID = '44444444-4444-4444-8444-444444444444';
const ODOO_HOST = 'odoo.example.test';
const SNAPSHOT = {
  later: { 'purchase.order': true, 'purchase.order.line': true, 'stock.picking': true, 'stock.move': true, 'account.move': true, 'account.payment': true },
  models: { 'account.journal': { exists: true, read: true } },
};

type Tier = 'odoo' | 'erpnext';
interface World {
  owns?: Tier[];
  /** The bill's own outbox rows: who dispatched its create, and what its read-back said. */
  billRows?: Array<{ actor_user_id: string | null; canonical: Record<string, unknown> | null }> | 'unreadable';
}

const objectResponse = (body: unknown) => jsonResponse(body, { headers: { 'content-type': 'application/vnd.pgrst.object+json' } });
const nullObjectResponse = () => new Response('null', { status: 200, headers: { 'content-type': 'application/json' } });
const param = (call: FetchCall, key: string): string | null => {
  const raw = call.url.searchParams.get(key);
  return raw?.startsWith('eq.') ? decodeURIComponent(raw.slice(3)) : raw;
};

/** A posted vendor bill of 98 for partner 9 on a fake Odoo, and a bank journal with an outbound method. */
async function odooWorld() {
  const fake = createFakeOdoo({ key: 'odoo-test-key' });
  fake.seed('res.company', [{ id: 1, name: 'Co', currency_id: [12, 'IDR'] }]);
  fake.seed('product.product', [{ id: 55, name: 'Cable tray', supplier_taxes_id: [] }]);
  fake.seed('account.journal', [{ id: 7, name: 'Bank', type: 'bank', outbound_payment_method_line_ids: [31], company_id: 1 }]);
  const rpc = async (model: string, method: string, body: unknown) =>
    (await fake.fetch(`https://${ODOO_HOST}/json/2/${model}/${method}`, { method: 'POST', headers: { Authorization: 'bearer odoo-test-key' }, body: JSON.stringify(body) })).json();
  const [billId] = await rpc('account.move', 'create', { vals_list: [{ move_type: 'in_invoice', partner_id: 9, currency_id: [12, 'IDR'], invoice_date: '2026-12-05', invoice_line_ids: [[0, 0, { product_id: 55, quantity: 1, price_unit: 98, tax_ids: [[6, 0, []]] }]] }] });
  await rpc('account.move', 'action_post', { ids: [billId] });
  return { fake, billId: billId as number };
}

const paymentCommand = (over: Record<string, unknown> = {}) => ({
  domain: 'procurement', operation: 'create', idempotencyKey: 'cccccccc-cccc-4ccc-8ccc-000000001505',
  record: { id: 'dddddddd-dddd-4ddd-8ddd-000000001505', erp_doc_kind: 'payment', procurementId: PROC_ID, invoiceId: INV_ID, paid_amount: 98, date: '2026-12-10', ...over },
});

function routes(unexpected: FetchCall[], caller: string, world: World, odoo: Awaited<ReturnType<typeof odooWorld>>): MockRoute[] {
  const owns = world.owns ?? ['odoo'];
  const outbox = new Map<string, Record<string, unknown>>();
  return [
    supabaseSelect('profiles', (call) => call.url.searchParams.has('role') ? jsonResponse([{ id: caller }]) : objectResponse({ org_id: ORG_ID })),
    supabaseRpc('domain_owned_by_tier', (call) => jsonResponse(owns.includes((call.bodyJson as { p_tier: Tier }).p_tier))),
    supabaseRpc('org_has_active_erpnext_binding', () => jsonResponse(owns.includes('erpnext'))),
    supabaseRpc('actor_authorization_state', () => jsonResponse({ role: 'Finance', active: true })),
    supabaseRpc('pre_cutover_procurement', () => jsonResponse(false)),
    supabaseRpc('procurement_gate_violation', () => jsonResponse(null)),
    supabaseRpc('procurement_payment_allowed', () => jsonResponse(null)),
    supabaseRpc('procurement_payment_within_ceiling', () => jsonResponse([{ ok: true, reason: null, billed_net: 98, approved_amount: 100 }])),
    supabaseRpc('read_vault_secret', () => jsonResponse('odoo-test-key')),
    supabaseSelect('external_org_bindings', (call) => param(call, 'external_tier') === 'odoo'
      ? objectResponse({ id: 'b0000000-0000-4000-8000-000000000001', site_url: `https://${ODOO_HOST}`, secret_ref: 'odoo_ref', status: 'active', activated_at: '2026-11-01T00:00:00Z',
          config: { database: 'db1', odoo_company_id: 1, capabilities: SNAPSHOT, default_payment_journal_id: 7 } })
      : nullObjectResponse()),
    supabaseSelect('organizations', () => objectResponse({ default_currency: 'IDR' })),
    supabaseSelect('procurements', () => objectResponse({
      id: PROC_ID, org_id: ORG_ID, status: 'Vendor Invoiced', approved_by_id: APPROVER_ID, amount_approved_by_id: null, approved_total_value: 100,
      vendor_id: VENDOR_ID, code: 'PRC-1', project_id: null, currency: 'IDR',
    })),
    supabaseSelect('procurement_invoices', () => objectResponse({ org_id: ORG_ID, procurement_id: PROC_ID })),
    supabaseSelect('external_refs', (call) => {
      if (param(call, 'pmo_record_id') === VENDOR_ID) return objectResponse({ external_record_id: 'Vendor:9' });
      if (param(call, 'pmo_record_id') === INV_ID) return objectResponse({ external_record_id: `account.move:${odoo.billId}` });
      return nullObjectResponse();
    }),
    { label: 'outbox read', method: 'GET', pathname: '/rest/v1/external_command_outbox', response: (call) => {
      if (call.url.searchParams.has('idempotency_key')) {
        const row = outbox.get(`${param(call, 'pmo_record_id')}|${param(call, 'idempotency_key')}`);
        return row ? objectResponse(row) : nullObjectResponse();
      }
      // the bill's own rows (author and read-back flag), read by the Odoo payment gate
      if (world.billRows === 'unreadable') return jsonResponse({ message: 'boom' }, { status: 500 });
      return jsonResponse(param(call, 'pmo_record_id') === INV_ID ? world.billRows ?? [] : []);
    } },
    { label: 'outbox insert', method: 'POST', pathname: '/rest/v1/external_command_outbox', response: (call) => {
      const body = call.bodyJson as Record<string, unknown>;
      const row = { id: 'outbox-1', domain: body.domain, pmo_record_id: body.pmo_record_id, idempotency_key: body.idempotency_key, state: 'pending',
        external_record_id: null, canonical: null, claim_generation: 0, payload_digest: body.payload_digest ?? null, payload: body.payload ?? null };
      outbox.set(`${String(body.pmo_record_id)}|${String(body.idempotency_key)}`, row);
      return objectResponse(row);
    } },
    { label: 'outbox update', method: 'PATCH', pathname: '/rest/v1/external_command_outbox', response: () => jsonResponse([{ id: 'outbox-1' }]) },
    supabaseRpc('claim_outbox_for_commit', () => {
      const row = [...outbox.values()][0];
      return jsonResponse(row ? { ...row, state: 'committing', claim_generation: 1 } : null);
    }),
    supabaseRpc('record_outbox_ref', () => jsonResponse(1)),
    supabaseRpc('confirm_outbox', () => jsonResponse(1)),
    supabaseRpc('surface_action_required', () => jsonResponse(null)),
    { label: 'external ref write', method: 'POST', pathname: '/rest/v1/external_refs', response: () => jsonResponse([]) },
    { label: 'payments mirror', pathname: '/rest/v1/payments', response: () => jsonResponse([]) },
    { label: 'notifications', pathname: '/rest/v1/notifications', response: () => jsonResponse([]) },
    // the fake Odoo behind the Odoo host: the shipped adapter talks to it over fetch
    { label: 'odoo', host: ODOO_HOST, response: async (call) => {
      const [model, method] = call.url.pathname.split('/').slice(-2);
      return odoo.fake.fetch(`https://${ODOO_HOST}/json/2/${model}/${method}`, { method: 'POST', headers: { Authorization: String(call.headers.get('authorization')) }, body: JSON.stringify(call.bodyJson ?? {}) });
    } },
    { label: 'unexpected', response: (call) => { unexpected.push(call); return jsonResponse({ message: 'unmocked' }, { status: 404 }); } },
  ];
}

async function dispatchAs(caller: string, world: World = {}, command: Record<string, unknown> = paymentCommand()) {
  const odoo = await odooWorld();
  const unexpected: FetchCall[] = [];
  const result = await withFetchMock(routes(unexpected, caller, world, odoo), async ({ calls }) => {
    const jwt = await auth.mintJwt({ sub: caller });
    const res = await servedHandler!(new Request('http://edge.test/adapter-dispatch', {
      method: 'POST', headers: { authorization: `Bearer ${jwt}`, 'content-type': 'application/json' }, body: JSON.stringify(command),
    }));
    return { status: res.status, body: await res.text(), calls };
  });
  return { ...result, unexpected, odoo };
}

const noMoneyPipeline = (r: Awaited<ReturnType<typeof dispatchAs>>) => {
  assertEquals(r.calls.filter((c) => c.url.pathname.includes('external_command_outbox') && c.method === 'POST').length, 0, 'no outbox row');
  assertEquals(r.calls.filter((c) => c.url.host === ODOO_HOST).length, 0, 'no Odoo request');
  assertEquals(r.odoo.fake.rows('account.payment').length, 0, 'no Odoo payment');
};
const BILL_BY_AUTHOR = [{ actor_user_id: AUTHOR_ID, canonical: { id: INV_ID, odoo_outcome: undefined } }];

describe('AC-OPP-054 the vendor-payment SoD gate for a tier-odoo bill, through the served handler', () => {
  // A payload that claims another payer changes nothing (FR-OPP-062): the verified caller decides.
  const claiming = () => paymentCommand({ paid_by: PAYER_ID, author: PAYER_ID, approved_by: PAYER_ID });

  it('the case APPROVER is refused 403 with 0006\'s wording; no outbox row, no Odoo request', async () => {
    const r = await dispatchAs(APPROVER_ID, { billRows: BILL_BY_AUTHOR }, claiming());
    assertEquals(r.unexpected.map((c) => `${c.method} ${c.url.pathname}${c.url.search}`), [], 'every read is mocked');
    assertEquals([r.status, JSON.parse(r.body)], [403, { error: 'commit-rejected', message: 'separation of duties: approver cannot pay own procurement' }]);
    noMoneyPipeline(r);
  });

  it('the person who ENTERED THE BILL is refused 403; no outbox row, no Odoo request', async () => {
    const r = await dispatchAs(AUTHOR_ID, { billRows: BILL_BY_AUTHOR }, claiming());
    assertEquals(r.unexpected.map((c) => `${c.method} ${c.url.pathname}${c.url.search}`), [], 'every read is mocked');
    assertEquals([r.status, JSON.parse(r.body)], [403, { error: 'commit-rejected', message: 'separation of duties: bill author cannot pay own bill' }]);
    noMoneyPipeline(r);
  });

  it('a THIRD Finance user succeeds: one posted, reconciled Odoo payment, and the payer recorded is the JWT subject, whatever the payload claims', async () => {
    const r = await dispatchAs(PAYER_ID, { billRows: BILL_BY_AUTHOR }, claiming());
    assertEquals(r.unexpected.map((c) => `${c.method} ${c.url.pathname}${c.url.search}`), [], 'every read is mocked');
    assertEquals(r.status, 200, r.body);
    const [payment] = r.odoo.fake.rows('account.payment');
    assertEquals(r.odoo.fake.rows('account.payment').length, 1);
    assertEquals([payment.state, payment.amount, payment.journal_id, payment.reconciled_bill_ids], ['paid', 98, 7, [r.odoo.billId]]);
    assertEquals(JSON.stringify(payment).includes(PAYER_ID), false, 'no PMO user id reaches Odoo');
    const mirror = r.calls.find((c) => c.method === 'POST' && c.url.pathname === '/rest/v1/payments');
    assert(mirror, 'the payment is mirrored');
    assertEquals((mirror!.bodyJson as { recorded_by_id: string }).recorded_by_id, PAYER_ID);
    const insert = r.calls.find((c) => c.method === 'POST' && c.url.pathname === '/rest/v1/external_command_outbox')!;
    const persisted = (insert.bodyJson as { payload: Record<string, unknown> }).payload;
    assertEquals([persisted.odoo_partner_id, persisted.odoo_bill_ref], [9, `account.move:${r.odoo.billId}`]);
    assert(typeof persisted.created_after === 'string' && typeof persisted.created_before === 'string', 'the recovery window is bounded on both sides');
  });

  it('FR-OPP-044 a bill flagged needs-attention is not payable: refused 422, no outbox row, no Odoo request', async () => {
    const flagged = [{ actor_user_id: AUTHOR_ID, canonical: { id: INV_ID, odoo_outcome: 'needs-attention', odoo_attention: ['total-mismatch'] } }];
    const r = await dispatchAs(PAYER_ID, { billRows: flagged });
    assertEquals([r.status, JSON.parse(r.body)], [422, { error: 'commit-rejected', message: 'bill-needs-attention' }]);
    noMoneyPipeline(r);
  });

  it('fails closed: the bill\'s rows cannot be read -> refused 422, nothing sent', async () => {
    const r = await dispatchAs(PAYER_ID, { billRows: 'unreadable' });
    assertEquals([r.status, JSON.parse(r.body).message], [422, 'gate-check-failed']);
    noMoneyPipeline(r);
  });

  it('a bill that PMO did not author (no outbox row: adopted from Odoo) has no author to exclude and no flag', async () => {
    const r = await dispatchAs(AUTHOR_ID, { billRows: [] });
    assertEquals(r.status, 200, r.body);
    assertEquals(r.odoo.fake.rows('account.payment').length, 1);
  });

  it('AC-OPP-050 an overpayment is refused at selection (422 over-payment), before any outbox row; Odoo is only read', async () => {
    const r = await dispatchAs(PAYER_ID, { billRows: BILL_BY_AUTHOR }, paymentCommand({ paid_amount: 99 }));
    assertEquals([r.status, JSON.parse(r.body).message], [422, 'over-payment']);
    assertEquals(r.calls.filter((c) => c.url.pathname.includes('external_command_outbox') && c.method === 'POST').length, 0, 'no outbox row');
    assertEquals(r.odoo.fake.rows('account.payment').length, 0);
    assert(r.odoo.fake.calls.every((c) => ['read', 'search_read'].includes(c.method) || c.model === 'account.move' && c.method === 'create' || c.method === 'action_post' && c.model === 'account.move'), 'only the fixture writes');
  });

  it('the ERPNext tier keeps the shipped gate: the bill-author arm is Odoo\'s, so an author is not refused for it there', async () => {
    const r = await dispatchAs(AUTHOR_ID, { owns: ['erpnext'], billRows: BILL_BY_AUTHOR });
    assert(!r.body.includes('bill author'), r.body);
  });
});
