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
} from '../_shared/testing/edgeTestKit.ts';

const env = installEdgeEnv();
Deno.env.set('SUPABASE_ANON_KEY', 'test-anon-key');
const auth = await createJwtAuthority(env.SUPABASE_URL);

let servedHandler: ((req: Request) => Promise<Response>) | null = null;
(Deno as unknown as { serve: (handler: unknown) => unknown }).serve = (handler: unknown) => {
  servedHandler = handler as (req: Request) => Promise<Response>;
  return { finished: Promise.resolve() };
};
const { setTestJwks } = await import('./index.ts');
setTestJwks(createTestJwksResolver(auth));
addEventListener('unload', () => env.restore());

const ORG_ID = '11111111-1111-4111-8111-111111111111';
const CALLER_ID = '22222222-2222-4222-8222-222222222222';
const CASE_ID = '33333333-3333-4333-8333-333333333333';
const INVOICE_ID = '44444444-4444-4444-8444-444444444444';

const RECORDS = {
  'goods-receipt': { procurementId: CASE_ID, status: 'Partial', receiptDate: '2026-08-01', erp_doc_kind: 'goods-receipt' },
  'purchase-invoice': { procurementId: CASE_ID, status: 'Received', invoiceDate: '2026-08-01', referenceNumber: 'B-1', erp_doc_kind: 'purchase-invoice' },
  'payment': { procurementId: CASE_ID, invoiceId: INVOICE_ID, paid_amount: 100, date: '2026-08-01', erp_doc_kind: 'payment' },
} as const;

async function dispatch(kind: keyof typeof RECORDS | 'purchase-order', answer: () => Response) {
  const checks: unknown[] = [];
  const routes = [
    supabaseSelect('profiles', () => jsonResponse({ org_id: ORG_ID })),
    supabaseSelect('procurements', () => jsonResponse({ org_id: ORG_ID })),
    supabaseRpc('procurement_gate_violation', () => jsonResponse(null)),
    supabaseRpc('domain_owned_by_tier', () => jsonResponse(true)),
    supabaseRpc('actor_authorization_state', () => jsonResponse({ role: 'Admin', active: true })),
    supabaseRpc('pre_cutover_procurement', () => jsonResponse(false)),
    supabaseRpc('linked_step_state', (call) => { checks.push(call.bodyJson); return answer(); }),
  ];
  return await withFetchMock(routes, async ({ calls }) => {
    const jwt = await auth.mintJwt({ sub: CALLER_ID });
    const response = await servedHandler!(new Request('http://edge.test/adapter-dispatch', {
      method: 'POST',
      headers: { authorization: `Bearer ${jwt}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        domain: 'procurement', operation: 'create', idempotencyKey: '66666666-6666-4666-8666-666666666666',
        record: { id: '55555555-5555-4555-8555-555555555555', ...(kind === 'purchase-order' ? { procurementId: CASE_ID, erp_doc_kind: 'purchase-order' } : RECORDS[kind]) },
      }),
    }));
    return { response, body: await response.json() as { error?: string; message?: string }, calls, checks };
  });
}

const nothingWritten = (calls: Array<{ method: string; url: URL }>) =>
  calls.filter((c) => c.method !== 'GET' && !c.url.pathname.includes('/rpc/')).length === 0
  && calls.filter((c) => /external_command_outbox|external_refs/.test(c.url.pathname)).length === 0
  && calls.filter((c) => c.url.hostname !== new URL(env.SUPABASE_URL).hostname).length === 0;

describe('linked purchase steps through the served handler', () => {
  for (const kind of ['goods-receipt', 'purchase-invoice'] as const) {
    it(`refuses an already linked ${kind} before any write`, async () => {
      const r = await dispatch(kind, () => jsonResponse('already_in_erp'));
      assertEquals(r.response.status, 409, JSON.stringify(r.body));
      assertEquals(r.body.error, 'step_already_recorded');
      assertEquals(r.checks, [{ p_org_id: ORG_ID, p_procurement_id: CASE_ID, p_step: kind }]);
      assert(nothingWritten(r.calls));
    });
  }
  it('fails closed when the linked step cannot be determined', async () => {
    const r = await dispatch('goods-receipt', () => jsonResponse(null));
    assertEquals(r.response.status, 422, JSON.stringify(r.body));
    assertEquals(r.body.message, 'Could not check the linked purchase step.');
    assert(nothingWritten(r.calls));
  });
});
