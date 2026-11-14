/**
 * AC-ECA-020 / FR-ECA-030 [Deno] — through the SHIPPED served handler: a receipt, bill or payment on a purchase ordered
 * before the ERP connection is refused 409 `pre-cutover` before the outbox, adapter selection or any ERP request. The
 * mock kit throws on any unrouted request, so "refused" also proves nothing else was reached.
 */
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
import { COMPANY, ERP_HOST, ERP_SITE_URL, installErpCredentials, SECRET_REF } from './bfyServedFixture.ts';

const env = installEdgeEnv();
Deno.env.set('SUPABASE_ANON_KEY', 'test-anon-key');
const restoreCredentials = installErpCredentials();
const auth = await createJwtAuthority(env.SUPABASE_URL);

let servedHandler: ((req: Request) => Promise<Response>) | null = null;
(Deno as unknown as { serve: (handler: unknown) => unknown }).serve = (handler: unknown) => {
  servedHandler = handler as (req: Request) => Promise<Response>;
  return { finished: Promise.resolve() };
};
const { setTestJwks } = await import('./index.ts');
setTestJwks(createTestJwksResolver(auth));
addEventListener('unload', () => {
  restoreCredentials();
  env.restore();
});

const ORG_ID = '11111111-1111-4111-8111-111111111111';
const CALLER_ID = '22222222-2222-4222-8222-222222222222';
const CASE_ID = '33333333-3333-4333-8333-333333333333';
const INVOICE_ID = '44444444-4444-4444-8444-444444444444';

const RECORDS = {
  'goods-receipt': { procurementId: CASE_ID, status: 'Partial', receiptDate: '2026-08-01', erp_doc_kind: 'goods-receipt' },
  'purchase-invoice': { procurementId: CASE_ID, status: 'Received', invoiceDate: '2026-08-01', referenceNumber: 'B-1', erp_doc_kind: 'purchase-invoice' },
  'payment': { procurementId: CASE_ID, invoiceId: INVOICE_ID, paid_amount: 100, date: '2026-08-01', erp_doc_kind: 'payment' },
} as const;

async function dispatch(kind: keyof typeof RECORDS, answer: () => Response) {
  const checks: unknown[] = [];
  const routes = [
    supabaseSelect('profiles', () => jsonResponse({ org_id: ORG_ID })),
    supabaseRpc('domain_owned_by_tier', () => jsonResponse(true)),
    supabaseRpc('actor_authorization_state', () => jsonResponse({ role: 'Admin', active: true })),
    supabaseRpc('pre_cutover_procurement', (call) => { checks.push(call.bodyJson); return answer(); }),
  ];
  return await withFetchMock(routes, async ({ calls }) => {
    const jwt = await auth.mintJwt({ sub: CALLER_ID });
    const response = await servedHandler!(new Request('http://edge.test/adapter-dispatch', {
      method: 'POST',
      headers: { authorization: `Bearer ${jwt}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        domain: 'procurement', operation: 'create', idempotencyKey: '66666666-6666-4666-8666-666666666666',
        record: { id: '55555555-5555-4555-8555-555555555555', ...RECORDS[kind] },
      }),
    }));
    return { response, body: await response.json() as { error?: string; message?: string }, calls, checks };
  });
}

const ORDER_ID = '55555555-5555-4555-8555-555555555521';
const ORDER_KEY = '66666666-6666-4666-8666-666666666521';
const VENDOR_ID = '77777777-7777-4777-8777-777777777721';
const ERP_ORDER_NAME = 'PUR-ORD-ECA-021';

const objectResponse = (body: unknown) => jsonResponse(body, { headers: { 'content-type': 'application/vnd.pgrst.object+json' } });
const noRowResponse = () => new Response('null', { status: 200, headers: { 'content-type': 'application/json' } });

async function dispatchOpenDraftOrder() {
  const preCutoverChecks: unknown[] = [];
  const outboxRow = {
    id: 'outbox-eca-021', org_id: ORG_ID, domain: 'procurement', pmo_record_id: ORDER_ID,
    idempotency_key: ORDER_KEY, external_tier: 'erpnext', operation: 'create', state: 'pending',
    claim_generation: 0, external_record_id: null, canonical: null, payload_digest: null, payload: null,
  };
  const route: MockRoute = {
    label: 'AC-ECA-021 served purchase-order dispatch',
    response: (call: FetchCall) => {
      const path = call.url.pathname;
      if (path.startsWith('/rest/v1/rpc/')) {
        const rpc = path.split('/').at(-1);
        if (rpc === 'domain_owned_by_tier' || rpc === 'org_has_active_erpnext_binding') return jsonResponse(true);
        if (rpc === 'actor_authorization_state') return jsonResponse({ role: 'Admin', active: true });
        if (rpc === 'pre_cutover_procurement') {
          preCutoverChecks.push(call.bodyJson);
          return jsonResponse(false);
        }
        if (rpc === 'record_only_step_refusal' || rpc === 'procurement_gate_violation' || rpc === 'procurement_create_refusal') return jsonResponse(null);
        if (rpc === 'read_vault_secret') return jsonResponse(null);
        if (rpc === 'insert_procurement_outbox_pending') {
          const args = call.bodyJson as Record<string, unknown>;
          return jsonResponse({ ...outboxRow, payload: args.p_payload ?? null, payload_digest: args.p_digest ?? null });
        }
        if (rpc === 'claim_outbox_for_commit') return jsonResponse({ ...outboxRow, state: 'committing', claim_generation: 1 });
        if (rpc === 'record_outbox_ref' || rpc === 'confirm_outbox') return jsonResponse(1);
        if (rpc === 'surface_action_required') return jsonResponse(null);
        throw new Error(`unexpected RPC ${rpc}`);
      }

      if (path.startsWith('/rest/v1/')) {
        const table = path.split('/').at(-1);
        if (table === 'profiles') return call.url.searchParams.has('role') ? jsonResponse([{ id: CALLER_ID }]) : objectResponse({ org_id: ORG_ID });
        if (table === 'external_org_bindings') return objectResponse({
          site_url: ERP_SITE_URL, secret_ref: SECRET_REF, activated_at: '2026-01-01T00:00:00Z', version_major: 15, config: { company: COMPANY },
        });
        if (table === 'organizations') return objectResponse({ default_currency: 'IDR' });
        if (table === 'procurements') return objectResponse({ id: CASE_ID, org_id: ORG_ID, status: 'Draft', vendor_id: VENDOR_ID, project_id: null });
        if (table === 'external_refs') {
          const pmoRecord = call.url.searchParams.get('pmo_record_id');
          if (call.method === 'GET' && pmoRecord === `eq.${VENDOR_ID}`) return objectResponse({ external_record_id: 'Supplier:Draft Vendor' });
          return call.method === 'GET' ? noRowResponse() : jsonResponse([]);
        }
        if (table === 'procurement_erp_links') return jsonResponse([]);
        if (table === 'purchase_orders') return call.method === 'GET' ? jsonResponse([]) : jsonResponse([]);
        if (table === 'procurement_items') return jsonResponse([{ name: 'Cable', quantity: 1, rate: 100 }]);
        if (table === 'external_command_outbox') {
          if (call.method === 'GET') return noRowResponse();
          if (call.method === 'POST') return objectResponse(outboxRow);
          if (call.method === 'PATCH') return jsonResponse([{ id: outboxRow.id }]);
        }
        if (table === 'notifications') return jsonResponse([]);
        throw new Error(`unexpected table ${table} (${call.method})`);
      }

      if (call.url.host === ERP_HOST) {
        if (path === '/api/resource/Item') return jsonResponse({ data: [{ name: 'ITEM-1', item_name: 'Cable', disabled: 0, is_sales_item: 0, is_purchase_item: 1 }] });
        if (path === '/api/resource/Purchase%20Order') {
          if (call.method === 'POST') return jsonResponse({ data: { ...(call.bodyJson as Record<string, unknown>), name: ERP_ORDER_NAME, docstatus: 0 } });
          return jsonResponse({ data: [] });
        }
        if (/^\/api\/resource\/Purchase%20Order\/.+$/.test(path)) return jsonResponse({ data: { name: ERP_ORDER_NAME, docstatus: 1, grand_total: 100, modified: '2026-11-14T00:00:00' } });
      }
      throw new Error(`unexpected fetch: ${call.method} ${call.url}`);
    },
  };
  return await withFetchMock([route], async ({ calls }) => {
    const jwt = await auth.mintJwt({ sub: CALLER_ID });
    const response = await servedHandler!(new Request('http://edge.test/adapter-dispatch', {
      method: 'POST',
      headers: { authorization: `Bearer ${jwt}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        domain: 'procurement', operation: 'create', idempotencyKey: ORDER_KEY,
        record: {
          id: ORDER_ID, procurementId: CASE_ID, erp_doc_kind: 'purchase-order', date: '2026-11-14',
          items: [{ item_code: 'ITEM-1', qty: 1, rate: 100, schedule_date: '2026-11-15' }],
        },
      }),
    }));
    return { response, body: await response.text(), calls, preCutoverChecks };
  });
}

const nothingWritten = (calls: Array<{ method: string; url: URL }>) =>
  calls.filter((c) => c.method !== 'GET' && !c.url.pathname.includes('/rpc/')).length === 0
  && calls.filter((c) => /external_command_outbox|external_refs/.test(c.url.pathname)).length === 0
  && calls.filter((c) => c.url.hostname !== new URL(env.SUPABASE_URL).hostname).length === 0;

describe('AC-ECA-020 pre-cut-over purchase through the served handler', () => {
  for (const kind of ['goods-receipt', 'purchase-invoice', 'payment'] as const) {
    it(`a ${kind} on a purchase ordered before the connection is refused 409 pre-cutover and touches nothing`, async () => {
      const r = await dispatch(kind, () => jsonResponse(true));
      assertEquals(r.response.status, 409, JSON.stringify(r.body));
      assertEquals(r.body.error, 'pre-cutover');
      // A payment names its bill, so a bill the ERP holds is paid there (the check answers false for it).
      assertEquals(r.checks, [kind === 'payment' ? { p_procurement_id: CASE_ID, p_invoice_id: INVOICE_ID } : { p_procurement_id: CASE_ID }]);
      assert(nothingWritten(r.calls), 'no outbox write, ref write or ERP request');
    });
  }

  it('a check that cannot answer refuses the step (fail closed) and touches nothing', async () => {
    const r = await dispatch('goods-receipt', () => jsonResponse(null));
    assertEquals(r.response.status, 422, JSON.stringify(r.body));
    assertEquals(r.body.error, 'commit-rejected');
    assertEquals(r.body.message, 'could not check the connection date');
    assertEquals(r.checks, [{ p_procurement_id: CASE_ID }]);
    assert(nothingWritten(r.calls), 'no outbox write, ref write or ERP request');
  });

  it('AC-ECA-021 an open draft order dispatches through the shipped handler after procurement is employed', async () => {
    const r = await dispatchOpenDraftOrder();
    assertEquals(r.response.status, 200, r.body);
    assertEquals(r.preCutoverChecks, [], 'the first ERP step is the purchase order, so it is not treated as a post-cut-over step');
    const orderPosts = r.calls.filter((call) => call.url.host === ERP_HOST && call.url.pathname === '/api/resource/Purchase%20Order' && call.method === 'POST');
    assertEquals(orderPosts.length, 1, r.body);
    assertEquals((orderPosts[0].bodyJson as { company?: string }).company, COMPANY);
    assert(r.calls.some((call) => call.url.pathname === '/rest/v1/rpc/confirm_outbox'), 'the outbox command completed');
    assert(!r.calls.some((call) => call.url.pathname === '/rest/v1/rpc/mark_outbox_held'), 'the order was not held for review');
  });
});
