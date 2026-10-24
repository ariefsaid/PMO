// 0373 — the SERVED wiring of the purchase-rule re-check before a queued procurement create is reissued.
//
// A purchase order was dispatched, its ERP POST outcome was unknown, and the outbox row was quarantined. When the user
// retries after the quarantine window, the recovery probe finds nothing, so the next step would mint a NEW ERP Purchase
// Order. The org's purchase rules can have changed since; `procurement_create_refusal` (0373) is asked at that moment,
// and a refusal holds the row for an operator with the named reason — nothing is posted to ERP. Drives the SHIPPED
// handler (index.ts via the Deno.serve stub, `globalThis.fetch` mocked). Every route is a fact about the world the
// handler reads; the `unexpected` catch-all names any read not mocked.
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
import { installErpCredentials, ERP_HOST, ERP_SITE_URL, SECRET_REF, COMPANY } from './bfyServedFixture.ts';

const env = installEdgeEnv();
Deno.env.set('SUPABASE_ANON_KEY', 'test-anon-key');
const restoreCreds = installErpCredentials();
const auth = await createJwtAuthority(env.SUPABASE_URL);

let servedHandler: ((req: Request) => Promise<Response>) | null = null;
(Deno as unknown as { serve: (h: unknown) => unknown }).serve = (h: unknown) => {
  servedHandler = h as (req: Request) => Promise<Response>;
  return { finished: Promise.resolve() };
};
const { setTestJwks } = await import('./index.ts');
setTestJwks(createTestJwksResolver(auth));

addEventListener('unload', () => {
  restoreCreds();
  env.restore();
});

const ORG_ID = '11111111-1111-4111-8111-111111111373';
const USER_ID = '66666666-6666-4666-8666-666666666373';
const PROC_ID = '33333333-3333-4333-8333-333333333373';
const VENDOR_ID = '44444444-4444-4444-8444-444444444373';
const ORDER_ID = 'dddddddd-dddd-4ddd-8ddd-000000000373';
const KEY = 'cccccccc-cccc-4ccc-8ccc-000000000373';
const PO_NAME = 'PUR-ORD-2026-00373';

function objectResponse(body: unknown): Response {
  return jsonResponse(body, { headers: { 'content-type': 'application/vnd.pgrst.object+json' } });
}
function nullObjectResponse(): Response {
  return new Response('null', { status: 200, headers: { 'content-type': 'application/json' } });
}

function orderCreateCommand(): Record<string, unknown> {
  return {
    domain: 'procurement',
    operation: 'create',
    idempotencyKey: KEY,
    record: {
      id: ORDER_ID,
      erp_doc_kind: 'purchase-order',
      procurementId: PROC_ID,
      date: '2026-10-24',
      items: [{ item_code: 'ITEM-1', qty: 1, rate: 100, schedule_date: '2026-10-31' }],
    },
  };
}

function routes(unexpected: FetchCall[], refusal: string | null): MockRoute[] {
  // The quarantined row from the first attempt, past its window: the claim wins and the probe runs.
  const quarantined = {
    id: 'outbox-373', domain: 'procurement', pmo_record_id: ORDER_ID, idempotency_key: KEY, state: 'quarantined',
    external_record_id: null, canonical: null, claim_generation: 2, payload_digest: null,
  };
  return [
    supabaseSelect('profiles', (call) =>
      call.url.searchParams.has('role') ? jsonResponse([{ id: USER_ID }]) : objectResponse({ org_id: ORG_ID })),
    supabaseRpc('domain_owned_by_tier', () => jsonResponse(true)),
    supabaseRpc('org_has_active_erpnext_binding', () => jsonResponse(true)),
    supabaseRpc('actor_authorization_state', () => jsonResponse({ role: 'Finance', active: true })),
    // The foreground gate passed when the user retried; the rule check before the reissue answers `refusal`.
    supabaseRpc('procurement_gate_violation', () => jsonResponse(null)),
    supabaseRpc('procurement_create_refusal', () => jsonResponse(refusal)),
    supabaseRpc('read_vault_secret', () => jsonResponse(null)),
    supabaseSelect('external_org_bindings', () => objectResponse({
      site_url: ERP_SITE_URL, secret_ref: SECRET_REF, activated_at: '2026-01-01T00:00:00+00:00', version_major: 15,
      config: { company: COMPANY },
    })),
    supabaseSelect('organizations', () => objectResponse({ default_currency: 'IDR' })),
    supabaseSelect('procurements', () => objectResponse({ id: PROC_ID, org_id: ORG_ID, project_id: null, vendor_id: VENDOR_ID, status: 'Draft' })),
    supabaseSelect('external_refs', () => objectResponse({ external_record_id: 'Supplier:Demo Supplier' })),
    {
      label: 'outbox read', method: 'GET', pathname: '/rest/v1/external_command_outbox',
      response: () => objectResponse(quarantined),
    },
    { label: 'outbox insert', method: 'POST', pathname: '/rest/v1/external_command_outbox',
      response: () => jsonResponse({ code: '23505', message: 'duplicate key value violates unique constraint' }, { status: 409 }) },
    { label: 'outbox update', method: 'PATCH', pathname: '/rest/v1/external_command_outbox',
      response: () => jsonResponse([{ id: 'outbox-373' }]) },
    supabaseRpc('claim_outbox_for_commit', () => jsonResponse({ ...quarantined, state: 'committing', claim_generation: 3 })),
    supabaseRpc('mark_outbox_held', () => jsonResponse(1)),
    supabaseRpc('record_outbox_ref', () => jsonResponse(1)),
    supabaseRpc('confirm_outbox', () => jsonResponse(1)),
    supabaseRpc('surface_action_required', () => jsonResponse(null)),
    { label: 'purchase order mirror', pathname: '/rest/v1/purchase_orders', response: () => jsonResponse([]) },
    { label: 'notifications', pathname: '/rest/v1/notifications', response: () => jsonResponse([]) },
    {
      label: 'ERP purchasable items', host: ERP_HOST, pathname: '/api/resource/Item',
      response: () => jsonResponse({ data: [{ name: 'ITEM-1', item_name: 'Item 1', disabled: 0, is_sales_item: 0, is_purchase_item: 1 }] }),
    },
    {
      label: 'ERP Purchase Order list / create', host: ERP_HOST, pathname: '/api/resource/Purchase%20Order',
      response: (call) => call.method === 'POST'
        ? jsonResponse({ data: { ...(call.bodyJson as Record<string, unknown>), name: PO_NAME, docstatus: 0 } })
        : jsonResponse({ data: [] }),
    },
    {
      label: 'ERP Purchase Order submit / read', host: ERP_HOST, pathname: /^\/api\/resource\/Purchase%20Order\/.+$/,
      response: () => jsonResponse({ data: { name: PO_NAME, docstatus: 1, grand_total: 100, modified: '2026-10-24T00:00:00' } }),
    },
    { label: 'unexpected', response: (call) => { unexpected.push(call); return jsonResponse({ message: 'unmocked' }, { status: 404 }); } },
  ];
}

async function retry(refusal: string | null) {
  const unexpected: FetchCall[] = [];
  const result = await withFetchMock(routes(unexpected, refusal), async ({ calls }) => {
    const jwt = await auth.mintJwt({ sub: USER_ID });
    const res = await servedHandler!(new Request('http://edge.test/adapter-dispatch', {
      method: 'POST',
      headers: { authorization: `Bearer ${jwt}`, 'content-type': 'application/json' },
      body: JSON.stringify(orderCreateCommand()),
    }));
    return { status: res.status, body: await res.text(), calls };
  });
  return { ...result, unexpected };
}

describe('0373 — a quarantined procurement create re-asks the purchase rules before it is reissued', () => {
  it('a reissue the rules now refuse is held with the named reason and nothing is posted to ERP', async () => {
    const r = await retry('gate_approval_before_order');
    assertEquals(r.unexpected.map((c) => `${c.method} ${c.url.host}${c.url.pathname}${c.url.search}`), [], 'every read is mocked');
    assertEquals(r.status, 409, r.body);
    assertEquals(r.calls.filter((c) => c.url.host === ERP_HOST && c.method === 'POST').length, 0, 'no ERP Purchase Order was created');
    const asked = r.calls.find((c) => c.url.pathname === '/rest/v1/rpc/procurement_create_refusal');
    assert(asked, 'the purchase rules were asked before the reissue');
    assertEquals(asked!.bodyJson, { p_org_id: ORG_ID, p_procurement_id: PROC_ID, p_erp_doc_kind: 'purchase-order', p_actor_user_id: USER_ID });
    const held = r.calls.find((c) => c.url.pathname === '/rest/v1/rpc/mark_outbox_held');
    assert(held, 'the row was held for an operator');
    assert(String((held!.bodyJson as Record<string, unknown>).p_reason).includes('purchase rule refused: gate_approval_before_order'),
      JSON.stringify(held!.bodyJson));
  });

  it('control: a reissue the rules allow posts the Purchase Order', async () => {
    const r = await retry(null);
    assert(r.calls.some((c) => c.url.pathname === '/rest/v1/rpc/procurement_create_refusal'), 'the purchase rules were asked');
    assert(!r.calls.some((c) => c.url.pathname === '/rest/v1/rpc/mark_outbox_held'), 'an allowed reissue is not held');
    assertEquals(r.calls.filter((c) => c.url.host === ERP_HOST && c.method === 'POST' && c.url.pathname === '/api/resource/Purchase%20Order').length, 1, r.body);
  });
});
