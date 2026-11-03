// #1505 P5-T4 (FR-OPP-043, AC-OPP-043): an Odoo vendor bill's canonical (odoo/purchase/billReadBack.ts) goes through the SHIPPED
// `procurement` read-model writer into the existing procurement_invoices columns (ADR-0082 shape), and a canonical whose money header
// was withheld (incomplete, or one the 0196 constraint would refuse) is refused on a create and writes no money on an update.
// Verify: cd supabase/functions/adapter-dispatch && deno test readModelWriters.odooBill.test.ts
import { assertEquals, assertRejects } from '@std/assert';
import { getReadModelWriter } from './readModelWriters.ts';
import { readBackBill, type BillRead } from '../../../pmo-portal/src/lib/adapterSeam/odoo/purchase/billReadBack.ts';

const READ: BillRead = {
  move: { name: 'BILL/2026/00001', state: 'posted', amount_total: 109, amount_residual: 109, ref: 'INV-77', invoice_date: '2026-12-05', currency_id: [12, 'IDR'], write_date: '2026-11-03 10:00:00' },
  taxLines: [{ balance: 11 }, { balance: -2 }],
  productLines: [{ analytic_distribution: { '101': 100 } }],
};
const EXPECT = { total: '109.00', costAccountId: '101' };
const PMO = '55555555-5555-4555-8555-555555555555';
const command = (operation: 'create' | 'update') => ({ domain: 'procurement', operation, record: { id: PMO, procurementId: 'proc-1', erp_doc_kind: 'purchase-invoice' } }) as never;

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
const writer = getReadModelWriter('procurement');

Deno.test('AC-OPP-043 a posted Odoo bill mirrors gross, VAT, withheld and outstanding into the existing columns; Paid only at residual zero', async () => {
  const { ctx, calls } = rig();
  await writer.upsert(ctx, readBackBill(PMO, READ, EXPECT), command('create'));
  const row = calls.find((c) => c.table === 'procurement_invoices' && c.method === 'insert')!.row;
  assertEquals(
    [row.id, row.procurement_id, row.vi_number, row.amount, row.tax_amount, row.withheld_amount, row.erp_outstanding_amount, row.status, row.tax_treatment, row.currency, row.erp_docstatus],
    [PMO, 'proc-1', 'BILL/2026/00001', '111.00', '11.00', '2.00', '109.00', 'Received', 'inclusive', 'IDR', 1],
  );
  const paid = rig();
  await writer.upsert(paid.ctx, readBackBill(PMO, { ...READ, move: { ...READ.move, amount_residual: 0 } }, EXPECT), command('update'));
  assertEquals(paid.calls.find((c) => c.method === 'update')!.row.status, 'Paid');
});

Deno.test('a flagged bill (Odoo\'s total differs from the figure sent) still mirrors Odoo\'s money, never PMO\'s', async () => {
  const { ctx, calls } = rig();
  await writer.upsert(ctx, readBackBill(PMO, { ...READ, move: { ...READ.move, amount_total: 110, amount_residual: 110 } }, EXPECT), command('create'));
  const row = calls.find((c) => c.table === 'procurement_invoices' && c.method === 'insert')!.row;
  assertEquals([row.amount, row.erp_outstanding_amount], ['112.00', '110.00']);
});

Deno.test('a money header that is incomplete: a create is refused (nothing is guessed) and an update writes none of the money', async () => {
  const unreadable = readBackBill(PMO, { ...READ, move: { ...READ.move, amount_residual: undefined } }, EXPECT);
  const create = rig();
  await assertRejects(() => writer.upsert(create.ctx, unreadable, command('create')), Error, 'no withholding total');
  assertEquals(create.calls.filter((c) => c.method === 'insert').length, 0);
  const update = rig();
  await writer.upsert(update.ctx, unreadable, command('update'));
  const patch = update.calls.find((c) => c.method === 'update')!.row;
  for (const key of ['amount', 'tax_amount', 'withheld_amount', 'tax_treatment', 'erp_outstanding_amount', 'status']) assertEquals(key in patch, false, key);
});
