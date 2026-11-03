/**
 * AC-OPP-030, AC-OPP-031 and AC-OPP-032 (layer B, #1505 P4) on the stock Odoo bed: an approved order for 10 and 4 is received in
 * parts through the SHIPPED Odoo procurement adapter and recovery probe against the real JSON-2 API. The stock on hand rises by what
 * was received, a partial receipt leaves the rest on Odoo's backorder, 11 of 10 is refused with no write, and a validate whose
 * response is lost is adopted on retry with stock booked once. Gated on the dependency, never on CI. Everything is synthetic and
 * stamped; the bed is throwaway.
 *   scripts/with-odoo-lock.sh bash -c 'set -a; . ./.env.odoo.local; set +a; ODOO_BED_URL=http://127.0.0.1:$ODOO_PORT \
 *     ODOO_BED_DB=$ODOO_DB ODOO_BED_KEY=$ODOO_API_KEY deno test --allow-env --allow-net --allow-read supabase/functions/adapter-dispatch/odooReceipt.bed.test.ts'
 */
import { assert, assertEquals, assertRejects } from '@std/assert';
import type { AdapterCommand } from '../../../pmo-portal/src/lib/adapterSeam/contract.ts';
import { bindCall } from '../../../pmo-portal/src/lib/adapterSeam/odoo/client.ts';
import { createOdooProcurementAdapter, readOrderLines, recoverOrder, recoverReceipt } from '../../../pmo-portal/src/lib/adapterSeam/odoo/procurementAdapter.ts';
import type { OrderCtx, OrderInput } from '../../../pmo-portal/src/lib/adapterSeam/odoo/purchase/orderBody.ts';
import { planReceipt, type ReceiptLineInput } from '../../../pmo-portal/src/lib/adapterSeam/odoo/purchase/receiptBody.ts';

const BED = Deno.env.get('ODOO_BED_URL');
const DB = Deno.env.get('ODOO_BED_DB') ?? '';
const KEY = Deno.env.get('ODOO_BED_KEY') ?? '';

Deno.test({
  name: 'AC-OPP-030 / 031 / 032 on the bed: receive 6 then 4 of 10, stock rose by each, 11 refused, a lost validate response adopted once',
  ignore: !(BED && DB && KEY),
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    // A lost response: the request reaches Odoo and commits, the caller sees a broken connection.
    let loseNext: string | null = null;
    const lossy: typeof fetch = async (input, init) => {
      const response = await fetch(input, init);
      if (loseNext && String(input).endsWith(loseNext)) { loseNext = null; throw new TypeError('error sending request: connection reset'); }
      return response;
    };
    const call = bindCall({ baseUrl: BED!, apiKey: KEY, database: DB, fetchImpl: lossy });
    const stamp = `P4-${Date.now()}`;
    const make = async (model: string, vals: Record<string, unknown>) => (await call<number[]>(model, 'create', { vals_list: [vals] }))[0];
    const [company] = await call<Array<{ id: number; currency_id: [number, string] }>>('res.company', 'search_read', { domain: [], fields: ['id', 'currency_id'], limit: 1 });
    const partner = await make('res.partner', { name: `${stamp} vendor`, supplier_rank: 1 });
    const productA = await make('product.product', { name: `${stamp} A`, purchase_ok: true, is_storable: true, standard_price: 10 });
    const productB = await make('product.product', { name: `${stamp} B`, purchase_ok: true, is_storable: true, standard_price: 10 });
    const onHand = async (id: number) => (await call<Array<{ qty_available: number }>>('product.product', 'read', { ids: [id], fields: ['qty_available'] }))[0].qty_available;

    const itemMap = { A: String(productA), B: String(productB) };
    const input: OrderInput = {
      vendor: `Vendor:${partner}`, caseNumber: stamp, vendorReference: `${stamp}-REF`, expectedDate: '2026-12-01', projectIds: [],
      lines: [{ name: 'A', quantity: 10, rate: 10 }, { name: 'B', quantity: 4, rate: 5 }],
    };
    const ctx: OrderCtx = { companyId: company.id, currencyId: company.currency_id[0], itemMap, unitMap: {}, costAccountId: null, taxIds: [] };
    const adapter = createOdooProcurementAdapter({ call, resolveOrder: async () => ({ input, ctx }), resolveRevise: async () => { throw new Error('unused'); } });
    const PO_ID = crypto.randomUUID();
    const poCommand: AdapterCommand = { domain: 'procurement', operation: 'create', idempotencyKey: 'bed-po', record: { id: PO_ID, erp_doc_kind: 'purchase-order', procurementId: 'case-1', amount: '120.00' } };
    const order = await recoverOrder(call, poCommand.record) ?? await adapter.commit(poCommand);
    const orderId = Number(String(order.externalRecordId).split(':')[1]);

    const receipt = async (wanted: ReceiptLineInput[] | undefined, id = crypto.randomUUID()): Promise<AdapterCommand> => {
      const plan = await planReceipt(orderId, await readOrderLines(call, orderId), wanted, itemMap);
      return { domain: 'procurement', operation: 'create', idempotencyKey: `bed-gr-${id}`, record: { id, erp_doc_kind: 'goods-receipt', procurementId: 'case-1', odooReceipt: plan, receiptDigest: plan.digest } };
    };
    const attempt = async (cmd: AdapterCommand) => (await recoverReceipt(call, cmd.record)) ?? adapter.commit(cmd);
    const pickings = () => call<Array<{ id: number; state: string; backorder_id: unknown }>>('stock.picking', 'search_read', { domain: [['purchase_id', '=', orderId]], fields: ['state', 'backorder_id'], order: 'id asc' });
    const received = async () => (await readOrderLines(call, orderId)).map((l) => l.received);

    // ── AC-OPP-031: 11 of 10 is refused with no write
    await assertRejects(() => receipt([{ itemRef: 'A', quantity: 11 }]), Error, 'over-receipt: A');
    assertEquals(await received(), [0, 0]);

    // ── AC-OPP-030 / 031: 6 of A and all 4 of B (a partial), then the remaining 4 of A
    const beforeA = await onHand(productA), beforeB = await onHand(productB);
    const first = await attempt(await receipt([{ itemRef: 'A', quantity: 6 }, { itemRef: 'B', quantity: 4 }]));
    assertEquals([await onHand(productA) - beforeA, await onHand(productB) - beforeB], [6, 4]);
    assertEquals(await received(), [6, 4]);
    assertEquals(first.canonical.odoo_receipt_status, 'Partial');
    assertEquals((first.canonical.odoo_booked as Array<{ quantity: number }>).map((b) => b.quantity), [6, 4]);
    const afterFirst = await pickings();
    assertEquals(afterFirst.map((p) => p.state), ['done', 'assigned']);   // the rest of A waits on Odoo's backorder
    assertEquals(afterFirst[1].backorder_id, [afterFirst[0].id, (afterFirst[1].backorder_id as [number, string])[1]]);
    await assertRejects(() => receipt([{ itemRef: 'A', quantity: 5 }]), Error, 'over-receipt: A');   // 4 open, 5 asked

    // ── AC-OPP-032: the validate commits and its response is lost; the retry adopts it and stock moves once
    const rest = await receipt([{ itemRef: 'A', quantity: 4 }]);
    loseNext = '/stock.picking/button_validate';
    await assertRejects(() => attempt(rest), Error);
    assertEquals(await onHand(productA) - beforeA, 10);
    const adopted = await attempt(rest);
    assertEquals(await onHand(productA) - beforeA, 10);
    assertEquals(adopted.canonical.odoo_receipt_status, 'Complete');
    assertEquals(await received(), [10, 4]);
    assertEquals((await pickings()).map((p) => p.state), ['done', 'done']);
    assert(adopted.externalRecordId === `stock.picking:${(await pickings())[1].id}`);
  },
});
