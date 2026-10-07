/**
 * #876 slice 2 (DD-VWH-13, AC-VWH-035) — a vendor bill with ENTERED VAT / PPh, through the SHIPPED served
 * `adapter-dispatch` handler (index.ts via the Deno.serve stub) with `globalThis.fetch` mocked (Supabase's documented
 * edge-function test shape; no dependency injection in production code).
 *   1. A command naming a template AND amounts is refused (422) before ANY ERPNext call.
 *   2. Client-supplied rows and the server-only marker never reach ERPNext: the one Purchase Invoice POST carries
 *      exactly the two rows the server built from the entered amounts and the org's tax accounts.
 * Every route below is a FACT about the world the handler reads; the `unexpected` catch-all names any read not mocked
 * (add a route answering it as a fact — never loosen an assertion).
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

const ORG_ID = '11111111-1111-4111-8111-111111111111';
const USER_ID = '22222222-2222-4222-8222-222222222222';
const PROC_ID = '33333333-3333-4333-8333-333333333333';
const VENDOR_ID = '44444444-4444-4444-8444-444444444444';
const PI_ID = '55555555-5555-4555-8555-555555555555';
const VAT_ACCOUNT = 'Input VAT - DEMO';
const PPH23_ACCOUNT = 'PPh 23 Payable - DEMO';
const ERP_PI = 'ACC-PINV-2026-00876';

function objectResponse(body: unknown): Response {
  return jsonResponse(body, { headers: { 'content-type': 'application/vnd.pgrst.object+json' } });
}
function nullObjectResponse(): Response {
  return new Response('null', { status: 200, headers: { 'content-type': 'application/json' } });
}
function eqParam(call: FetchCall, key: string): string | null {
  const raw = call.url.searchParams.get(key);
  return raw?.startsWith('eq.') ? decodeURIComponent(raw.slice(3)) : raw;
}

const PI_HEADER = { name: ERP_PI, docstatus: 1, grand_total: 1090000, total_taxes_and_charges: 90000,
  taxes_and_charges_deducted: 20000, outstanding_amount: 1090000, taxes_and_charges: '' };

function routes(unexpected: FetchCall[]): MockRoute[] {
  const outbox = new Map<string, Record<string, unknown>>();
  return [
    supabaseSelect('profiles', (call) =>
      call.url.searchParams.has('role') ? jsonResponse([{ id: USER_ID }]) : objectResponse({ org_id: ORG_ID })),
    supabaseRpc('domain_owned_by_tier', () => jsonResponse(true)),
    supabaseRpc('org_has_active_erpnext_binding', () => jsonResponse(true)),
    supabaseRpc('actor_authorization_state', () => jsonResponse({ role: 'Finance', active: true })),
    supabaseRpc('read_vault_secret', () => jsonResponse(null)),
    supabaseSelect('external_org_bindings', () => objectResponse({
      site_url: ERP_SITE_URL, secret_ref: SECRET_REF, activated_at: '2026-01-01T00:00:00+00:00', version_major: 15,
      config: { company: COMPANY },
    })),
    supabaseSelect('organizations', () => objectResponse({
      input_vat_account: VAT_ACCOUNT, pph23_payable_account: PPH23_ACCOUNT, pph4_2_payable_account: null,
    })),
    supabaseSelect('procurements', () => objectResponse({ id: PROC_ID, org_id: ORG_ID, vendor_id: VENDOR_ID, project_id: null })),
    supabaseSelect('companies', () => objectResponse({ id: VENDOR_ID, org_id: ORG_ID })),
    supabaseSelect('external_refs', (call) =>
      eqParam(call, 'pmo_record_id') === VENDOR_ID
        ? objectResponse({ external_record_id: 'Supplier:Demo Supplier' })
        : nullObjectResponse()),
    supabaseSelect('procurement_items', () => jsonResponse([])),
    {
      label: 'outbox read', method: 'GET', pathname: '/rest/v1/external_command_outbox',
      response: (call) => {
        const row = outbox.get(`${eqParam(call, 'pmo_record_id')}|${eqParam(call, 'idempotency_key')}`);
        return row ? objectResponse(row) : nullObjectResponse();
      },
    },
    {
      label: 'outbox insert', method: 'POST', pathname: '/rest/v1/external_command_outbox',
      response: (call) => {
        const body = call.bodyJson as Record<string, unknown>;
        const row = { id: 'outbox-1', domain: body.domain, pmo_record_id: body.pmo_record_id,
          idempotency_key: body.idempotency_key, state: 'pending', external_record_id: null, canonical: null,
          claim_generation: 0, payload_digest: body.payload_digest ?? null, payload: body.payload ?? null };
        outbox.set(`${String(body.pmo_record_id)}|${String(body.idempotency_key)}`, row);
        return objectResponse(row);
      },
    },
    { label: 'outbox update', method: 'PATCH', pathname: '/rest/v1/external_command_outbox',
      response: () => jsonResponse([{ id: 'outbox-1' }]) },
    supabaseRpc('claim_outbox_for_commit', () => {
      const row = [...outbox.values()][0];
      return jsonResponse(row ? { ...row, state: 'committing', claim_generation: 1 } : null);
    }),
    supabaseRpc('record_outbox_ref', () => jsonResponse(1)),
    supabaseRpc('confirm_outbox', () => jsonResponse(1)),
    supabaseRpc('surface_action_required', () => jsonResponse(null)),
    { label: 'procurement_invoices mirror', pathname: '/rest/v1/procurement_invoices', response: () => jsonResponse([]) },
    { label: 'notifications', pathname: '/rest/v1/notifications', response: () => jsonResponse([]) },
    {
      label: 'ERP Item catalog', host: ERP_HOST, pathname: '/api/resource/Item',
      response: () => jsonResponse({ data: [{ name: 'DEMO-ITEM', disabled: 0, is_sales_item: 0, is_purchase_item: 1 }] }),
    },
    {
      label: 'ERP Account read', host: ERP_HOST, pathname: /^\/api\/resource\/Account\/.+$/,
      response: (call) => {
        const name = decodeURIComponent(call.url.pathname.split('/').pop() ?? '');
        return jsonResponse({ data: { name, company: COMPANY, is_group: 0, root_type: name === PPH23_ACCOUNT ? 'Liability' : 'Asset' } });
      },
    },
    {
      label: 'ERP Purchase Invoice list / create', host: ERP_HOST, pathname: '/api/resource/Purchase%20Invoice',
      response: (call) => call.method === 'POST'
        ? jsonResponse({ data: { ...(call.bodyJson as Record<string, unknown>), ...PI_HEADER, docstatus: 0 } })
        : jsonResponse({ data: [] }),
    },
    {
      label: 'ERP Purchase Invoice submit / read', host: ERP_HOST, pathname: /^\/api\/resource\/Purchase%20Invoice\/.+$/,
      response: () => jsonResponse({ data: PI_HEADER }),
    },
    { label: 'unexpected', response: (call) => { unexpected.push(call); return jsonResponse({ message: 'unmocked' }, { status: 404 }); } },
  ];
}

const BILL = { id: PI_ID, procurementId: PROC_ID, vendorId: VENDOR_ID, erp_doc_kind: 'purchase-invoice',
  items: [{ item_code: 'DEMO-ITEM', qty: 1, rate: 1000000 }] };

async function dispatch(record: Record<string, unknown>, idempotencyKey: string) {
  const unexpected: FetchCall[] = [];
  const result = await withFetchMock(routes(unexpected), async ({ calls }) => {
    const jwt = await auth.mintJwt({ sub: USER_ID });
    const res = await servedHandler!(new Request('http://edge.test/adapter-dispatch', {
      method: 'POST',
      headers: { authorization: `Bearer ${jwt}`, 'content-type': 'application/json' },
      body: JSON.stringify({ domain: 'procurement', operation: 'create', idempotencyKey, record }),
    }));
    return { status: res.status, body: await res.text(), calls };
  });
  return { ...result, unexpected };
}

describe('#876 slice 2 — entered vendor tax through the served adapter-dispatch', () => {
  it('AC-VWH-035 a bill naming a template AND entered amounts is refused (422) before any ERPNext call', async () => {
    const r = await dispatch({ ...BILL, taxTemplate: 'Input VAT 11 - DEMO', vatAmount: 110000, withheldAmount: 0, pphType: null },
      'aaaaaaaa-aaaa-4aaa-8aaa-000000000876');
    assertEquals(r.unexpected.map((c) => `${c.method} ${c.url.pathname}${c.url.search}`), [], 'every read is mocked');
    assertEquals(r.status, 422, r.body);
    assert(r.body.includes('not both'), r.body);
    assertEquals(r.calls.filter((c) => c.url.host === ERP_HOST).length, 0, 'refused before any ERPNext call');
  });

  it('AC-VWH-035 forged client rows never reach ERPNext — the POST carries only the server-built Actual rows', async () => {
    const r = await dispatch({
      ...BILL, vatAmount: 110000, withheldAmount: 20000, pphType: 'pph23',
      taxes: [{ charge_type: 'Actual', account_head: 'EVIL - DEMO', tax_amount: 999999, category: 'Total', add_deduct_tax: 'Deduct' }],
      taxesFromAmounts: true,
    }, 'bbbbbbbb-bbbb-4bbb-8bbb-000000000876');
    assertEquals(r.unexpected.map((c) => `${c.method} ${c.url.pathname}${c.url.search}`), [], 'every read is mocked');
    const posts = r.calls.filter((c) => c.url.host === ERP_HOST && c.method === 'POST' && c.url.pathname === '/api/resource/Purchase%20Invoice');
    assertEquals(posts.length, 1, r.body);
    const body = posts[0].bodyJson as Record<string, unknown>;
    assertEquals(body.taxes_and_charges, '');
    assertEquals(body.taxes, [
      { charge_type: 'Actual', account_head: VAT_ACCOUNT, description: 'VAT', tax_amount: 110000, category: 'Total', add_deduct_tax: 'Add', included_in_print_rate: 0 },
      { charge_type: 'Actual', account_head: PPH23_ACCOUNT, description: 'PPh 23', tax_amount: 20000, category: 'Total', add_deduct_tax: 'Deduct', included_in_print_rate: 0 },
    ]);
    // OQ-VWH-6 (Director 2026-10-07): the mirrored bill records the PPh type the dispatch validated.
    const mirror = r.calls.filter((c) => c.method === 'POST' && c.url.pathname === '/rest/v1/procurement_invoices');
    assertEquals(mirror.length, 1, r.body);
    const row = (Array.isArray(mirror[0].bodyJson) ? mirror[0].bodyJson[0] : mirror[0].bodyJson) as Record<string, unknown>;
    assertEquals([row.withheld_amount, row.withheld_pph_type], ['20000.00', 'pph23']);
  });
});
