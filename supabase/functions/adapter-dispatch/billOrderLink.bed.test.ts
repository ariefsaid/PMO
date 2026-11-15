// Vendor bill order link against a REAL ERPNext bench (v15 or v16): the SHIPPED `adapter-dispatch` handler (index.ts via the
// Deno.serve stub) with its Supabase side mocked (billOrderLinkFixture.ts) and every ERPNext call passed through to the bench.
// Run once per bench, the bed lock taken first (nothing touches the bench before it), ERPNEXT_BENCH_* naming the bench and
// a throwaway API user; PMO_BED_REQUIRED=1 makes missing settings fail instead of ignoring the acceptance:
//   PMO_BED_REQUIRED=1 ERPNEXT_BENCH_URL=http://localhost:8080 ERPNEXT_BENCH_API_KEY=… ERPNEXT_BENCH_API_SECRET=… \
//   ERPNEXT_BENCH_COMPANY=… ERPNEXT_BENCH_STAMP=ZZBILL… scripts/with-erpnext-lock.sh deno test --allow-all \
//   --config supabase/functions/adapter-dispatch/deno.json supabase/functions/adapter-dispatch/billOrderLink.bed.test.ts
// Every probe document is named by the stamp (its supplier, its item) so the bench-side clean-up finds all of them.
import { assert, assertEquals } from '@std/assert';
import { createJwtAuthority, createTestJwksResolver, installEdgeEnv, withFetchMock, type FetchCall } from '../_shared/testing/edgeTestKit.ts';
import { installErpCredentials } from './bfyServedFixture.ts';
import { PI_ID, PROC_ID, supabaseBillRoutes, USER_ID, VENDOR_ID } from './billOrderLinkFixture.ts';

const realFetch = globalThis.fetch;
const required = (key: string) => Deno.env.get(key) ?? '';
const bench = { url: required('ERPNEXT_BENCH_URL'), key: required('ERPNEXT_BENCH_API_KEY'), secret: required('ERPNEXT_BENCH_API_SECRET'),
  company: required('ERPNEXT_BENCH_COMPANY'), stamp: required('ERPNEXT_BENCH_STAMP') };
const ready = Object.values(bench).every(Boolean);
if (!ready && Deno.env.get('PMO_BED_REQUIRED') === '1') throw new Error('Real ERP acceptance requires the bench settings');

const env = installEdgeEnv({ SUPABASE_URL: 'http://127.0.0.1:54321' });
Deno.env.set('SUPABASE_ANON_KEY', 'test-anon-key');
Deno.env.set('ERPNEXT_ALLOW_LOCAL_BENCH', '1');
if (ready) Deno.env.set('ERPNEXT_LOCAL_BENCH_ORIGINS', new URL(bench.url).origin);
const restoreCreds = installErpCredentials();
const auth = await createJwtAuthority(env.SUPABASE_URL);
let servedHandler: ((req: Request) => Promise<Response>) | null = null;
(Deno as unknown as { serve: (h: unknown) => unknown }).serve = (h: unknown) => {
  servedHandler = h as (req: Request) => Promise<Response>;
  return { finished: Promise.resolve() };
};
const { setTestJwks } = await import('./index.ts');
setTestJwks(createTestJwksResolver(auth));
addEventListener('unload', () => { restoreCreds(); env.restore(); });

const authHeader = `token ${bench.key}:${bench.secret}`;
async function erp(method: string, path: string, body?: unknown): Promise<Record<string, unknown>> {
  const response = await realFetch(`${bench.url}${path}`, { method, headers: { authorization: authHeader, 'content-type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
  const text = await response.text();
  if (!response.ok) throw new Error(`ERP ${method} ${path} returned ${response.status}: ${text.slice(0, 300)}`);
  const parsed = JSON.parse(text);
  return parsed.data ?? parsed.message ?? parsed;
}
const docPath = (type: string, name: string) => `/api/resource/${encodeURIComponent(type)}/${encodeURIComponent(name)}`;
const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);
async function countFor(type: string): Promise<number> {
  const query = new URLSearchParams({ filters: JSON.stringify([['supplier', '=', SUPPLIER]]), fields: JSON.stringify(['name']), limit_page_length: '500' });
  return ((await erp('GET', `/api/resource/${encodeURIComponent(type)}?${query}`)) as unknown as unknown[]).length;
}
const SUPPLIER = `${bench.stamp} Supplier`;
const ITEM = `${bench.stamp}-ITEM`;

/** A vendor bill for `qty` of the probe item at 100, dispatched through the shipped handler against the bench. */
async function dispatchBill(order: string, version: number, qty: number, key: string) {
  const record = { id: PI_ID, procurementId: PROC_ID, vendorId: VENDOR_ID, erp_doc_kind: 'purchase-invoice', items: [{ item_code: ITEM, qty, rate: 100 }] };
  const routes = [
    ...supabaseBillRoutes({ po: order, site: bench.url, version, supplier: SUPPLIER, company: bench.company }),
    { label: 'real bench', host: new URL(bench.url).host, response: (call: FetchCall) => {
      // the handler signs with the fixture's placeholder credentials; the bench is reached with the throwaway user's
      const headers = new Headers(call.headers); headers.set('authorization', authHeader);
      return realFetch(call.url, { method: call.method, headers, ...(call.bodyText ? { body: call.bodyText } : {}) });
    } },
    { label: 'unexpected', response: (call: FetchCall) => { throw new Error(`unmocked ${call.method} ${call.url}`); } },
  ];
  return await withFetchMock(routes, async ({ calls }) => {
    const jwt = await auth.mintJwt({ sub: USER_ID });
    const res = await servedHandler!(new Request('http://edge.test/adapter-dispatch', { method: 'POST',
      headers: { authorization: `Bearer ${jwt}`, 'content-type': 'application/json' },
      body: JSON.stringify({ domain: 'procurement', operation: 'create', idempotencyKey: key, record }) }));
    const erpCalls = calls.filter((c) => c.url.host === new URL(bench.url).host);
    return { status: res.status, body: await res.text(), erpWrites: erpCalls.filter((c) => c.method !== 'GET'), erpCalls };
  });
}

Deno.test({
  name: 'a vendor bill sent through adapter-dispatch makes the real order and receipt read billed; an over-bill and (v16) a bill before its order are refused by PMO',
  ignore: !ready,
  fn: async () => {
    for (const address of [bench.url]) {
      if (!['127.0.0.1', 'localhost', '::1'].includes(new URL(address).hostname)) throw new Error('Real ERP acceptance requires a local bench');
    }
    const versions = await erp('GET', '/api/method/frappe.utils.change_log.get_versions');
    const version = Number((versions.erpnext as { version: string }).version.split('.')[0]);
    console.log(`ERPNext major: ${version}`);
    assert(version === 15 || version === 16, 'bench must be ERPNext 15 or 16');
    const warehouseQuery = new URLSearchParams({ filters: JSON.stringify([['company', '=', bench.company], ['is_group', '=', 0]]), fields: JSON.stringify(['name']), limit_page_length: '20' });
    const warehouses = await erp('GET', `/api/resource/Warehouse?${warehouseQuery}`) as unknown as Array<{ name: string }>;
    const warehouse = (warehouses.find((w) => w.name.startsWith('Stores')) ?? warehouses[0]).name;
    const leafGroup = async (type: string) => (await erp('GET', `/api/resource/${encodeURIComponent(type)}?${new URLSearchParams({ filters: JSON.stringify([['is_group', '=', 0]]), limit_page_length: '1' })}`) as unknown as Array<{ name: string }>)[0].name;
    const groups = [{ name: await leafGroup('Supplier Group') }]; const itemGroups = [{ name: await leafGroup('Item Group') }];
    await erp('POST', '/api/resource/Supplier', { supplier_name: SUPPLIER, supplier_group: groups[0].name });
    await erp('POST', '/api/resource/Item', { item_code: ITEM, item_name: ITEM, item_group: itemGroups[0].name, stock_uom: 'Nos', is_stock_item: 1 });

    async function makeOrder(date: string): Promise<{ name: string; line: string }> {
      const name = String((await erp('POST', '/api/resource/Purchase Order', { company: bench.company, supplier: SUPPLIER, transaction_date: date, schedule_date: date,
        items: [{ item_code: ITEM, qty: 4, rate: 100, warehouse, schedule_date: date }] })).name);
      await erp('PUT', docPath('Purchase Order', name), { docstatus: 1 });
      const doc = await erp('GET', docPath('Purchase Order', name));
      return { name, line: (doc.items as Array<{ name: string }>)[0].name };
    }
    async function order(name: string) { return await erp('GET', docPath('Purchase Order', name)); }

    // (a) an order with no receipt: the bill names the order line, the order reads billed.
    const a = await makeOrder(day(-1));
    const billA = await dispatchBill(a.name, version, 4, crypto.randomUUID());
    assertEquals(billA.status, 200, billA.body);
    const orderA = await order(a.name);
    console.log(`(a) order ${a.name}: status=${orderA.status} per_billed=${orderA.per_billed}`);
    assertEquals(Number(orderA.per_billed), 100);
    assertEquals(orderA.status, 'To Receive');

    // (b) an order with its receipt: the bill makes the order Completed and the receipt read billed.
    const b = await makeOrder(day(-1));
    const receipt = String((await erp('POST', '/api/resource/Purchase Receipt', { company: bench.company, supplier: SUPPLIER,
      items: [{ item_code: ITEM, qty: 4, rate: 100, warehouse, purchase_order: b.name, purchase_order_item: b.line }] })).name);
    await erp('PUT', docPath('Purchase Receipt', receipt), { docstatus: 1 });
    const billB = await dispatchBill(b.name, version, 4, crypto.randomUUID());
    assertEquals(billB.status, 200, billB.body);
    const orderB = await order(b.name); const receiptB = await erp('GET', docPath('Purchase Receipt', receipt));
    console.log(`(b) order ${b.name}: status=${orderB.status} per_billed=${orderB.per_billed}; receipt ${receipt}: status=${receiptB.status} per_billed=${receiptB.per_billed}`);
    assertEquals([orderB.status, Number(orderB.per_billed)], ['Completed', 100]);
    assertEquals(Number(receiptB.per_billed), 100);

    // (c) an over-bill: 3 of 4 billed, then 3 more. PMO refuses the second before any ERPNext write; no draft is left.
    const c = await makeOrder(day(-1));
    const billC1 = await dispatchBill(c.name, version, 3, crypto.randomUUID());
    assertEquals(billC1.status, 200, billC1.body);
    assertEquals(Number((await order(c.name)).per_billed), 75);
    const billsBefore = await countFor('Purchase Invoice');
    const billC2 = await dispatchBill(c.name, version, 3, crypto.randomUUID());
    console.log(`(c) over-bill: status=${billC2.status} erp_writes=${billC2.erpWrites.length} erp_calls=${billC2.erpCalls.length} body=${billC2.body}`);
    assertEquals(billC2.status, 422, billC2.body);
    assert(billC2.body.includes('left to bill'), billC2.body);
    assertEquals(billC2.erpWrites.length, 0, 'the refusal made no ERPNext write');
    assertEquals(await countFor('Purchase Invoice'), billsBefore, 'no draft bill is left in ERPNext');
    assertEquals(Number((await order(c.name)).per_billed), 75);

    // (d) an order dated after today: ERPNext 16 refuses a bill dated before it, so PMO refuses first; ERPNext 15 has no such rule.
    const d = await makeOrder(day(3));
    const billsBeforeD = await countFor('Purchase Invoice');
    const billD = await dispatchBill(d.name, version, 4, crypto.randomUUID());
    console.log(`(d) order dated ${day(3)}, v${version}: status=${billD.status} erp_writes=${billD.erpWrites.length} body=${billD.body}`);
    if (version === 16) {
      assertEquals(billD.status, 422, billD.body);
      assert(billD.body.includes('cannot be billed before that date'), billD.body);
      assertEquals(billD.erpWrites.length, 0, 'the refusal made no ERPNext write');
      assertEquals(await countFor('Purchase Invoice'), billsBeforeD);
    } else {
      assertEquals(billD.status, 200, billD.body);
    }
  },
});
