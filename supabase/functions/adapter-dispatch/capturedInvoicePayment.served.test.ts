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
//   3. #1319: the step no longer gates a payment (a Draft/Ordered case pays when no gate refuses); the org's
//      approval_before_payment gate refuses before the outbox; SoD-b holds at any step; Cancelled refuses.
// Mutation contract: deleting the wiring block turns test 1 RED (the approver's dispatch sails
// through to the outbox/ERP). Verified 2026-10-08 — see the build report.
//
// Every route below is a FACT about the world the handler reads; the `unexpected` catch-all names
// any read not mocked (add a route answering it as a fact — never loosen an assertion).
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
      supplier: VENDOR_ID,
      paid_amount: 1090000,
      date: '2026-10-08',
      references: [{ reference_doctype: 'Purchase Invoice', reference_name: PI_NAME, allocated_amount: 1090000 }],
    },
  };
}

/** The world the served handler reads for a procurement payment create on a flipped org. The CASE is
 *  at `Vendor Invoiced` approved by A; the bill is mirrored with the org's currency and outstanding;
 *  the caller's role (actor_authorization_state) is Finance — every gate BEFORE the SoD one passes.
 *  `caller` decides whose JWT is minted, i.e. who the VERIFIED dispatch caller is. */
/** `world` varies the facts #1319 made decisive: the case row (step / approval) and the org's purchase gates. */
interface World {
  submitStatus?: number;
  submitTypeError?: boolean;
  captureDocs?: Array<Record<string, unknown>>;
  supplierDrift?: boolean;
  mappingDrift?: boolean;
  rawSupplierMapping?: boolean;
  caseRow?: Record<string, unknown>;
  gateViolation?: string | null;
  /** What the database's payment rule (procurement_payment_allowed, 0368) answers: a reason code, or null = allowed. */
  paymentAllowed?: string | null;
  /** An HTTP status the payment-rule RPC fails with (the rule cannot be evaluated). */
  paymentAllowedStatus?: number;
  /** The outbox claim's named refusal (0368/0373): the rules in force when the queued payment is claimed refuse it. */
  claimRefusal?: string;
  /** Another payment holds the bill when the claim runs: the per-bill constraint (0682) raises 23505. */
  claimBillInFlight?: boolean;
}

interface SharedPaymentWorld {
  outbox: Map<string, Record<string, unknown>>;
  loseNextPaymentPostResponse: boolean;
  paymentPosts: number;
  submittedPayments: number;
  submittedPaymentIds: Set<string>;
  erpInvoices: number;
  erpOrders: number;
  outstanding: number;
  pendingAmount: number;
}

function routes(unexpected: FetchCall[], caller: string, ceilingOk = true, amountApproverId: string | null = null, world: World = {}, shared: SharedPaymentWorld = newSharedWorld()): MockRoute[] {
  const { outbox } = shared;
  let supplierRead = 0;
  let mappingRead = 0;
  return [
    supabaseSelect('profiles', (call) =>
      call.url.searchParams.has('role') ? jsonResponse([{ id: caller }]) : objectResponse({ org_id: ORG_ID })),
    supabaseRpc('domain_owned_by_tier', () => jsonResponse(true)),
    supabaseRpc('org_has_active_erpnext_binding', () => jsonResponse(true)),
    supabaseRpc('actor_authorization_state', () => jsonResponse({ role: 'Finance', active: true })),
    supabaseRpc('pre_cutover_procurement', () => jsonResponse(false)), // ECA-4: a purchase ordered after the connection
    // FR-PFE-010 (#1319): the org's purchase gates, read before any ERP work — all OFF here (the owner's default).
    supabaseRpc('record_only_step_refusal', () => jsonResponse(null)),
    supabaseRpc('procurement_gate_violation', () => jsonResponse(world.gateViolation ?? null)),
    // #1319 slice G review (C1): the database's one payment rule — allowed (null) unless the world says otherwise.
    supabaseRpc('procurement_payment_allowed', () => world.paymentAllowedStatus
      ? jsonResponse({ message: 'rule unavailable' }, { status: world.paymentAllowedStatus })
      : jsonResponse(world.paymentAllowed ?? null)),
    supabaseRpc('read_vault_secret', () => jsonResponse(null)),
    supabaseSelect('external_org_bindings', () => objectResponse({
      site_url: ERP_SITE_URL, secret_ref: SECRET_REF, activated_at: '2026-01-01T00:00:00+00:00', version_major: 15,
      config: { company: COMPANY, default_cash_account: 'Cash - DEMO', default_payable_account: 'Creditors - DEMO' },
    })),
    supabaseSelect('organizations', () => objectResponse({ default_currency: COMPANY_CURRENCY })),
    // The case — the SoD gate's DB re-read (status + approver) AND the supplier resolution's vendor_id.
    supabaseSelect('procurements', (call) => objectResponse({
      id: PROC_ID, org_id: ORG_ID, status: 'Vendor Invoiced', currency: COMPANY_CURRENCY, approved_by_id: APPROVER_ID,
      amount_approved_by_id: amountApproverId, approved_total_value: 1000000, vendor_id: VENDOR_ID,
      ...world.caseRow,
      ...(world.supplierDrift && call.url.searchParams.get('select') === 'vendor_id' && supplierRead++ === 0 ? { vendor_id: '88888888-8888-4888-8888-888888888888' } : {}),
    })),
    // The bill — the refs pass' amount/currency gate oracle (org_id is the link-check's own read).
    supabaseSelect('procurement_erp_links', () => jsonResponse(world.captureDocs ?? [{ org_id: ORG_ID, procurement_id: PROC_ID, erp_purchase_document_id: INV_ID, erp_purchase_documents: { id: INV_ID, org_id: ORG_ID, erp_doctype: 'Purchase Invoice', erp_name: PI_NAME, supplier: 'Demo Supplier', currency: COMPANY_CURRENCY, erp_docstatus: 1, is_return: false, outstanding_amount: shared.outstanding } }])),
    supabaseSelect('procurement_invoices', () => objectResponse({
      org_id: ORG_ID, procurement_id: PROC_ID, erp_outstanding_amount: 1090000, vi_number: PI_NAME, currency: COMPANY_CURRENCY,
    })),
    supabaseRpc('procurement_payment_within_ceiling', () => jsonResponse([{
      ok: ceilingOk, reason: ceilingOk ? null : 'vendor bill exceeds approved amount',
      billed_net: ceilingOk ? 1000000 : 1200000, approved_amount: 1000000,
    }])),
    supabaseSelect('external_refs', (call) =>
      eqParam(call, 'pmo_record_id') === '88888888-8888-4888-8888-888888888888'
        ? objectResponse({ external_record_id: 'Supplier:Other Supplier' })
        : eqParam(call, 'pmo_record_id') === VENDOR_ID
        ? objectResponse({ external_record_id: world.mappingDrift && ++mappingRead >= 3 ? 'Supplier:Other Supplier' : world.rawSupplierMapping ? 'Demo Supplier' : `Supplier:Demo Supplier` })
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
        const payload = body.payload as Record<string, unknown> | null;
        const piNames = Array.isArray(payload?.pi_names) ? payload.pi_names.filter((name): name is string => typeof name === 'string') : [];
        const inFlightForOneOfTheBills = [...outbox.values()].some((candidate) => {
          if (candidate.org_id !== body.org_id || candidate.external_tier !== 'erpnext' || candidate.domain !== 'procurement'
              || candidate.state === 'confirmed' || candidate.state === 'failed') return false;
          const candidatePayload = candidate.payload as Record<string, unknown> | null;
          const candidatePiNames = Array.isArray(candidatePayload?.pi_names) ? candidatePayload.pi_names : [];
          return candidatePiNames.some((name) => piNames.includes(name));
        });
        if (inFlightForOneOfTheBills) {
          return jsonResponse({
            code: '23505',
            message: 'duplicate key value violates unique constraint "external_command_outbox_one_inflight_erpnext_payment_per_bill"',
            details: 'Key (org_id, bill_name) already exists.',
            hint: null,
          }, { status: 409 });
        }
        const row = { id: `outbox-${outbox.size + 1}`, domain: body.domain, pmo_record_id: body.pmo_record_id,
          org_id: body.org_id, external_tier: body.external_tier,
          idempotency_key: body.idempotency_key, state: 'pending', external_record_id: null, canonical: null,
          claim_generation: 0, payload_digest: body.payload_digest ?? null, payload: body.payload ?? null };
        outbox.set(`${String(body.pmo_record_id)}|${String(body.idempotency_key)}`, row);
        return objectResponse(row);
      },
    },
    { label: 'outbox update', method: 'PATCH', pathname: '/rest/v1/external_command_outbox',
      response: (call) => {
        const row = [...outbox.values()].find(candidate => candidate.id === eqParam(call, 'id') && String(candidate.claim_generation) === eqParam(call, 'claim_generation'));
        if (!row) return jsonResponse([]);
        Object.assign(row, call.bodyJson);
        return jsonResponse([{ id: row.id }]);
      } },
    supabaseRpc('fail_refused_payment_claim', () => jsonResponse(null)),
    supabaseRpc('claim_outbox_for_commit', () => {
      if (world.claimBillInFlight) {
        return jsonResponse({
          code: '23505',
          message: 'duplicate key value violates unique constraint "external_command_outbox_one_inflight_erpnext_payment_per_bill"',
          details: 'Key (org_id, bill_name) already exists.',
          hint: null,
        }, { status: 409 });
      }
      if (world.claimRefusal) {
        return jsonResponse({ code: 'P0001', message: world.claimRefusal, details: null, hint: null }, { status: 400 });
      }
      const row = [...outbox.values()].find((candidate) => candidate.state === 'pending');
      if (!row) return jsonResponse(null);
      Object.assign(row, { state: 'committing', claim_generation: Number(row.claim_generation ?? 0) + 1 });
      return jsonResponse(row);
    }),
    supabaseRpc('fail_captured_invoice_payment', (call) => {
      const body = call.bodyJson as Record<string, unknown>;
      const row = [...outbox.values()].find((candidate) => candidate.id === body.p_id && candidate.claim_generation === body.p_generation && candidate.state === 'committing');
      if (!row) return jsonResponse(0);
      Object.assign(row, { state: 'failed', last_error: 'captured_invoice_payment_rejected', attempt_count: 5 });
      return jsonResponse(1);
    }),
    supabaseRpc('record_outbox_ref', () => jsonResponse(1)),
    supabaseRpc('confirm_outbox', (call) => {
      const body = call.bodyJson as Record<string, unknown>;
      const row = [...outbox.values()].find(candidate => candidate.id === body.p_id && candidate.claim_generation === body.p_generation && candidate.state === 'committed');
      if (!row) return jsonResponse(0);
      row.state = 'confirmed';
      return jsonResponse(1);
    }),
    supabaseRpc('surface_action_required', () => jsonResponse(null)),
    { label: 'payments mirror', pathname: '/rest/v1/payments', response: () => jsonResponse([]) },
    { label: 'notifications', pathname: '/rest/v1/notifications', response: () => jsonResponse([]) },
    {
      label: 'ERP Payment Entry create', host: ERP_HOST, pathname: '/api/resource/Payment%20Entry',
      response: (call) => {
        if (call.method !== 'POST') return jsonResponse({ data: [] });
        shared.paymentPosts += 1;
        shared.pendingAmount = Number((call.bodyJson as Record<string, unknown>).paid_amount);
        if (shared.loseNextPaymentPostResponse) {
          shared.loseNextPaymentPostResponse = false;
          // The remote accepted the POST, then the connection timed out before its response arrived.
          return Promise.reject(new TypeError('request timed out after Payment Entry POST'));
        }
        return jsonResponse({ data: { ...(call.bodyJson as Record<string, unknown>), name: shared.paymentPosts === 1 ? PE_NAME : `${PE_NAME}-${shared.paymentPosts}`, docstatus: 0 } });
      },
    },
    {
      label: 'ERP Payment Entry submit / read', host: ERP_HOST, pathname: /^\/api\/resource\/Payment%20Entry\/.+$/,
      response: (call) => {
        if (world.submitStatus && call.method === 'PUT') return jsonResponse({ exception: 'private ERP detail', ...(world.submitTypeError ? { exc_type: 'TypeError' } : {}) }, { status: world.submitStatus });
        const name = decodeURIComponent(call.url.pathname.split('/').at(-1) ?? '');
        if (call.method === 'PUT' && !shared.submittedPaymentIds.has(name)) { shared.submittedPaymentIds.add(name); shared.submittedPayments = shared.submittedPaymentIds.size; shared.outstanding -= shared.pendingAmount; }
        return jsonResponse({ data: { name, paid_amount: 1090000, reference_no: 'pmo:dddddddd-dddd-4ddd-8ddd-000000000910', docstatus: 1, modified: '2026-10-08T00:00:00' } });
      },
    },
    { label: 'ERP invoice create', host: ERP_HOST, method: 'POST', pathname: '/api/resource/Purchase%20Invoice', response: () => { shared.erpInvoices++; return jsonResponse({ data: {} }); } },
    { label: 'ERP order create', host: ERP_HOST, method: 'POST', pathname: '/api/resource/Purchase%20Order', response: () => { shared.erpOrders++; return jsonResponse({ data: {} }); } },
    { label: 'unexpected', response: (call) => { unexpected.push(call); return jsonResponse({ message: 'unmocked' }, { status: 404 }); } },
  ];
}

const newSharedWorld = (): SharedPaymentWorld => ({ outbox: new Map(), loseNextPaymentPostResponse: false, paymentPosts: 0, submittedPayments: 0, submittedPaymentIds: new Set(), erpInvoices: 1, erpOrders: 1, outstanding: 100, pendingAmount: 0 });

async function dispatchAs(caller: string, world: World = {}, command = paymentCreateCommand(), shared = newSharedWorld()) {
  const unexpected: FetchCall[] = [];
  const result = await withFetchMock(routes(unexpected, caller, true, null, world, shared), async ({ calls }) => {
    const jwt = await auth.mintJwt({ sub: caller });
    const res = await servedHandler!(new Request('http://edge.test/adapter-dispatch', {
      method: 'POST',
      headers: { authorization: `Bearer ${jwt}`, 'content-type': 'application/json' },
      body: JSON.stringify(command),
    }));
    return { status: res.status, body: await res.text(), calls };
  });
  return { ...result, unexpected, shared };
}


function capturedCommand(extra: Record<string, unknown> = {}) {
  const command = paymentCreateCommand();
  return { ...command, record: { id: 'dddddddd-dddd-4ddd-8ddd-000000000910', erp_doc_kind: 'payment', procurementId: PROC_ID,
    capturedInvoiceDocumentId: INV_ID, paid_amount: 25, date: '2026-11-15', ...extra } };
}

Deno.test('AC-ROP-024 server resolves captured invoice', async () => {
  const result = await dispatchAs(PAYER_ID, { caseRow: { record_only: true, approved_by_id: null, approved_total_value: null } }, capturedCommand({ supplier: 'forged', references: [{ reference_name: 'forged' }], pi_names: ['forged'] }));
  assertEquals(result.status, 200, result.body);
  const post = result.calls.find((c) => c.url.host === ERP_HOST && c.method === 'POST' && c.url.pathname === '/api/resource/Payment%20Entry');
  assert(post, result.body);
  const posted = post.bodyJson as Record<string, unknown>;
  assertEquals(posted.party, 'Demo Supplier');
  assertEquals(posted.references, [{ reference_doctype: 'Purchase Invoice', reference_name: PI_NAME, allocated_amount: 25 }]);
  const inserted = result.calls.find((c) => c.method === 'POST' && c.url.pathname === '/rest/v1/external_command_outbox');
  assert(inserted);
  const payload = (inserted.bodyJson as { payload: Record<string, unknown> }).payload;
  assertEquals(payload.pi_names, [PI_NAME]);
  assertEquals(payload.party, 'Demo Supplier');
  const mirror = result.calls.find((c) => c.method === 'POST' && c.url.pathname === '/rest/v1/payments');
  assert(mirror);
  assertEquals((mirror.bodyJson as Record<string, unknown>).invoice_id, null);
});

Deno.test('AC-ROP-024 invalid captured invoice selections never post', async () => {
  for (const [label, record, docs] of [
    ['two selectors', { invoiceId: INV_ID }, undefined],
    ['unlinked', {}, []],
    ['duplicate', {}, [ {erp_purchase_document_id: INV_ID, erp_purchase_documents: { id: INV_ID,org_id: ORG_ID,erp_doctype:'Purchase Invoice',erp_name:PI_NAME,supplier:'Demo Supplier',currency:COMPANY_CURRENCY,erp_docstatus:1,is_return:false,outstanding_amount:100 } }, {erp_purchase_document_id: '77777777-7777-4777-8777-777777777777', erp_purchase_documents: { id:'77777777-7777-4777-8777-777777777777',org_id:ORG_ID,erp_doctype:'Purchase Invoice',erp_name:'PI-2',supplier:'Demo Supplier',currency:COMPANY_CURRENCY,erp_docstatus:1,is_return:false,outstanding_amount:100 } } ]],
    ['over residual', { paid_amount: 101 }, undefined],
    ['boolean amount', { paid_amount: true }, undefined],
    ['raw ERP name', { capturedInvoiceDocumentId: PI_NAME }, undefined],

    ['foreign organization', {}, [{ org_id: '00000000-0000-4000-8000-000000000000', procurement_id: PROC_ID, erp_purchase_document_id: INV_ID, erp_purchase_documents: { id:INV_ID,org_id:'00000000-0000-4000-8000-000000000000',erp_doctype:'Purchase Invoice',erp_name:PI_NAME,supplier:'Demo Supplier',currency:COMPANY_CURRENCY,erp_docstatus:1,is_return:false,outstanding_amount:100 } }]],
    ['other case', {}, [{ org_id: ORG_ID, procurement_id: '00000000-0000-4000-8000-000000000000', erp_purchase_document_id: INV_ID, erp_purchase_documents: { id:INV_ID,org_id:ORG_ID,erp_doctype:'Purchase Invoice',erp_name:PI_NAME,supplier:'Demo Supplier',currency:COMPANY_CURRENCY,erp_docstatus:1,is_return:false,outstanding_amount:100 } }]],
    ['absent currency', {}, [{ org_id: ORG_ID, procurement_id: PROC_ID, erp_purchase_document_id: INV_ID, erp_purchase_documents: { id:INV_ID,org_id:ORG_ID,erp_doctype:'Purchase Invoice',erp_name:PI_NAME,supplier:'Demo Supplier',currency:null,erp_docstatus:1,is_return:false,outstanding_amount:100 } }]],
    ['currency mismatch', {}, [{ org_id: ORG_ID, procurement_id: PROC_ID, erp_purchase_document_id: INV_ID, erp_purchase_documents: { id:INV_ID,org_id:ORG_ID,erp_doctype:'Purchase Invoice',erp_name:PI_NAME,supplier:'Demo Supplier',currency:'USD',erp_docstatus:1,is_return:false,outstanding_amount:100 } }]],
    ['supplier mismatch', {}, [{ org_id: ORG_ID, procurement_id: PROC_ID, erp_purchase_document_id: INV_ID, erp_purchase_documents: { id:INV_ID,org_id:ORG_ID,erp_doctype:'Purchase Invoice',erp_name:PI_NAME,supplier:'Other:Demo Supplier',currency:COMPANY_CURRENCY,erp_docstatus:1,is_return:false,outstanding_amount:100 } }]],
    ['cancelled invoice', {}, [{ org_id: ORG_ID, procurement_id: PROC_ID, erp_purchase_document_id: INV_ID, erp_purchase_documents: { id:INV_ID,org_id:ORG_ID,erp_doctype:'Purchase Invoice',erp_name:PI_NAME,supplier:'Demo Supplier',currency:COMPANY_CURRENCY,erp_docstatus:2,is_return:false,outstanding_amount:100 } }]],
    ['settled invoice', {}, [{ org_id: ORG_ID, procurement_id: PROC_ID, erp_purchase_document_id: INV_ID, erp_purchase_documents: { id:INV_ID,org_id:ORG_ID,erp_doctype:'Purchase Invoice',erp_name:PI_NAME,supplier:'Demo Supplier',currency:COMPANY_CURRENCY,erp_docstatus:1,is_return:false,outstanding_amount:0 } }]],

  ] as const) {
    const result = await dispatchAs(PAYER_ID, { caseRow: { record_only: true, approved_by_id: null, approved_total_value: null }, captureDocs: docs ? [...docs] : undefined }, capturedCommand(record));
    assertEquals(result.status, 422, `${label}: ${result.body}`);
    assertEquals(result.calls.filter((c) => c.method === 'POST' && (c.url.host === ERP_HOST || c.url.pathname === '/rest/v1/external_command_outbox')).length, 0, label);
  }
});

Deno.test('AC-ROP-024 recovery retains captured invoice after its balance changes', async () => {
  (Deno as unknown as { serve: (...args: unknown[]) => unknown }).serve = () => ({ finished: Promise.resolve() });
  const { buildMoneyWriteDepsLive } = await import('../erpnext-sweep/index.ts');
  const { dispatchMoneyWrite } = await import('../../../pmo-portal/src/lib/adapterSeam/dispatch.ts');
  const first = await dispatchAs(PAYER_ID, { caseRow: { record_only: true, approved_by_id: null, approved_total_value: null } }, capturedCommand());
  assertEquals(first.status, 200, first.body);
  assertEquals(first.shared.paymentPosts, 1);
  const inserted = [...first.shared.outbox.values()][0];
  assert(inserted);
  const payload = inserted.payload as Record<string, unknown> & { id: string };
  const command = { domain: 'procurement' as const, operation: 'create' as const, record: payload, idempotencyKey: 'cccccccc-cccc-4ccc-8ccc-000000000910' };
  const outbox = { id: 'outbox-1', org_id: ORG_ID, domain: 'procurement', pmo_record_id: payload.id, idempotency_key: command.idempotencyKey,
    state: 'quarantined', external_record_id: null, canonical: null, claim_generation: 3, payload_digest: null, payload };
  const queries: string[] = [];
  const rpcs: string[] = [];
  const client = {
    from: (table: string) => {
      queries.push(table);
      // deno-lint-ignore no-explicit-any
      const b: any = { // eslint-disable-line @typescript-eslint/no-explicit-any
        select: () => b, eq: () => b, in: () => b, is: () => b, order: () => b, limit: () => b,
        maybeSingle: () => Promise.resolve({ data: table === 'external_command_outbox' ? outbox
          : table === 'external_org_bindings' ? { site_url: ERP_SITE_URL, version_major: 15, activated_at: '2026-01-01', config: { company: COMPANY } }
          : table === 'procurements' ? { id: PROC_ID, org_id: ORG_ID, vendor_id: VENDOR_ID } : null, error: null }),
        update: () => b, insert: () => b, upsert: () => b,
        then: (resolve: (x: unknown) => void) => resolve({ data: table === 'procurement_erp_links'
          ? [{ org_id: ORG_ID, procurement_id: PROC_ID, erp_purchase_document_id: INV_ID, erp_purchase_documents: { id: INV_ID, org_id: ORG_ID, erp_doctype: 'Purchase Invoice', erp_name: PI_NAME, supplier: 'Demo Supplier', currency: COMPANY_CURRENCY, erp_docstatus: 1, is_return: false, outstanding_amount: 0 } }]
          : [{ id: outbox.id }], error: null }) };
      return b;
    },
    rpc: (fn: string) => { rpcs.push(fn); return Promise.resolve({ data: fn === 'claim_outbox_for_commit' ? { ...outbox, state: 'committing', claim_generation: 4 } : 1, error: null }); },
  };
  const org = { orgId: ORG_ID, siteUrl: ERP_SITE_URL, secretRef: SECRET_REF, company: COMPANY, config: {}, ownedDomains: ['procurement'], versionMajor: 15 };
  const cache = new Map([[ORG_ID, Promise.resolve({ apiKey: 'synthetic', apiSecret: 'synthetic' })]]);
  const oldFetch = globalThis.fetch;
  let posts = 0;
  globalThis.fetch = (() => { posts++; return Promise.resolve(jsonResponse({})); }) as typeof fetch;
  try {
    const deps = await buildMoneyWriteDepsLive(client as never, org, { command, actorUserId: PAYER_ID, outboxRecordId: payload.id, persistPayload: false }, cache);
    deps.money.probeByRemarksKey = () => Promise.resolve(null);
    try { await dispatchMoneyWrite(deps); } catch { /* A mutable anchor is held on an inconclusive probe. */ }
    assertEquals(posts, 0);
    assertEquals(payload.references, [{ reference_doctype: 'Purchase Invoice', reference_name: PI_NAME, allocated_amount: 25 }]);
    assertEquals(queries.includes('erp_purchase_documents'), false);
    assertEquals(queries.includes('procurement_erp_links'), false);
    assert(rpcs.includes('mark_outbox_held'), 'the unresolved mutable payment is held');
  } finally { globalThis.fetch = oldFetch; }
});

Deno.test('AC-ROP-024 captured payment uses the supplier matched to the invoice', async () => {
  const result = await dispatchAs(PAYER_ID, { supplierDrift: true, caseRow: { record_only: true, approved_by_id: null, approved_total_value: null } }, capturedCommand());
  assertEquals(result.status, 200, result.body);
  const post = result.calls.find((c) => c.url.host === ERP_HOST && c.method === 'POST' && c.url.pathname === '/api/resource/Payment%20Entry');
  assert(post);
  assertEquals((post.bodyJson as Record<string, unknown>).party, 'Demo Supplier');
});

Deno.test('AC-ROP-024 changed supplier mapping cannot alter the recovery witness', async () => {
  const result = await dispatchAs(PAYER_ID, { mappingDrift: true, caseRow: { record_only: true, approved_by_id: null, approved_total_value: null } }, capturedCommand());
  assertEquals(result.status, 422, result.body);
  assertEquals(result.calls.filter((c) => c.method === 'POST' && (c.url.host === ERP_HOST || c.url.pathname === '/rest/v1/external_command_outbox')).length, 0);
});

Deno.test('AC-ROP-024 captured invoice accepts a verified bare supplier mapping', async () => {
  const result = await dispatchAs(PAYER_ID, { rawSupplierMapping: true, caseRow: { record_only: true, approved_by_id: null, approved_total_value: null } }, capturedCommand());
  assertEquals(result.status, 200, result.body);
  const post = result.calls.find((c) => c.url.host === ERP_HOST && c.method === 'POST' && c.url.pathname === '/api/resource/Payment%20Entry');
  assert(post);
  assertEquals((post.bodyJson as Record<string, unknown>).party, 'Demo Supplier');
});

Deno.test('AC-ROP-024 stale balance rejection is terminal', async () => {
  const result = await dispatchAs(PAYER_ID, { submitStatus: 422, caseRow: { record_only: true, approved_by_id: null, approved_total_value: null } }, capturedCommand());
  const row = [...result.shared.outbox.values()][0];
  assertEquals(row.state, 'failed');
  assertEquals(row.attempt_count, 5);
  assertEquals(row.last_error, 'captured_invoice_payment_rejected');
  assert(result.body.includes('captured_invoice_payment_rejected'));
  assert(!result.body.includes('private ERP detail'));
  assertEquals(result.calls.filter(c => c.url.pathname === '/rest/v1/payments' && c.method === 'POST').length, 0);
  const { reconcileOrgOutbox } = await import('../erpnext-sweep/index.ts');
  const swept = await reconcileOrgOutbox(
    () => Promise.resolve([...result.shared.outbox.values()].filter(candidate => candidate.state === 'failed' && Number(candidate.attempt_count) < 5) as never),
    { orgId: ORG_ID, ownedDomains: ['procurement'] },
    () => { throw new Error('terminal payment must not be replayed'); },
  );
  assertEquals(swept.reconciled, 0);
  assertEquals(result.shared.paymentPosts, 1);
});

Deno.test('AC-ROP-024 ambiguous captured payment submit stays recoverable', async () => {
  const result = await dispatchAs(PAYER_ID, { submitStatus: 503, caseRow: { record_only: true, approved_by_id: null, approved_total_value: null } }, capturedCommand());
  const row = [...result.shared.outbox.values()][0];
  assertEquals(row.state, 'committing');
  assertEquals(result.calls.filter(c => c.url.pathname.endsWith('/fail_captured_invoice_payment')).length, 0);
  assertEquals(result.shared.paymentPosts, 1);
});

Deno.test('AC-ROP-024 captured payment recovery never adopts an ERP draft', async () => {
  const { buildOutboxProbe } = await import('../erpnext-sweep/index.ts');
  for (const docstatus of [0, 1]) {
    let creates = 0;
    const fetchImpl = (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === 'POST') creates++;
      const url = String(_input);
      const data = url.includes('filters=') ? [{ name: PE_NAME }] : { name: PE_NAME, payment_type: 'Pay', party_type: 'Supplier', docstatus, references: [{ reference_name: PI_NAME }] };
      return Promise.resolve(jsonResponse({ data }));
    };
    const probe = buildOutboxProbe({
      probeDeps: { client: { fetchImpl: fetchImpl as typeof fetch, apiKey: 'test', apiSecret: 'test', baseUrl: ERP_SITE_URL }, doctype: 'Payment Entry', anchorField: 'reference_no', fromDoc: () => ({ id: 'payment' }), pmoRecordId: 'payment' },
      kind: 'payment', anchorField: 'reference_no', anchorMutable: true,
      payload: { capturedInvoiceDocumentId: INV_ID, party: 'Demo Supplier', party_type: 'Supplier', paid_amount: 25, pi_names: [PI_NAME] },
    });
    const result = await probe('procurement', 'intent');
    assertEquals(result === null, docstatus === 0);
    assertEquals(creates, 0);
  }
});

Deno.test('AC-ROP-024 a terminal rejection requires a new checked intent', async () => {
  const shared = newSharedWorld();
  const captured = { caseRow: { record_only: true, approved_by_id: null, approved_total_value: null } };
  const first = await dispatchAs(PAYER_ID, { ...captured, submitStatus: 422 }, capturedCommand(), shared);
  assertEquals([...shared.outbox.values()][0].state, 'failed');
  const replay = await dispatchAs(PAYER_ID, captured, capturedCommand(), shared);
  assert(replay.body.includes('captured_invoice_payment_rejected'));
  assertEquals(shared.paymentPosts, 1);
  const nextCommand = { ...capturedCommand({ id: 'dddddddd-dddd-4ddd-8ddd-000000000911' }), idempotencyKey: 'cccccccc-cccc-4ccc-8ccc-000000000911' };
  const stale = await dispatchAs(PAYER_ID, { ...captured, captureDocs: [] }, nextCommand, shared);
  assertEquals(stale.status, 422);
  assertEquals(shared.paymentPosts, 1);
  const next = await dispatchAs(PAYER_ID, captured, nextCommand, shared);
  assertEquals(next.status, 200, next.body);
  assertEquals(shared.paymentPosts, 2);
  assert(first.body.includes('captured_invoice_payment_rejected'));
});

Deno.test('AC-ROP-024 timeout after captured payment create remains unresolved', async () => {
  const shared = newSharedWorld();
  shared.loseNextPaymentPostResponse = true;
  const result = await dispatchAs(PAYER_ID, { caseRow: { record_only: true, approved_by_id: null, approved_total_value: null } }, capturedCommand(), shared);
  assertEquals([...shared.outbox.values()][0].state, 'committing');
  assertEquals(shared.paymentPosts, 1);
  assertEquals(result.calls.filter(c => c.url.pathname.endsWith('/fail_captured_invoice_payment')).length, 0);
  assertEquals(result.calls.filter(c => c.url.pathname === '/rest/v1/payments' && c.method === 'POST').length, 0);
});

Deno.test('AC-ROP-024 request timeout response remains unresolved', async () => {
  const result = await dispatchAs(PAYER_ID, { submitStatus: 408, caseRow: { record_only: true, approved_by_id: null, approved_total_value: null } }, capturedCommand());
  assertEquals([...result.shared.outbox.values()][0].state, 'committing');
  assertEquals(result.calls.filter(c => c.url.pathname.endsWith('/fail_captured_invoice_payment')).length, 0);
});

Deno.test('AC-ROP-024 ERP server error during submit remains unresolved', async () => {
  const result = await dispatchAs(PAYER_ID, { submitStatus: 500, submitTypeError: true, caseRow: { record_only: true, approved_by_id: null, approved_total_value: null } }, capturedCommand());
  assertEquals([...result.shared.outbox.values()][0].state, 'committing');
  assertEquals(result.calls.filter(c => c.url.pathname.endsWith('/fail_captured_invoice_payment')).length, 0);
  assertEquals(result.shared.paymentPosts, 1);
});

Deno.test('AC-ROP-024 capture then pay once, actual once', async () => {
  const shared = newSharedWorld();
  const world = { caseRow: { record_only: true, approved_by_id: null, approved_total_value: null } };
  const first = capturedCommand({ paid_amount: 25 });
  const second = { ...capturedCommand({ id: 'dddddddd-dddd-4ddd-8ddd-000000000911', paid_amount: 75 }), idempotencyKey: 'cccccccc-cccc-4ccc-8ccc-000000000911' };
  assertEquals(shared.erpInvoices, 1);
  assertEquals(shared.erpOrders, 1);
  assertEquals(shared.submittedPayments, 0);
  const one = await dispatchAs(PAYER_ID, world, first, shared);
  assertEquals(one.status, 200, one.body);
  assertEquals(shared.submittedPayments, 1);
  assertEquals(shared.outstanding, 75);
  assertEquals(shared.erpInvoices, 1);
  assertEquals(shared.erpOrders, 1);
  await dispatchAs(PAYER_ID, world, first, shared);
  assertEquals(shared.submittedPayments, 1);
  const two = await dispatchAs(PAYER_ID, world, second, shared);
  assertEquals(two.status, 200, two.body);
  assertEquals(shared.submittedPayments, 2);
  assertEquals(shared.outstanding, 0);
  await dispatchAs(PAYER_ID, world, second, shared);
  assertEquals(shared.submittedPayments, 2);
  assertEquals(shared.paymentPosts, 2);
  assertEquals(shared.erpInvoices, 1);
  assertEquals(shared.erpOrders, 1);
});

for (const [label, linkOrg, purchase, docOrg] of [
  ['cross-organization', '00000000-0000-4000-8000-000000000000', PROC_ID, '00000000-0000-4000-8000-000000000000'],
  ['cross-purchase', ORG_ID, '00000000-0000-4000-8000-000000000000', ORG_ID],
] as const) {
  Deno.test(`AC-ROP-024 ${label} captured invoice is refused`, async () => {
    const result = await dispatchAs(PAYER_ID, { caseRow: { record_only: true, approved_by_id: null, approved_total_value: null },
      captureDocs: [{ org_id: linkOrg, procurement_id: purchase, erp_purchase_document_id: INV_ID,
        erp_purchase_documents: { id: INV_ID, org_id: docOrg, erp_doctype: 'Purchase Invoice', erp_name: PI_NAME, supplier: 'Demo Supplier', currency: COMPANY_CURRENCY, erp_docstatus: 1, is_return: false, outstanding_amount: 100 } }] }, capturedCommand());
    assertEquals(result.status, 422, result.body);
    assertEquals(result.shared.paymentPosts, 0);
  });
}
