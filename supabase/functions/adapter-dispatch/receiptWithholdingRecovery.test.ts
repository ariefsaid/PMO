/**
 * #762 / DD-RCPT-1 — crash recovery of a receipt with tax withheld.
 *
 * ERPNext stores the CASH in a same-currency Receive Payment Entry's `paid_amount` (the gross rides on
 * the invoice allocation, the withheld tax on a deduction row). The mutable-anchor recovery probe's
 * fallback match filters on `paid_amount`, so the outbox must persist the cash for a withholding
 * receipt — persisting the gross never matches the landed document and the retry POSTs a SECOND
 * Payment Entry for the same receipt.
 *
 * Drives the SHIPPED served handler (index.ts via the Deno.serve stub) with `globalThis.fetch` mocked.
 * The world: a previous attempt already landed the Payment Entry, and an accountant edited its
 * `reference_no`, so only the fallback conjunction (party + paid_amount + cited invoice) can find it.
 */
import { describe, it } from '@std/testing/bdd';
import { assertEquals } from '@std/assert';
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
const CUSTOMER_ID = '55555555-5555-4555-8555-555555555555';
const SI_ID = '66666666-6666-4666-8666-666666666666';
const RECEIPT_ID = '77777777-7777-4777-8777-777777777777';
const ERP_CUSTOMER = 'Demo Customer';
const ERP_SI = 'ACC-SINV-0001';
const LANDED_PE = 'ACC-PAY-0001';

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

/** The Payment Entry ERPNext already holds: cash in both headers, the tax as a marked deduction. */
const landedPe = {
  name: LANDED_PE, docstatus: 1, payment_type: 'Receive', party_type: 'Customer', party: ERP_CUSTOMER,
  paid_amount: 180000, received_amount: 180000, reference_no: 'edited-by-accountant',
  references: [{ reference_doctype: 'Sales Invoice', reference_name: ERP_SI, allocated_amount: 200000 }],
  deductions: [{ account: 'Tax Prepaid - DEMO', cost_center: 'Main - DEMO', amount: 20000,
    description: 'Withholding slip: WHT-001' }],
};

function routes(unexpected: FetchCall[], landed: Record<string, unknown> = landedPe): MockRoute[] {
  const outbox = new Map<string, Record<string, unknown>>();
  return [
    supabaseSelect('profiles', (call) =>
      call.url.searchParams.has('role') ? jsonResponse([{ id: USER_ID }]) : objectResponse({ org_id: ORG_ID })),
    supabaseRpc('domain_owned_by_tier', () => jsonResponse(true)),
    supabaseRpc('org_has_active_erpnext_binding', () => jsonResponse(true)),
    supabaseRpc('actor_authorization_state', () => jsonResponse({ role: 'Admin', active: true })),
    supabaseRpc('read_vault_secret', () => jsonResponse(null)),
    supabaseSelect('external_org_bindings', () => objectResponse({
      site_url: ERP_SITE_URL, secret_ref: SECRET_REF, activated_at: '2026-01-01T00:00:00+00:00', version_major: 15,
      config: { company: COMPANY, cost_center: 'Main - DEMO', default_receivable_account: 'Debtors - DEMO',
        default_cash_account: 'Cash - DEMO' },
    })),
    supabaseSelect('organizations', () => objectResponse({ tax_prepaid_account: 'Tax Prepaid - DEMO' })),
    supabaseSelect('companies', () => objectResponse({ id: CUSTOMER_ID, org_id: ORG_ID })),
    supabaseSelect('sales_invoices', () => objectResponse({ id: SI_ID, org_id: ORG_ID, customer_id: CUSTOMER_ID })),
    supabaseSelect('external_refs', (call) => {
      const pmo = eqParam(call, 'pmo_record_id');
      if (pmo === CUSTOMER_ID) return objectResponse({ external_record_id: `Customer:${ERP_CUSTOMER}` });
      if (pmo === SI_ID) return objectResponse({ external_record_id: ERP_SI });
      return nullObjectResponse();
    }),
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
    { label: 'incoming_payments mirror', pathname: '/rest/v1/incoming_payments', response: () => jsonResponse([]) },
    { label: 'notifications', pathname: '/rest/v1/notifications', response: () => jsonResponse([]) },
    {
      label: 'ERP Payment Entry list / create', host: ERP_HOST, pathname: '/api/resource/Payment%20Entry',
      response: (call) => {
        if (call.method === 'POST') {
          return jsonResponse({ data: { ...(call.bodyJson as Record<string, unknown>), name: 'ACC-PAY-DUPLICATE', docstatus: 0 } });
        }
        // A real ERPNext list: only documents that satisfy EVERY filter come back.
        const filters = JSON.parse(call.url.searchParams.get('filters') ?? '[]') as Array<[string, string, unknown]>;
        const satisfies = filters.every(([field, op, value]) => {
          const actual = landed[field];
          if (field === 'creation') return true;
          if (op === '=') return String(actual) === String(value) || Number(actual) === Number(value);
          if (op === '<') return Number(actual) < Number(value);
          if (op === 'like') return String(actual ?? '').includes(String(value).replaceAll('%', ''));
          return false;
        });
        return jsonResponse({ data: satisfies ? [{ name: LANDED_PE }] : [] });
      },
    },
    {
      label: 'ERP Payment Entry read', host: ERP_HOST, pathname: /^\/api\/resource\/Payment%20Entry\/.+$/,
      response: () => jsonResponse({ data: landed }),
    },
    { label: 'unexpected', response: (call) => { unexpected.push(call); return jsonResponse({ message: 'unmocked' }, { status: 404 }); } },
  ];
}

describe('#762 DD-RCPT-1 — recovering a withholding receipt finds the landed Payment Entry', () => {
  it('AC-WHT-002: the fallback match uses the cash ERPNext stores, so the landed entry is adopted and nothing is re-POSTed', async () => {
    const unexpected: FetchCall[] = [];
    const { res, body, calls } = await withFetchMock(routes(unexpected), async ({ calls }) => {
      const jwt = await auth.mintJwt({ sub: USER_ID });
      const res = await servedHandler!(new Request('http://edge.test/adapter-dispatch', {
        method: 'POST',
        headers: { authorization: `Bearer ${jwt}`, 'content-type': 'application/json' },
        body: JSON.stringify({ domain: 'revenue', operation: 'create', idempotencyKey: '88888888-8888-4888-8888-888888888888', record: {
          id: RECEIPT_ID, customerId: CUSTOMER_ID, salesInvoiceId: SI_ID, erp_doc_kind: 'incoming-payment',
          paid_amount: 200000, received_amount: 180000, withheld_amount: 20000, withholding_slip_number: 'WHT-001',
        } }),
      }));
      return { res, body: await res.text(), calls };
    });

    assertEquals(unexpected.map((c) => `${c.method} ${c.url.pathname}${c.url.search}`), [], 'every read is mocked');
    const pePosts = calls.filter((c) => c.url.host === ERP_HOST && c.method === 'POST');
    assertEquals(pePosts.length, 0, 'a second Payment Entry must never be POSTed for a receipt that already landed');
    assertEquals(res.status, 200, `the landed entry is adopted — got ${res.status}: ${body}`);
    assertEquals(JSON.parse(body).externalRecordId, LANDED_PE, 'the result adopts the landed Payment Entry');
  });

  it('AC-WHT-004: without withholding the fallback still matches on the amount sent (here a cross-currency receipt)', async () => {
    const unexpected: FetchCall[] = [];
    const plainPe = { ...landedPe, paid_amount: 200000, received_amount: 15000, deductions: [] };
    const { res, body, calls } = await withFetchMock(routes(unexpected, plainPe), async ({ calls }) => {
      const jwt = await auth.mintJwt({ sub: USER_ID });
      const res = await servedHandler!(new Request('http://edge.test/adapter-dispatch', {
        method: 'POST',
        headers: { authorization: `Bearer ${jwt}`, 'content-type': 'application/json' },
        body: JSON.stringify({ domain: 'revenue', operation: 'create', idempotencyKey: '99999999-9999-4999-8999-999999999999', record: {
          id: RECEIPT_ID, customerId: CUSTOMER_ID, salesInvoiceId: SI_ID, erp_doc_kind: 'incoming-payment',
          paid_amount: 200000, received_amount: 15000, withheld_amount: 0,
        } }),
      }));
      return { res, body: await res.text(), calls };
    });

    assertEquals(unexpected.map((c) => `${c.method} ${c.url.pathname}${c.url.search}`), [], 'every read is mocked');
    assertEquals(calls.filter((c) => c.url.host === ERP_HOST && c.method === 'POST').length, 0, 'no second Payment Entry');
    assertEquals(res.status, 200, `the landed entry is adopted — got ${res.status}: ${body}`);
    assertEquals(JSON.parse(body).externalRecordId, LANDED_PE, 'the result adopts the landed Payment Entry');
  });
});
