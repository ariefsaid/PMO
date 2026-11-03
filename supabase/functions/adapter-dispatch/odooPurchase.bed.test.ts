/**
 * AC-OPP-010 and AC-OPP-016 (layer B, #1505 P3) on the stock Odoo bed: an approved order is created, anchored and confirmed
 * exactly once with every line's cost-account distribution, then revised in place after a partial receipt. The SHIPPED Odoo
 * procurement adapter and recovery probe run against the real JSON-2 API. Gated on the dependency, never on CI: the bed's URL,
 * database and key come from its untracked env file, sourced and never printed. Everything is synthetic and stamped; the bed
 * is throwaway, and the order is cancelled afterwards where Odoo allows.
 *   scripts/with-odoo-lock.sh bash -c 'set -a; . ./.env.odoo.local; set +a; ODOO_BED_URL=http://127.0.0.1:$ODOO_PORT \
 *     ODOO_BED_DB=$ODOO_DB ODOO_BED_KEY=$ODOO_API_KEY deno test --allow-env --allow-net --allow-read supabase/functions/adapter-dispatch/odooPurchase.bed.test.ts'
 */
import { assert, assertEquals, assertRejects } from '@std/assert';
import type { AdapterCommand } from '../../../pmo-portal/src/lib/adapterSeam/contract.ts';
import { bindCall } from '../../../pmo-portal/src/lib/adapterSeam/odoo/client.ts';
import { createOdooProcurementAdapter, recoverOrder } from '../../../pmo-portal/src/lib/adapterSeam/odoo/procurementAdapter.ts';
import type { OrderCtx, OrderInput } from '../../../pmo-portal/src/lib/adapterSeam/odoo/purchase/orderBody.ts';
import type { ReviseLine } from '../../../pmo-portal/src/lib/adapterSeam/odoo/purchase/orderRevise.ts';

const BED = Deno.env.get('ODOO_BED_URL');
const DB = Deno.env.get('ODOO_BED_DB') ?? '';
const KEY = Deno.env.get('ODOO_BED_KEY') ?? '';

Deno.test({
  name: 'AC-OPP-010 / AC-OPP-016 on the bed: one confirmed order with the project distribution on every line; revised in place after a partial receipt',
  ignore: !(BED && DB && KEY),
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    const call = bindCall({ baseUrl: BED!, apiKey: KEY, database: DB, fetchImpl: fetch });
    const stamp = `P3-${Date.now()}`;
    const make = async (model: string, vals: Record<string, unknown>) => (await call<number[]>(model, 'create', { vals_list: [vals] }))[0];
    const [company] = await call<Array<{ id: number; currency_id: [number, string] }>>('res.company', 'search_read', { domain: [], fields: ['id', 'currency_id'], limit: 1 });
    const [plan] = await call<Array<{ id: number }>>('account.analytic.plan', 'search_read', { domain: [], fields: ['id'], limit: 1 });
    const partner = await make('res.partner', { name: `${stamp} vendor`, supplier_rank: 1 });
    const productA = await make('product.product', { name: `${stamp} A`, purchase_ok: true, is_storable: true, standard_price: 10 });
    const productB = await make('product.product', { name: `${stamp} B`, purchase_ok: true, is_storable: true, standard_price: 10 });
    const [{ uom_id: [uomId] }] = await call<Array<{ uom_id: [number, string] }>>('product.product', 'read', { ids: [productA], fields: ['uom_id'] });   // the product's own unit
    const account = await make('account.analytic.account', { name: `${stamp} cost account`, code: stamp, plan_id: plan.id });

    const PO_ID = crypto.randomUUID();
    const input: OrderInput = {
      vendor: `Vendor:${partner}`, caseNumber: stamp, vendorReference: `${stamp}-REF`, expectedDate: '2026-12-01', projectIds: ['p-1'],
      lines: [{ name: 'A', quantity: 10, rate: 10, unit: 'u' }, { name: 'B', quantity: 8, rate: 5.5 }],
    };
    const ctx: OrderCtx = { companyId: company.id, currencyId: company.currency_id[0], itemMap: { A: String(productA), B: String(productB) }, unitMap: { u: String(uomId) }, costAccountId: String(account), taxIds: [] };
    const state = { orderId: 0, lines: [] as ReviseLine[] };
    const adapter = createOdooProcurementAdapter({
      call, resolveOrder: async () => ({ input, ctx }), resolveRevise: async () => ({ orderId: state.orderId, lines: state.lines, ctx }),
    });
    const create: AdapterCommand = { domain: 'procurement', operation: 'create', idempotencyKey: 'bed-1', record: { id: PO_ID, erp_doc_kind: 'purchase-order', procurementId: 'case-1', amount: '144.00' } };
    const attempt = async () => (await recoverOrder(call, create.record)) ?? adapter.commit(create);
    const anchored = async (name: string) => await call<Array<{ res_id: number }>>('ir.model.data', 'search_read', { domain: [['module', '=', 'pmo'], ['name', '=', name], ['model', '=', 'purchase.order']], fields: ['res_id'] });
    const lines = (orderId: number) => call<Array<{ id: number; product_id: [number, string]; product_qty: number; price_unit: number; qty_received: number; uom_id: [number, string]; analytic_distribution: Record<string, number> }>>(
      'purchase.order.line', 'search_read', { domain: [['order_id', '=', orderId]], fields: ['product_id', 'product_qty', 'price_unit', 'qty_received', 'uom_id', 'analytic_distribution'], order: 'id asc' });

    try {
      // ── AC-OPP-010
      const first = await attempt();
      const orderId = Number(first.externalRecordId);
      state.orderId = orderId;
      const [order] = await call<Array<{ state: string; amount_total: number; partner_id: [number, string]; partner_ref: string; origin: string; name: string }>>(
        'purchase.order', 'read', { ids: [orderId], fields: ['state', 'amount_total', 'partner_id', 'partner_ref', 'origin', 'name'] });
      assertEquals(order.state, 'purchase');
      assertEquals([order.partner_id[0], order.partner_ref, order.origin], [partner, `${stamp}-REF`, stamp]);
      assertEquals(order.amount_total, 144);
      const poLines = await lines(orderId);
      assertEquals(poLines.map((l) => [l.product_id[0], l.product_qty, l.price_unit]), [[productA, 10, 10], [productB, 8, 5.5]]);
      for (const l of poLines) assertEquals(l.analytic_distribution, { [String(account)]: 100 });
      assertEquals(poLines[0].uom_id[0], uomId);   // the mapped unit travels on the line
      assertEquals((await anchored(`po_${PO_ID.replaceAll('-', '_')}`)).map((r) => r.res_id), [orderId]);
      assertEquals(first.canonical, { id: PO_ID, po_number: order.name, amount: '144.00', pmo_amount: '144.00', erp_docstatus: 1, erp_modified: first.canonical.erp_modified, erp_amended_from: null });

      // a replay finds the same order and creates nothing
      const again = await attempt();
      assertEquals(again.externalRecordId, first.externalRecordId);
      assertEquals((await call<number[]>('purchase.order', 'search', { domain: [['origin', '=', stamp]] })).length, 1);

      // ── AC-OPP-016: receive 6 of A and 4 of B (a partial), then revise
      const [picking] = await call<Array<{ id: number; move_ids: number[] }>>('stock.picking', 'search_read', { domain: [['purchase_id', '=', orderId]], fields: ['move_ids'] });
      const moves = await call<Array<{ id: number; product_id: [number, string] }>>('stock.move', 'read', { ids: picking.move_ids, fields: ['product_id'] });
      for (const m of moves) await call('stock.move', 'write', { ids: [m.id], vals: { quantity: m.product_id[0] === productA ? 6 : 4 } });
      const validation = await call<{ res_model?: string; context?: Record<string, unknown> } | boolean>('stock.picking', 'button_validate', { ids: [picking.id] });
      if (typeof validation === 'object' && validation.res_model === 'stock.backorder.confirmation') {
        const wizard = await call<number[]>('stock.backorder.confirmation', 'create', { vals_list: [{}], context: validation.context });
        await call('stock.backorder.confirmation', 'process', { ids: wizard, context: validation.context });
      }
      assertEquals((await lines(orderId)).map((l) => l.qty_received), [6, 4]);

      const revise = (revision: number): AdapterCommand => ({ domain: 'procurement', operation: 'revise' as never, idempotencyKey: `bed-rev-${revision}`, record: { id: crypto.randomUUID(), erp_doc_kind: 'purchase-order', poId: PO_ID, revision } });
      const target = (a: string, b: string): ReviseLine[] => [{ itemRef: 'A', quantity: a, rate: '10.00', unit: '' }, { itemRef: 'B', quantity: b, rate: '5.50', unit: '' }];

      state.lines = target('12.000', '6.000');   // raises A, lowers B (still above the 4 received)
      const rev2 = await adapter.commit(revise(2));
      assertEquals((await lines(orderId)).map((l) => l.product_qty), [12, 6]);
      assertEquals(rev2.canonical.id, PO_ID);
      assertEquals(rev2.canonical.amount, '153.00');
      assertEquals((await anchored(`porev_${PO_ID.replaceAll('-', '_')}_2`)).length, 1);

      const replay = await adapter.commit(revise(2));   // replay: nothing changes
      assertEquals((await lines(orderId)).map((l) => l.product_qty), [12, 6]);
      assertEquals(replay.canonical.amount, '153.00');

      state.lines = target('5.000', '6.000');   // below the 6 received of A
      const refusal = await assertRejects(() => adapter.commit(revise(3))) as { code?: string; message: string };
      assertEquals([refusal.code, refusal.message], ['commit-rejected', 'below-received: A']);
      assertEquals((await lines(orderId)).map((l) => l.product_qty), [12, 6]);
      assertEquals((await anchored(`porev_${PO_ID.replaceAll('-', '_')}_3`)).length, 0);

      const [after] = await call<Array<{ state: string }>>('purchase.order', 'read', { ids: [orderId], fields: ['state'] });
      assert(after.state === 'purchase', `the order is never cancelled by a revision (state ${after.state})`);
    } finally {
      // best effort: the bed is throwaway, and a received order cannot be cancelled
      const ids = await call<number[]>('purchase.order', 'search', { domain: [['origin', '=', stamp]] }).catch(() => []);
      if (ids.length) await call('purchase.order', 'button_cancel', { ids }).catch(() => undefined);
    }
  },
});
