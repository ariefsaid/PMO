// AC-PFE-040: the sweep's purchase feed sends each Purchase Invoice's distinct item-line Purchase Orders
// (upsert_erp_purchase_documents.purchase_orders, 0361). Imports the SHIPPED feed module index.ts uses.
import { feedPurchaseMirror } from '../../../pmo-portal/src/lib/adapterSeam/erpnext/purchaseMirrorFeed.ts';

function assertEquals(actual: unknown, expected: unknown): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

const invoice = (name: string) => ({ name, supplier: 'SUP-1', supplier_name: 'Acme', posting_date: '2026-02-01', due_date: '2026-03-01',
  bill_no: 'B', currency: 'IDR', grand_total: 100, net_total: 100, outstanding_amount: 100, status: 'Unpaid', docstatus: 1,
  is_return: 0, project: null, modified: '2026-02-01 10:00:00' });

Deno.test('AC-PFE-040 sends 2 distinct purchase orders for repeated lines, and [] for an invoice with none', async () => {
  const items = [
    { parent: 'PINV-1', purchase_order: 'PO-1' }, { parent: 'PINV-1', purchase_order: 'PO-2' },
    { parent: 'PINV-1', purchase_order: 'PO-1' }, { parent: 'PINV-2', purchase_order: '' }, { parent: 'PINV-2', purchase_order: null },
  ];
  const fetchImpl = ((input: string) => {
    const doctype = decodeURIComponent(new URL(input).pathname.split('/').pop()!);
    const data = doctype === 'Purchase Invoice' ? [invoice('PINV-1'), invoice('PINV-2')] : doctype === 'Purchase Invoice Item' ? items : [];
    return Promise.resolve(new Response(JSON.stringify({ data }), { status: 200 }));
  }) as unknown as typeof fetch;
  const rows: Array<{ erp_name: string; purchase_orders?: string[] }> = [];
  const table = {
    select: () => table, eq: () => table, maybeSingle: () => Promise.resolve({ data: null, error: null }),
    upsert: () => Promise.resolve({ error: null }),
    update: () => ({ eq: () => ({ eq: () => ({ eq: () => ({ eq: () => Promise.resolve({ count: 1, error: null }) }) }) }) }),
  };
  const sc = {
    from: () => table,
    rpc: (_n: string, a: { p_rows: typeof rows }) => { rows.push(...a.p_rows); return Promise.resolve({ data: a.p_rows.length, error: null }); },
  };
  try {
    await feedPurchaseMirror(sc as never, {
      client: { fetchImpl, apiKey: 'k', apiSecret: 's', baseUrl: 'https://erp.example.test', maxRetries: 0 }, orgId: 'org-1', company: 'Example Co',
    });
  } catch (_e) { /* cursor persistence against the stub is not under test */ }
  assertEquals(rows.find((r) => r.erp_name === 'PINV-1')?.purchase_orders, ['PO-1', 'PO-2']);
  assertEquals(rows.find((r) => r.erp_name === 'PINV-2')?.purchase_orders, []);
});
