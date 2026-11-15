/**
 * A vendor bill sent to ERPNext names its order line, through the SHIPPED served `adapter-dispatch` handler (index.ts via
 * the Deno.serve stub) with `globalThis.fetch` mocked (Supabase's documented edge-function test shape; no dependency
 * injection in production code).
 *   1. Every bill line on the purchase's ERP order carries `purchase_order` + `po_detail`, so ERPNext reads the order billed.
 *   2. A bill above what is left to bill, or (ERPNext 16) dated before its order, is refused (422) by PMO before any
 *      outbox row or ERPNext write.
 *   3. ERPNext's own refusal of a rate that differs from the order reaches the caller with its rule named.
 * The mock ERP refuses what the real one refuses: a submit above the order line's amount left (417, leaves the draft),
 * a rate other than the order's (417 at insert), and on v16 a posting date before the order's.
 * Every route below is a FACT about the world the handler reads; the `unexpected` catch-all names any read not mocked.
 */
import { describe, it } from '@std/testing/bdd';
import { assert, assertEquals } from '@std/assert';
import {
  createJwtAuthority,
  createTestJwksResolver,
  installEdgeEnv,
  jsonResponse,
  withFetchMock,
  type FetchCall,
  type MockRoute,
} from '../_shared/testing/edgeTestKit.ts';
import { installErpCredentials, ERP_HOST, ERP_SITE_URL } from './bfyServedFixture.ts';
import { PI_ID, PROC_ID, supabaseBillRoutes, USER_ID, VENDOR_ID } from './billOrderLinkFixture.ts';

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

const ERP_PI = 'ACC-PINV-2026-00099';
const BILL = { id: PI_ID, procurementId: PROC_ID, vendorId: VENDOR_ID, erp_doc_kind: 'purchase-invoice',
  items: [{ item_code: 'DEMO-ITEM', qty: 1, rate: 1000000 }, { item_code: 'FREIGHT', qty: 1, rate: 50000 }] };
const PO = 'PUR-ORD-2026-00099';
const PO_LINE = 'po-line-cable';
const PI_HEADER = { name: ERP_PI, docstatus: 1, grand_total: 1050000, total_taxes_and_charges: 0,
  taxes_and_charges_deducted: 0, outstanding_amount: 1050000, taxes_and_charges: '' };

interface World { billedAmt?: number; version?: number; orderDate?: string; orderRate?: number }

/** What the real ERPNext does with a bill POST/submit against the order below (bed A3c, A4, v16 date rule). */
function erpRefusal(call: FetchCall, w: Required<World>): Response | null {
  const body = call.bodyJson as { items?: Array<Record<string, unknown>> } | undefined;
  const rate = body?.items?.find((i) => i.po_detail === PO_LINE)?.rate;
  if (call.method === 'POST' && rate !== undefined && rate !== w.orderRate) {
    return jsonResponse({ exc_type: 'ValidationError', _server_messages: JSON.stringify([JSON.stringify({ message: `Row #1: Rate must be same as Purchase Order: ${PO}` })]) }, { status: 417 });
  }
  if (call.method === 'POST' && w.version === 16 && body?.items?.some((i) => i.po_detail) && w.orderDate > new Date().toISOString().slice(0, 10)) {
    return jsonResponse({ exc_type: 'ValidationError', _server_messages: JSON.stringify([JSON.stringify({ message: `Posting Date cannot be before Purchase Order date` })]) }, { status: 417 });
  }
  return null;
}

function routes(unexpected: FetchCall[], world: World): MockRoute[] {
  const w: Required<World> = { billedAmt: 0, version: 15, orderDate: '2026-01-01', orderRate: 1000000, ...world };
  return [
    ...supabaseBillRoutes({ po: PO, site: ERP_SITE_URL, version: w.version }),
    {
      label: 'ERP Item catalog', host: ERP_HOST, pathname: '/api/resource/Item',
      response: () => jsonResponse({ data: [
        { name: 'DEMO-ITEM', disabled: 0, is_sales_item: 0, is_purchase_item: 1 },
        { name: 'FREIGHT', disabled: 0, is_sales_item: 0, is_purchase_item: 1 },
      ] }),
    },
    { label: 'ERP default purchase tax template (none)', host: ERP_HOST, pathname: '/api/resource/Purchase%20Taxes%20and%20Charges%20Template',
      response: () => jsonResponse({ data: [] }) },
    {
      label: 'ERP Purchase Order read', host: ERP_HOST, pathname: `/api/resource/Purchase%20Order/${PO}`,
      response: () => jsonResponse({ data: { name: PO, docstatus: 1, transaction_date: w.orderDate,
        items: [{ name: PO_LINE, item_code: 'DEMO-ITEM', qty: 2, rate: w.orderRate, amount: 2000000, billed_amt: w.billedAmt }] } }),
    },
    {
      label: 'ERP Purchase Invoice list / create', host: ERP_HOST, pathname: '/api/resource/Purchase%20Invoice',
      response: (call) => call.method === 'POST'
        ? erpRefusal(call, w) ?? jsonResponse({ data: { ...(call.bodyJson as Record<string, unknown>), ...PI_HEADER, docstatus: 0 } })
        : jsonResponse({ data: [] }),
    },
    {
      label: 'ERP Purchase Invoice submit / read', host: ERP_HOST, pathname: /^\/api\/resource\/Purchase%20Invoice\/.+$/,
      response: () => jsonResponse({ data: PI_HEADER }),
    },
    { label: 'unexpected', response: (call) => { unexpected.push(call); return jsonResponse({ message: 'unmocked' }, { status: 404 }); } },
  ];
}

async function dispatch(world: World, idempotencyKey: string) {
  const unexpected: FetchCall[] = [];
  const result = await withFetchMock(routes(unexpected, world), async ({ calls }) => {
    const jwt = await auth.mintJwt({ sub: USER_ID });
    const res = await servedHandler!(new Request('http://edge.test/adapter-dispatch', {
      method: 'POST',
      headers: { authorization: `Bearer ${jwt}`, 'content-type': 'application/json' },
      body: JSON.stringify({ domain: 'procurement', operation: 'create', idempotencyKey, record: BILL }),
    }));
    return { status: res.status, body: await res.text(), calls };
  });
  const erpWrites = result.calls.filter((c) => c.url.host === ERP_HOST && c.method !== 'GET');
  const outboxInserts = result.calls.filter((c) => c.method === 'POST' && c.url.pathname === '/rest/v1/external_command_outbox');
  return { ...result, unexpected, erpWrites, outboxInserts };
}

describe('a vendor bill names its ERP order line through the served adapter-dispatch', () => {
  it('the one Purchase Invoice POST carries the order and its line on the line the order has; a freight line stays free-standing', async () => {
    const r = await dispatch({}, 'aaaaaaaa-aaaa-4aaa-8aaa-000000000099');
    assertEquals(r.unexpected.map((c) => `${c.method} ${c.url.pathname}${c.url.search}`), [], 'every read is mocked');
    assertEquals(r.status, 200, r.body);
    const posts = r.erpWrites.filter((c) => c.method === 'POST');
    assertEquals(posts.length, 1, r.body);
    const items = (posts[0].bodyJson as { items: Array<Record<string, unknown>> }).items;
    assertEquals(items[0], { item_code: 'DEMO-ITEM', qty: 1, rate: 1000000, purchase_order: PO, po_detail: PO_LINE });
    assertEquals(items[1], { item_code: 'FREIGHT', qty: 1, rate: 50000 });
  });

  it('a bill above what is left to bill is refused (422) with the amount left, before any outbox row or ERPNext write', async () => {
    const r = await dispatch({ billedAmt: 1500000 }, 'bbbbbbbb-bbbb-4bbb-8bbb-000000000099');
    assertEquals(r.unexpected.map((c) => `${c.method} ${c.url.pathname}${c.url.search}`), [], 'every read is mocked');
    assertEquals(r.status, 422, r.body);
    assert(r.body.includes('has 500000.00 left to bill for DEMO-ITEM; this bill asks 1000000.00'), r.body);
    assertEquals(r.erpWrites.length, 0, 'no ERPNext write, so no draft is left');
    assertEquals(r.outboxInserts.length, 0);
  });

  it('ERPNext 16: a bill dated before its order is refused (422) with the order date, before any outbox row or ERPNext write', async () => {
    const r = await dispatch({ version: 16, orderDate: '2999-01-01' }, 'cccccccc-cccc-4ccc-8ccc-000000000099');
    assertEquals(r.unexpected.map((c) => `${c.method} ${c.url.pathname}${c.url.search}`), [], 'every read is mocked');
    assertEquals(r.status, 422, r.body);
    assert(r.body.includes('2999-01-01') && r.body.includes('cannot be billed before that date'), r.body);
    assertEquals(r.erpWrites.length, 0);
    assertEquals(r.outboxInserts.length, 0);
  });

  it("ERPNext's refusal of a rate that differs from the order reaches the caller with its rule named", async () => {
    const r = await dispatch({ orderRate: 900000 }, 'dddddddd-dddd-4ddd-8ddd-000000000099');
    assertEquals(r.unexpected.map((c) => `${c.method} ${c.url.pathname}${c.url.search}`), [], 'every read is mocked');
    assert(r.status >= 400 && r.status < 500, r.body);
    assert(r.body.includes('Rate must be same as Purchase Order'), r.body);
  });
});
