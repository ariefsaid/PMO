// #910 — the SERVED wiring of the vendor-payment money gate (FR-VPAY-005, DD-VPAY-5, AC-VPAY-003).
//
// WHY THIS EXISTS: `enforcePaymentGate`/`isProcurementPaymentCreate` are unit-proven by
// `paymentGate.test.ts`, but the WIRING — index.ts actually calling the gate on the dispatch path,
// before the outbox insert — is proven nowhere: deleting the whole
// `if (isProcurementPaymentCreate(command))` block from index.ts kept every test green. This file
// drives the SHIPPED handler (index.ts via the Deno.serve stub, `globalThis.fetch` mocked — the
// Supabase-documented edge-fn test shape and the repo's edge-fn test-binding rule) so only the real
// served wiring can pass:
//   1. the case's APPROVER (a Finance user — authGuard's role gate alone would PASS them) dispatches
//      a procurement payment create → 403 with 0006's exact SoD-b wording, and NO outbox row is
//      inserted (the refusal precedes the money pipeline; nothing touches ERPNext);
//   2. a non-approver payer → passes the gate: the dispatch completes and the one ERPNext Payment
//      Entry POST carries the server-resolved party/allocation (money actually moves).
// Mutation contract: deleting the wiring block turns test 1 RED (the approver's dispatch sails
// through to the outbox/ERP). Verified 2026-10-08 — see the build report.
//
// Every route below is a FACT about the world the handler reads; the `unexpected` catch-all names
// any read not mocked (add a route answering it as a fact — never loosen an assertion).
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
/** The case's APPROVER (user A) — an active Finance member, so authGuard's role half alone passes them. */
const APPROVER_ID = '22222222-2222-4222-8222-222222222222';
/** The payer (user B) — Finance, NOT the case's approver. */
const PAYER_ID = '66666666-6666-4666-8666-666666666666';
const PROC_ID = '33333333-3333-4333-8333-333333333333';
const INV_ID = '55555555-5555-4555-8555-555555555555';
const VENDOR_ID = '44444444-4444-4444-8444-444444444444';
const PI_NAME = 'ACC-PINV-2026-00910';
const PE_NAME = 'ACC-PAY-2026-00910';
const COMPANY_CURRENCY = 'IDR';

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

/** The payment create exactly as the repository's external route mints it (AC-VPAY-005's shape). */
function paymentCreateCommand(): Record<string, unknown> {
  return {
    domain: 'procurement',
    operation: 'create',
    idempotencyKey: 'cccccccc-cccc-4ccc-8ccc-000000000910',
    record: {
      id: 'dddddddd-dddd-4ddd-8ddd-000000000910',
      erp_doc_kind: 'payment',
      procurementId: PROC_ID,
      invoiceId: INV_ID,
      paid_amount: 1090000,
      date: '2026-10-08',
    },
  };
}

/** The world the served handler reads for a procurement payment create on a flipped org. The CASE is
 *  at `Vendor Invoiced` approved by A; the bill is mirrored with the org's currency and outstanding;
 *  the caller's role (actor_authorization_state) is Finance — every gate BEFORE the SoD one passes.
 *  `caller` decides whose JWT is minted, i.e. who the VERIFIED dispatch caller is. */
function routes(unexpected: FetchCall[], caller: string): MockRoute[] {
  const outbox = new Map<string, Record<string, unknown>>();
  return [
    supabaseSelect('profiles', (call) =>
      call.url.searchParams.has('role') ? jsonResponse([{ id: caller }]) : objectResponse({ org_id: ORG_ID })),
    supabaseRpc('domain_owned_by_tier', () => jsonResponse(true)),
    supabaseRpc('org_has_active_erpnext_binding', () => jsonResponse(true)),
    supabaseRpc('actor_authorization_state', () => jsonResponse({ role: 'Finance', active: true })),
    supabaseRpc('read_vault_secret', () => jsonResponse(null)),
    supabaseSelect('external_org_bindings', () => objectResponse({
      site_url: ERP_SITE_URL, secret_ref: SECRET_REF, activated_at: '2026-01-01T00:00:00+00:00', version_major: 15,
      config: { company: COMPANY, default_cash_account: 'Cash - DEMO', default_payable_account: 'Creditors - DEMO' },
    })),
    supabaseSelect('organizations', () => objectResponse({ default_currency: COMPANY_CURRENCY })),
    // The case — the SoD gate's DB re-read (status + approver) AND the supplier resolution's vendor_id.
    supabaseSelect('procurements', () => objectResponse({
      id: PROC_ID, org_id: ORG_ID, status: 'Vendor Invoiced', approved_by_id: APPROVER_ID, vendor_id: VENDOR_ID,
    })),
    // The bill — the refs pass' amount/currency gate oracle (org_id is the link-check's own read).
    supabaseSelect('procurement_invoices', () => objectResponse({
      org_id: ORG_ID, procurement_id: PROC_ID, erp_outstanding_amount: 1090000, vi_number: PI_NAME, currency: COMPANY_CURRENCY,
    })),
    supabaseSelect('external_refs', (call) =>
      eqParam(call, 'pmo_record_id') === VENDOR_ID
        ? objectResponse({ external_record_id: `Supplier:Demo Supplier` })
        : eqParam(call, 'pmo_record_id') === INV_ID
          ? objectResponse({ external_record_id: PI_NAME })
          : nullObjectResponse()),
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
    { label: 'payments mirror', pathname: '/rest/v1/payments', response: () => jsonResponse([]) },
    { label: 'notifications', pathname: '/rest/v1/notifications', response: () => jsonResponse([]) },
    {
      label: 'ERP Payment Entry create', host: ERP_HOST, pathname: '/api/resource/Payment%20Entry',
      response: (call) => call.method === 'POST'
        ? jsonResponse({ data: { ...(call.bodyJson as Record<string, unknown>), name: PE_NAME, docstatus: 0 } })
        : jsonResponse({ data: [] }),
    },
    {
      label: 'ERP Payment Entry submit / read', host: ERP_HOST, pathname: /^\/api\/resource\/Payment%20Entry\/.+$/,
      response: () => jsonResponse({ data: { name: PE_NAME, paid_amount: 1090000, reference_no: 'pmo:dddddddd-dddd-4ddd-8ddd-000000000910', docstatus: 1, modified: '2026-10-08T00:00:00' } }),
    },
    { label: 'unexpected', response: (call) => { unexpected.push(call); return jsonResponse({ message: 'unmocked' }, { status: 404 }); } },
  ];
}

async function dispatchAs(caller: string) {
  const unexpected: FetchCall[] = [];
  const result = await withFetchMock(routes(unexpected, caller), async ({ calls }) => {
    const jwt = await auth.mintJwt({ sub: caller });
    const res = await servedHandler!(new Request('http://edge.test/adapter-dispatch', {
      method: 'POST',
      headers: { authorization: `Bearer ${jwt}`, 'content-type': 'application/json' },
      body: JSON.stringify(paymentCreateCommand()),
    }));
    return { status: res.status, body: await res.text(), calls };
  });
  return { ...result, unexpected };
}

describe('#910 — the vendor-payment SoD gate through the SERVED adapter-dispatch handler', () => {
  it('AC-VPAY-003 the case APPROVER dispatching the payment create is refused 403 with 0006\'s wording BEFORE any outbox row', async () => {
    const r = await dispatchAs(APPROVER_ID);
    assertEquals(r.unexpected.map((c) => `${c.method} ${c.url.pathname}${c.url.search}`), [], 'every read is mocked');
    assertEquals(r.status, 403, r.body);
    const body = JSON.parse(r.body) as { error?: string; message?: string };
    assertEquals(body.error, 'commit-rejected');
    assertEquals(body.message, 'separation of duties: approver cannot pay own procurement');
    // The refusal runs BEFORE the outbox insert — no money pipeline entry, no ERP call.
    assertEquals(r.calls.filter((c) => c.url.pathname.includes('external_command_outbox')).length, 0, 'no outbox row inserted');
    assertEquals(r.calls.filter((c) => c.url.host === ERP_HOST).length, 0, 'nothing touched ERPNext');
  });

  it('AC-VPAY-003 a non-approver payer passes the gate — the dispatch completes and the Payment Entry POST carries the server-resolved allocation', async () => {
    const r = await dispatchAs(PAYER_ID);
    assertEquals(r.unexpected.map((c) => `${c.method} ${c.url.pathname}${c.url.search}`), [], 'every read is mocked');
    assertEquals(r.status, 200, r.body);
    assert(!r.body.includes('separation of duties'), r.body);
    // The money pipeline was entered (the outbox row exists) and the ERP Payment Entry was minted.
    assert(r.calls.some((c) => c.method === 'POST' && c.url.pathname === '/rest/v1/external_command_outbox'), 'outbox row inserted');
    const posts = r.calls.filter((c) => c.url.host === ERP_HOST && c.method === 'POST' && c.url.pathname === '/api/resource/Payment%20Entry');
    assertEquals(posts.length, 1, r.body);
    const body = posts[0].bodyJson as Record<string, unknown>;
    assertEquals(body.payment_type, 'Pay');
    assertEquals(body.party, 'Demo Supplier'); // resolved server-side from the case vendor, never the payload
    assertEquals(body.paid_amount, 1090000);
    assertEquals(body.received_amount, 1090000); // FR-VPAY-007: received_amount IS paid_amount
    assertEquals(body.references, [
      { reference_doctype: 'Purchase Invoice', reference_name: PI_NAME, allocated_amount: 1090000 },
    ]);
  });
});
