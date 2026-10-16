/** S-17 — read-only ERP invoice evidence through the shipped handler; synthetic data only. */
import { describe, it, afterAll } from '@std/testing/bdd';
import { assertEquals } from '@std/assert';
import { handleInvoiceEvidenceRequest, setTestJwks } from './index.ts';
import {
  createAuthedRequest, createJwtAuthority, createTestJwksResolver, erp,
  installEdgeEnv, jsonResponse, supabaseRpc, supabaseSelect, withFetchMock,
} from '../_shared/testing/edgeTestKit.ts';

const env = installEdgeEnv();
const originalResolveDns = Deno.resolveDns;
Deno.resolveDns = ((hostname: string, recordType: string) => recordType === 'A'
  ? Promise.resolve(['8.8.8.8'])
  : recordType === 'AAAA' ? Promise.resolve(['2001:4860:4860::8888']) : Promise.reject(new Error('unexpected DNS query'))) as typeof Deno.resolveDns;
const authority = await createJwtAuthority(env.SUPABASE_URL);
setTestJwks(createTestJwksResolver(authority));
afterAll(() => { env.restore(); Deno.resolveDns = originalResolveDns; });

const INVOICE_ID = '6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b';
const ERP_NAME = 'SYNTHETIC-SINV-2026-00001';
const ERP_HOST = 'erp.example.com';
const objectHeaders = { 'content-type': 'application/vnd.pgrst.object+json' };
const callerHeaders = (call: { headers: Headers }) => assertEquals(call.headers.get('authorization')?.startsWith('Bearer ey'), true);
const profile = () => supabaseSelect('profiles', (call) => { callerHeaders(call); return jsonResponse({ org_id: 'org-test' }, { headers: objectHeaders }); });
const actor = (role = 'Project Manager', active = true) => supabaseRpc('actor_authorization_state', (call) => {
  callerHeaders(call); assertEquals(call.bodyJson, { p_org_id: 'org-test', p_user_id: 'user-test' });
  return jsonResponse({ role, active });
});
const invoice = () => supabaseSelect('sales_invoices', (call) => {
  callerHeaders(call); assertEquals(call.url.searchParams.get('id'), `eq.${INVOICE_ID}`);
  return jsonResponse({ id: INVOICE_ID, org_id: 'org-test' }, { headers: objectHeaders });
});
const link = () => supabaseSelect('external_refs', (call) => {
  callerHeaders(call); assertEquals(call.url.searchParams.get('pmo_record_id'), `eq.${INVOICE_ID}`);
  return jsonResponse({ external_record_id: ERP_NAME, external_tier: 'erpnext' }, { headers: objectHeaders });
});
const binding = () => supabaseSelect('external_org_bindings', () => jsonResponse({
  site_url: `https://${ERP_HOST}`, secret_ref: 'synthetic-ref', status: 'active', activated_at: '2026-10-05',
}, { headers: objectHeaders }));
const vault = () => supabaseRpc('read_vault_secret', () => jsonResponse('synthetic-key:synthetic-secret'));
const evidence = () => erp(ERP_HOST, `/api/resource/Sales%20Invoice/${ERP_NAME}`, (call) => {
  assertEquals(call.method, 'GET');
  return jsonResponse({ data: {
    name: ERP_NAME,
    items: [{ item_code: 'SYNTHETIC-SVC', description: 'Inspection work', qty: 2, rate: 125, amount: 250 }],
    contact_display: 'Billing Desk', contact_email: 'billing@example.test', contact_mobile: '+62-TEST-000',
    secret: 'must not escape projection',
  } });
});
const request = async (body: unknown = { salesInvoiceId: INVOICE_ID }) => createAuthedRequest(
  'http://edge.test/invoice-evidence', body, await authority.mintJwt({ sub: 'user-test' }),
);

 describe('external-invoice-evidence', () => {
  it('returns only allowlisted invoice lines and contact context to an active revenue reader', async () => {
    await withFetchMock([profile(), actor(), invoice(), link(), binding(), vault(), evidence()], async () => {
      const response = await handleInvoiceEvidenceRequest(await request());
      assertEquals(response.status, 200);
      assertEquals(await response.json(), {
        lines: [{ item_code: 'SYNTHETIC-SVC', description: 'Inspection work', qty: 2, rate: 125, amount: 250 }],
        contact: { name: 'Billing Desk', email: 'billing@example.test', phone: '+62-TEST-000' },
      });
      assertEquals(response.headers.get('cache-control'), 'no-store');
    });
  });

  it('does not read ERP evidence for an unauthorized or inactive caller', async () => {
    for (const standing of [actor('Engineer'), actor('Finance', false)]) {
      await withFetchMock([profile(), standing], async ({ calls }) => {
        const response = await handleInvoiceEvidenceRequest(await request());
        assertEquals(response.status, 403);
        assertEquals(calls.some((call) => call.url.host === ERP_HOST), false);
      });
    }
  });

  it('rejects missing or malformed invoice identities before any data read', async () => {
    for (const body of [{}, { salesInvoiceId: 'not-a-uuid' }]) {
      await withFetchMock([profile(), actor()], async ({ calls }) => {
        const response = await handleInvoiceEvidenceRequest(await request(body));
        assertEquals(response.status, 400);
        assertEquals(calls.some((call) => call.url.pathname === '/rest/v1/sales_invoices'), false);
        assertEquals(calls.some((call) => call.url.host === ERP_HOST), false);
      });
    }
  });
});
