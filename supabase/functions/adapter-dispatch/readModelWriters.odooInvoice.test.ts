// #1506 C3 (AC-OCI-016, FR-OCI-072): an Odoo client invoice's canonical (odoo/revenue/invoiceReadBack.ts) goes through the SHIPPED `revenue`
// read-model writer, and its four Odoo facts ride along (0511). A read-back whose money header was withheld writes none of the money, and an
// ERPNext canonical (no `odoo_state` key) writes none of the Odoo facts.
// Verify: cd supabase/functions/adapter-dispatch && deno test readModelWriters.odooInvoice.test.ts
import { assertEquals } from '@std/assert';
import { getReadModelWriter } from './readModelWriters.ts';
import { readBackInvoice, type InvoiceRead } from '../../../pmo-portal/src/lib/adapterSeam/odoo/revenue/invoiceReadBack.ts';

const PMO = '55555555-5555-4555-8555-555555555555';
const READ: InvoiceRead = {
  move: { name: 'INV/2026/00001', state: 'posted', amount_untaxed: 1000, amount_tax: 110, amount_total: 1110, amount_residual: 1110, ref: 'PO-77', invoice_date: '2026-11-03', currency_id: [12, 'IDR'], write_date: '2026-11-03 10:00:00' },
  productLines: [{ id: 1, display_type: 'product', analytic_distribution: { '101': 100 } }],
  readAt: '2026-11-03T10:00:01Z',
};
const EXPECT = { total: '1110.00', costAccountId: 101 };
const command = (operation: 'create' | 'update') => ({ domain: 'revenue', operation, record: { id: PMO, customerId: 'cust-1', projectId: 'proj-1', erp_doc_kind: 'sales-invoice' } }) as never;

function rig() {
  const calls: Array<{ table: string; method: string; row: Record<string, unknown> }> = [];
  const chain = (table: string) => ({
    eq: () => chain(table), maybeSingle: async () => ({ data: { org_id: 'org-1' }, error: null }),
    then: (resolve: (v: { data: unknown[]; error: null }) => void) => resolve({ data: [], error: null }),
  });
  const client = {
    from: (table: string) => ({
      insert: async (row: Record<string, unknown>) => { calls.push({ table, method: 'insert', row }); return { error: null }; },
      update: (row: Record<string, unknown>) => { calls.push({ table, method: 'update', row }); const u = { eq: () => u, then: (r: (v: { error: null }) => void) => r({ error: null }) }; return u; },
      select: () => chain(table),
    }),
  };
  return { ctx: { serviceClient: client as never, orgId: 'org-1' }, calls };
}
const writer = getReadModelWriter('revenue');
const written = (calls: ReturnType<typeof rig>['calls'], method: string) => calls.find((c) => c.table === 'sales_invoices' && c.method === method)!.row;

Deno.test('AC-OCI-016 an update mirrors the Odoo facts beside the money', async () => {
  const { ctx, calls } = rig();
  await writer.upsert(ctx, readBackInvoice(PMO, READ, EXPECT), command('update'));
  const row = written(calls, 'update');
  assertEquals([row.odoo_state, row.odoo_attention, row.odoo_sent_total, row.odoo_read_at, row.amount], ['posted', null, null, '2026-11-03T10:00:01Z', '1110.00']);
});

Deno.test('AC-OCI-013 a flagged total keeps both figures: Odoo\'s amount and the figure sent', async () => {
  const { ctx, calls } = rig();
  await writer.upsert(ctx, readBackInvoice(PMO, { ...READ, move: { ...READ.move, amount_total: 1200, amount_residual: 1200 } }, EXPECT), command('update'));
  const row = written(calls, 'update');
  assertEquals([row.odoo_attention, row.odoo_sent_total, row.amount], ['total-mismatch', '1110.00', '1200.00']);
});

Deno.test('AC-OCI-016 a withheld money header writes none of the money, only the facts', async () => {
  const { ctx, calls } = rig();
  await writer.upsert(ctx, readBackInvoice(PMO, { ...READ, move: { ...READ.move, amount_residual: undefined } }, EXPECT), command('update'));
  const row = written(calls, 'update');
  for (const key of ['amount', 'erp_outstanding_amount', 'status', 'tax_treatment']) assertEquals(Object.hasOwn(row, key), false, key);
  assertEquals(row.odoo_attention, 'money-unreadable');
});

Deno.test('an ERPNext canonical (no odoo_state) writes none of the Odoo facts: unchanged', async () => {
  const { ctx, calls } = rig();
  await writer.upsert(ctx, { id: PMO, si_number: 'SINV-1', amount: '1110.00', erp_outstanding_amount: '1110.00', erp_docstatus: 1, erp_modified: '2026-11-03 10:00:00' } as never, command('update'));
  const row = written(calls, 'update');
  for (const key of ['odoo_state', 'odoo_attention', 'odoo_sent_total', 'odoo_read_at']) assertEquals(Object.hasOwn(row, key), false, key);
  assertEquals(row.amount, '1110.00');
});
