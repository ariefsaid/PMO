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
  // Stateful watermark table: upsert stores by domain, select/eq/maybeSingle reads it back.
  const stored = new Map<string, string>();
  const from = () => {
    let domain = '';
    const q = {
      select: () => q,
      eq: (col: string, v: string) => { if (col === 'domain') domain = v; return q; },
      maybeSingle: () => Promise.resolve({ data: stored.has(domain) ? { watermark_cursor: stored.get(domain) } : null, error: null }),
      update: (patch: { watermark_cursor: string }) => {
        const u = {
          eq: (col: string, v: string) => { if (col === 'domain') domain = v; return u; },
          then: (ok: (v: unknown) => unknown) => { stored.set(domain, patch.watermark_cursor); return Promise.resolve({ count: 1, error: null }).then(ok); },
        };
        return u;
      },
      upsert: (row: { domain: string; watermark_cursor: string }) => { stored.set(row.domain, row.watermark_cursor); return Promise.resolve({ error: null }); },
    };
    return q;
  };
  const sc = {
    from,
    rpc: (_n: string, a: { p_rows: typeof rows }) => { rows.push(...a.p_rows); return Promise.resolve({ data: a.p_rows.length, error: null }); },
  };
  const result = await feedPurchaseMirror(sc as never, {
    client: { fetchImpl, apiKey: 'k', apiSecret: 's', baseUrl: 'https://erp.example.test', maxRetries: 0 }, orgId: 'org-1', company: 'Example Co',
  });
  assertEquals(result.caughtUp, true);
  assertEquals(rows.find((r) => r.erp_name === 'PINV-1')?.purchase_orders, ['PO-1', 'PO-2']);
  assertEquals(rows.find((r) => r.erp_name === 'PINV-2')?.purchase_orders, []);
});
