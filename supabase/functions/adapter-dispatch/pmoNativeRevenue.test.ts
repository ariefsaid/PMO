/**
 * #784 — revenue commands through the ERP path only ever target ERP-path rows.
 *
 * Invoices and receipts raised in PMO (`pmo_native`, migration 0275) are approved, settled and cancelled by
 * PMO's own RPCs. The ERP path (this function) therefore:
 *   • refuses any revenue command whose `record.id` is a PMO-native invoice or receipt, and any receipt
 *     command that cites a PMO-native invoice (`record.salesInvoiceId`);
 *   • refuses a revenue `create` whose `record.id` already exists as a sales invoice or customer receipt —
 *     a create always names a new record — except this command's own retry (same idempotency key).
 * Every refusal happens before the outbox and before any ERP call.
 *
 * Drives the SHIPPED served handler (index.ts via the Deno.serve stub) with `globalThis.fetch` mocked, plus
 * the exported guards directly for the retry exemption and lookup-failure branches.
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
import { checkCreateTargetUnmapped, checkRevenueErpPathTarget, type GuardLookupClient } from './transitionTargetGuard.ts';

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
const PROJECT_ID = '33333333-3333-4333-8333-333333333333';
const CUSTOMER_ID = '55555555-5555-4555-8555-555555555555';
const NATIVE_SI = '66666666-6666-4666-8666-666666666601';
const ERP_SI = '66666666-6666-4666-8666-666666666602';
/** An ERP-path invoice with no external mapping yet (e.g. a draft whose create has not landed). */
const UNMAPPED_SI = '66666666-6666-4666-8666-666666666603';
const NATIVE_RC = '77777777-7777-4777-8777-777777777701';
const ERP_RC = '77777777-7777-4777-8777-777777777702';
const FRESH_ID = '99999999-9999-4999-8999-999999999901';
const KEY = '88888888-8888-4888-8888-888888888801';

/** The two revenue tables as the service role sees them: id → pmo_native. */
const ROWS: Record<string, Record<string, boolean>> = {
  sales_invoices: { [NATIVE_SI]: true, [ERP_SI]: false, [UNMAPPED_SI]: false },
  incoming_payments: { [NATIVE_RC]: true, [ERP_RC]: false },
};

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

function revenueRow(table: string) {
  return (call: FetchCall) => {
    const id = eqParam(call, 'id');
    if (id && id in ROWS[table]) {
      return objectResponse({ id, org_id: ORG_ID, project_id: PROJECT_ID, customer_id: CUSTOMER_ID, pmo_native: ROWS[table][id] });
    }
    return nullObjectResponse();
  };
}

function routes(unexpected: FetchCall[]): MockRoute[] {
  return [
    supabaseSelect('profiles', (call) =>
      call.url.searchParams.has('role') ? jsonResponse([{ id: USER_ID }]) : objectResponse({ org_id: ORG_ID })),
    supabaseRpc('domain_owned_by_tier', () => jsonResponse(true)),
    supabaseRpc('org_has_active_erpnext_binding', () => jsonResponse(true)),
    supabaseRpc('actor_authorization_state', () => jsonResponse({ role: 'Finance', active: true })),
    supabaseRpc('get_process_gates', () => jsonResponse({ require_project_on_si: false })),
    supabaseRpc('read_vault_secret', () => jsonResponse(null)),
    supabaseSelect('external_org_bindings', () => objectResponse({
      site_url: ERP_SITE_URL, secret_ref: SECRET_REF, activated_at: '2026-01-01T00:00:00+00:00', version_major: 15,
      config: { company: COMPANY, cost_center: 'Main - DEMO', default_receivable_account: 'Debtors - DEMO' },
    })),
    supabaseSelect('sales_invoices', revenueRow('sales_invoices')),
    supabaseSelect('incoming_payments', revenueRow('incoming_payments')),
    supabaseSelect('external_refs', (call) => {
      // Every ERP-path row is mapped; a PMO-native row never is.
      const pmo = eqParam(call, 'pmo_record_id');
      if (pmo === ERP_SI) return objectResponse({ external_record_id: 'ACC-SINV-0001' });
      if (pmo === ERP_RC) return objectResponse({ external_record_id: 'ACC-PAY-0001' });
      return nullObjectResponse();
    }),
    supabaseSelect('external_command_outbox', () => nullObjectResponse()),
    { label: 'unexpected', response: (call) => { unexpected.push(call); return jsonResponse({ message: 'unmocked' }, { status: 404 }); } },
  ];
}

async function dispatch(command: Record<string, unknown>) {
  const unexpected: FetchCall[] = [];
  return await withFetchMock(routes(unexpected), async ({ calls }) => {
    const jwt = await auth.mintJwt({ sub: USER_ID });
    const res = await servedHandler!(new Request('http://edge.test/adapter-dispatch', {
      method: 'POST',
      headers: { authorization: `Bearer ${jwt}`, 'content-type': 'application/json' },
      body: JSON.stringify({ idempotencyKey: KEY, ...command }),
    }));
    return { status: res.status, body: await res.text(), calls, unexpected };
  });
}

/** Nothing left the edge function toward the ERP or the outbox, and no SoD / authorship RPC ran. */
function assertRefusedBeforeAnyWrite(result: Awaited<ReturnType<typeof dispatch>>) {
  assertEquals(result.status, 422,
    `${result.body} — unmocked: ${result.unexpected.map((c) => `${c.method} ${c.url.pathname}${c.url.search}`).join(', ')}`);
  assertEquals(result.calls.filter((c) => c.url.host === ERP_HOST).length, 0, 'no ERP call');
  assertEquals(result.calls.filter((c) => c.url.pathname === '/rest/v1/external_command_outbox' && c.method !== 'GET').length, 0,
    'no outbox row');
  for (const fn of ['grant_sales_invoice_submit_clearance', 'claim_sales_invoice_author', 'record_outbox_ref']) {
    assertEquals(result.calls.filter((c) => c.url.pathname === `/rest/v1/rpc/${fn}`).length, 0, `no ${fn}`);
  }
}

describe('#784 the ERP path never acts on a PMO-native invoice or receipt', () => {
  it('a sales-invoice submit naming a PMO-native invoice is refused before any write', async () => {
    const result = await dispatch({ domain: 'revenue', operation: 'transition',
      record: { id: NATIVE_SI, erp_doc_kind: 'sales-invoice', verb: 'submit' } });
    assertRefusedBeforeAnyWrite(result);
    assert(/raised in PMO/.test(result.body), result.body);
  });

  it('a sales-invoice update naming a PMO-native invoice is refused before any write', async () => {
    const result = await dispatch({ domain: 'revenue', operation: 'update',
      record: { id: NATIVE_SI, erp_doc_kind: 'sales-invoice', items: [{ item_code: 'SVC', qty: 1, rate: 1 }] } });
    assertRefusedBeforeAnyWrite(result);
    assert(/raised in PMO/.test(result.body), result.body);
  });

  it('a receipt cancel naming a PMO-native receipt is refused before any write', async () => {
    const result = await dispatch({ domain: 'revenue', operation: 'transition',
      record: { id: NATIVE_RC, erp_doc_kind: 'incoming-payment', verb: 'cancel' } });
    assertRefusedBeforeAnyWrite(result);
    assert(/raised in PMO/.test(result.body), result.body);
  });

  it('a receipt create citing a PMO-native invoice is refused before any write', async () => {
    const result = await dispatch({ domain: 'revenue', operation: 'create',
      record: { id: FRESH_ID, erp_doc_kind: 'incoming-payment', customerId: CUSTOMER_ID, salesInvoiceId: NATIVE_SI,
        paid_amount: 100 } });
    assertRefusedBeforeAnyWrite(result);
    assert(/raised in PMO/.test(result.body), result.body);
  });

  it('a sales-invoice create reusing a PMO-native invoice id is refused before any write', async () => {
    const result = await dispatch({ domain: 'revenue', operation: 'create',
      record: { id: NATIVE_SI, erp_doc_kind: 'sales-invoice', customerId: CUSTOMER_ID, projectId: PROJECT_ID,
        items: [{ item_code: 'SVC', qty: 1, rate: 1 }] } });
    assertRefusedBeforeAnyWrite(result);
  });
});

describe('#784 a revenue create always names a new record', () => {
  it('a sales-invoice create reusing an existing (unmapped) sales invoice id is refused before any write', async () => {
    // The row exists but has no external mapping yet — the mapping check alone would let it through.
    ROWS.sales_invoices[FRESH_ID] = false;
    try {
      const result = await dispatch({ domain: 'revenue', operation: 'create',
        record: { id: FRESH_ID, erp_doc_kind: 'sales-invoice', customerId: CUSTOMER_ID, projectId: PROJECT_ID,
          items: [{ item_code: 'SVC', qty: 1, rate: 1 }] } });
      assertRefusedBeforeAnyWrite(result);
      assert(/new record/.test(result.body), result.body);
    } finally {
      delete ROWS.sales_invoices[FRESH_ID];
    }
  });

  it('a receipt create reusing an existing customer receipt id is refused before any write', async () => {
    ROWS.incoming_payments[FRESH_ID] = false;
    try {
      const result = await dispatch({ domain: 'revenue', operation: 'create',
        record: { id: FRESH_ID, erp_doc_kind: 'incoming-payment', customerId: CUSTOMER_ID, salesInvoiceId: ERP_SI,
          paid_amount: 100 } });
      assertRefusedBeforeAnyWrite(result);
      assert(/new record/.test(result.body), result.body);
    } finally {
      delete ROWS.incoming_payments[FRESH_ID];
    }
  });

  it('a receipt create reusing a sales invoice id is refused too (either table occupies the identity)', async () => {
    const result = await dispatch({ domain: 'revenue', operation: 'create',
      record: { id: UNMAPPED_SI, erp_doc_kind: 'incoming-payment', customerId: CUSTOMER_ID, paid_amount: 100 } });
    assertRefusedBeforeAnyWrite(result);
    assert(/new record/.test(result.body), result.body);
  });
});

describe('#784 a revenue command names its record by its canonical uuid', () => {
  it('an incoming-payment create whose record.id is not a uuid is refused 422 before any ERP call or outbox/ref write', async () => {
    const result = await dispatch({ domain: 'revenue', operation: 'create',
      record: { id: 'not-a-uuid', erp_doc_kind: 'incoming-payment', customerId: CUSTOMER_ID, paid_amount: 100 } });
    assertRefusedBeforeAnyWrite(result);
    assert(/canonical uuid/i.test(result.body), result.body);
  });

  it('a sales-invoice create with a non-uuid record.id is refused too — every erp_doc_kind', async () => {
    const result = await dispatch({ domain: 'revenue', operation: 'create',
      record: { id: 'invoice-7', erp_doc_kind: 'sales-invoice', customerId: CUSTOMER_ID, projectId: PROJECT_ID,
        items: [{ item_code: 'SVC', qty: 1, rate: 1 }] } });
    assertRefusedBeforeAnyWrite(result);
    assert(/canonical uuid/i.test(result.body), result.body);
  });
});

// ── The guards directly: the retry exemption, the controls, and fail-closed lookups ──────────────────────

/** Service-role read seam over the two revenue tables, external_refs and the outbox. */
function fakeClient(opts: {
  rows?: Record<string, Record<string, boolean>>;
  mapped?: boolean;
  outboxKeys?: string[];
  failTable?: string;
}): GuardLookupClient & { reads: string[] } {
  const reads: string[] = [];
  const lookup = (table: string, filters: Record<string, string>) => {
    if (opts.failTable === table) return { data: null, error: { message: 'synthetic failure' } };
    if (table === 'external_refs') return { data: opts.mapped ? { external_record_id: 'X' } : null, error: null };
    if (table === 'external_command_outbox') {
      return { data: (opts.outboxKeys ?? []).includes(filters.idempotency_key) ? { id: 'o' } : null, error: null };
    }
    const native = opts.rows?.[table]?.[filters.id];
    return { data: native === undefined ? null : { id: filters.id, pmo_native: native }, error: null };
  };
  const client = {
    reads,
    from(table: string) {
      const filters: Record<string, string> = {};
      const builder = {
        eq(column: string, value: string) { filters[column] = value; return builder; },
        maybeSingle() {
          reads.push(table);
          return Promise.resolve(lookup(table, filters));
        },
      };
      return { select: (_columns: string) => builder };
    },
  };
  return client as unknown as GuardLookupClient & { reads: string[] };
}

const siCreate = (id: string) => ({ domain: 'revenue', operation: 'create', record: { id, erp_doc_kind: 'sales-invoice' } });

describe('#784 guards — retry exemption, controls and fail-closed lookups', () => {
  it('this command\'s own retry (same idempotency key) of an existing ERP-path row is allowed to finalize', async () => {
    const client = fakeClient({ rows: { sales_invoices: { [ERP_SI]: false } }, mapped: true, outboxKeys: [KEY] });
    assertEquals((await checkCreateTargetUnmapped(client, ORG_ID, siCreate(ERP_SI), KEY)).ok, true);
  });

  it('a different idempotency key on an existing row is refused', async () => {
    const client = fakeClient({ rows: { sales_invoices: { [ERP_SI]: false } }, outboxKeys: [KEY] });
    const res = await checkCreateTargetUnmapped(client, ORG_ID, siCreate(ERP_SI), '88888888-8888-4888-8888-888888888802');
    assertEquals(res.ok, false);
    assertEquals(res.status, 422);
  });

  it('CONTROL a create naming a genuinely new id passes, after reading both revenue tables', async () => {
    const client = fakeClient({});
    assertEquals((await checkCreateTargetUnmapped(client, ORG_ID, siCreate(FRESH_ID), KEY)).ok, true);
    assert(client.reads.includes('sales_invoices') && client.reads.includes('incoming_payments'), client.reads.join());
    assertEquals((await checkRevenueErpPathTarget(client, siCreate(FRESH_ID))).ok, true);
  });

  it('CONTROL an ERP-path invoice passes the PMO-native guard', async () => {
    const client = fakeClient({ rows: { sales_invoices: { [ERP_SI]: false } } });
    const res = await checkRevenueErpPathTarget(client,
      { domain: 'revenue', operation: 'transition', record: { id: ERP_SI, erp_doc_kind: 'sales-invoice', verb: 'submit' } });
    assertEquals(res.ok, true);
  });

  it('a PMO-native row is refused even on this command\'s own retry', async () => {
    const client = fakeClient({ rows: { sales_invoices: { [NATIVE_SI]: true } }, mapped: true, outboxKeys: [KEY] });
    const res = await checkRevenueErpPathTarget(client, siCreate(NATIVE_SI));
    assertEquals(res.ok, false);
    assertEquals(res.status, 422);
  });

  it('a non-revenue command is never looked up', async () => {
    const client = fakeClient({ rows: { sales_invoices: { [NATIVE_SI]: true } } });
    assertEquals((await checkRevenueErpPathTarget(client,
      { domain: 'procurement', operation: 'create', record: { id: NATIVE_SI, erp_doc_kind: 'purchase-invoice' } })).ok, true);
    assertEquals(client.reads.length, 0);
  });

  it('a revenue command whose record.id is not a canonical uuid is refused before the row lookups', async () => {
    const client = fakeClient({ rows: { sales_invoices: { [NATIVE_SI]: true } } });
    for (const kind of ['incoming-payment', 'sales-invoice']) {
      const res = await checkRevenueErpPathTarget(client,
        { domain: 'revenue', operation: 'create', record: { id: 'not-a-uuid', erp_doc_kind: kind } });
      assertEquals(res.ok, false);
      assertEquals(res.status, 422);
    }
    // Refused on the id's shape alone — neither revenue table is read.
    assertEquals(client.reads.length, 0);
  });

  it('a revenue-row lookup failure fails closed (503) in both guards', async () => {
    for (const failTable of ['sales_invoices', 'incoming_payments']) {
      const client = fakeClient({ failTable });
      assertEquals((await checkRevenueErpPathTarget(client, siCreate(FRESH_ID))).status, 503);
      assertEquals((await checkCreateTargetUnmapped(client, ORG_ID, siCreate(FRESH_ID), KEY)).status, 503);
    }
  });
});
