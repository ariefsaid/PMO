import { assert, assertEquals } from '@std/assert';
import { createJwtAuthority, createTestJwksResolver, installEdgeEnv, withFetchMock, jsonResponse, type FetchCall } from '../_shared/testing/edgeTestKit.ts';
import { canonicalCommandDigest } from './moneyOutboxDeps.ts';

const env = installEdgeEnv();
Deno.env.set('SUPABASE_ANON_KEY', 'synthetic-anon');
Deno.env.set('EXTERNAL_CONNECT_ENABLED', 'true');
Deno.env.set('TEST_BINDING_KEY', 'synthetic-key');
Deno.env.set('TEST_BINDING_SECRET', 'synthetic-secret');
const authority = await createJwtAuthority(env.SUPABASE_URL);
let handler: (req: Request) => Promise<Response>;
(Deno as unknown as { serve: (h: typeof handler) => unknown }).serve = (h) => { handler = h; return { finished: Promise.resolve() }; };
const { setTestJwks } = await import('./index.ts');
setTestJwks(createTestJwksResolver(authority));
addEventListener('unload', () => env.restore());

const org = 'e6050000-0000-4000-8000-000000000001';
const user = 'e6050000-0000-4000-8000-000000000002';
const purchase = 'e6050000-0000-4000-8000-000000000003';
const receipt = 'e6050000-0000-4000-8000-000000000004';
const key = 'e6050000-0000-4000-8000-000000000005';
const raw = { id: receipt, procurementId: purchase, erp_doc_kind: 'goods-receipt', receiptDate: '2026-10-29' };

async function dispatch(record: Record<string, unknown>, corruptDigest = false, fresh = false) {
  const rawDigest = await canonicalCommandDigest({ domain: 'procurement', operation: 'create', record: raw });
  const payload = { ...raw, items: [{ item_code: 'Original item', qty: 2, rate: 10, po_item_child_name: 'original-child' }],
    pmo_gr_snapshot: { supplier: 'Original supplier', po: 'Original PO', raw_digest: rawDigest } };
  const digest = await canonicalCommandDigest({ domain: 'procurement', operation: 'create', record: payload });
  const row = { id: 'outbox-1', org_id: org, domain: 'procurement', pmo_record_id: receipt, idempotency_key: key,
    operation: 'create', state: 'confirmed', claim_generation: 1, payload_digest: corruptDigest ? 'b'.repeat(64) : digest, payload, procurement_input_digest: rawDigest,
    external_record_id: 'GR-1', canonical: { id: receipt, gr_number: 'GR-1', erp_docstatus: 1 } };
  const token = await authority.mintJwt({ sub: user });
  return withFetchMock([{ label: 'served receipt boundary', response: (call: FetchCall) => {
    const path = call.url.pathname;
    const table = path.split('/').at(-1);
    if (path.startsWith('/rest/v1/rpc/')) {
      if (table === 'actor_authorization_state') return jsonResponse({ role: 'Project Manager', active: true });
      if (table === 'domain_owned_by_tier' || table === 'org_has_active_erpnext_binding') return jsonResponse(true);
      if (table === 'pre_cutover_procurement') return jsonResponse(false); // ECA-4: a purchase ordered after the connection
      if (table === 'record_only_step_refusal') return jsonResponse('record_only_forward_step_refused');
      if (table === 'procurement_gate_violation' || table === 'procurement_create_refusal' || table === 'read_vault_secret') return jsonResponse(null);
      if (table === 'insert_procurement_outbox_pending') return jsonResponse({ ...row, state: 'pending', external_record_id: null, canonical: null });
      if (table === 'claim_outbox_for_commit') return jsonResponse({ code: 'P0001', message: 'synthetic refusal' }, { status: 400 });
      throw new Error(`unexpected RPC ${table}`);
    }
    if (path.startsWith('/rest/v1/')) {
      if (table === 'profiles') return jsonResponse({ org_id: org });
      if (table === 'external_org_bindings') return jsonResponse({ site_url: 'https://erp.example.test', secret_ref: 'test-binding', activated_at: '2026-01-01', version_major: 15, config: {} });
      if (table === 'procurements') return jsonResponse({ id: purchase, org_id: org, vendor_id: null, project_id: null, record_only: true });
      if (table === 'external_command_outbox') return jsonResponse(fresh ? null : row);
      if (table === 'external_refs') return jsonResponse(null);
      if (table === 'purchase_orders') return jsonResponse([]);
      if (table === 'procurement_items') return jsonResponse([{ name: 'Changed item', quantity: 9, rate: 99 }]);
      if (table === 'procurement_receipts') return jsonResponse(call.method === 'GET' ? null : []);
      if (table === 'notifications') return jsonResponse([]);
      throw new Error(`unexpected table ${table}`);
    }
    throw new Error(`unexpected ERP ${call.method} ${path}`);
  } }], async ({ calls }) => {
    const res = await handler(new Request('https://edge.example.test/adapter-dispatch', {
      method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ domain: 'procurement', operation: 'create', idempotencyKey: key, record }),
    }));
    return { status: res.status, body: await res.text(), calls };
  });
}

Deno.test('AC-ROP-004 served dispatch refuses a captured purchase before queuing an ERP command', async () => {
  const result = await dispatch(raw, false, true);
  assertEquals(result.status, 422, result.body);
  assert(result.body.includes('record_only_forward_step_refused'), result.body);
  assertEquals(result.calls.filter((call) => call.url.pathname.endsWith('/rpc/insert_procurement_outbox_pending')).length, 0);
  assertEquals(result.calls.filter((call) => call.url.host === 'erp.example.test' && call.method !== 'GET').length, 0);
});
Deno.test('AC-ROP-004 a retry for a captured purchase is refused before ERP work', async () => {
  const result = await dispatch(raw);
  assertEquals(result.status, 422, result.body);
  assert(result.body.includes('record_only_forward_step_refused'), result.body);
  assertEquals(result.calls.filter((call) => call.url.host === 'erp.example.test' && call.method !== 'GET').length, 0);
});
