/**
 * AC-OPP-040 and AC-OPP-020 (layer B, #1505 P5) on the stock Odoo bed: a vendor bill of 100 with input VAT 11% and a synthetic
 * withholding tax of 2% is created, anchored and posted exactly once, from an order and free-standing; PMO's gross, VAT, withheld and
 * outstanding equal Odoo's to the cent, the vendor's invoice number is the reference, and every bill line carries the project's
 * cost account. The SHIPPED Odoo procurement adapter and recovery probe run against the real JSON-2 API. Gated on the dependency,
 * never on CI: the bed's URL, database and key come from its untracked env file, sourced and never printed. Everything is
 * synthetic and stamped; the bed is throwaway (a posted bill cannot be deleted, it stays as stamped data).
 *   scripts/with-odoo-lock.sh bash -c 'set -a; . ./.env.odoo.local; set +a; ODOO_BED_URL=http://127.0.0.1:$ODOO_PORT \
 *     ODOO_BED_DB=$ODOO_DB ODOO_BED_KEY=$ODOO_API_KEY deno test --allow-env --allow-net --allow-read supabase/functions/adapter-dispatch/odooBill.bed.test.ts'
 * The bed's stock Indonesian chart has no PPh 23 / PPh 4(2) tax (V-OPP6), so the withholding tax is seeded here (SD-6).
 */
import { assert, assertEquals } from '@std/assert';
import type { AdapterCommand } from '../../../pmo-portal/src/lib/adapterSeam/contract.ts';
import { bindCall, type OdooCall } from '../../../pmo-portal/src/lib/adapterSeam/odoo/client.ts';
import { createOdooProcurementAdapter, recoverBill } from '../../../pmo-portal/src/lib/adapterSeam/odoo/procurementAdapter.ts';
import { expectedBillTotal, type BillCtx, type BillInput, type BillTax } from '../../../pmo-portal/src/lib/adapterSeam/odoo/purchase/billBody.ts';
import type { BillExpect } from '../../../pmo-portal/src/lib/adapterSeam/odoo/purchase/billReadBack.ts';
import { odooExternalRef, parseOdooExternalRef } from '../../../pmo-portal/src/lib/adapterSeam/odoo/purchase/anchors.ts';
import type { OrderCtx, OrderInput } from '../../../pmo-portal/src/lib/adapterSeam/odoo/purchase/orderBody.ts';
import type { BillComposite } from '../../../pmo-portal/src/lib/adapterSeam/odoo/purchase/recoveryProbe.ts';

const BED = Deno.env.get('ODOO_BED_URL');
const DB = Deno.env.get('ODOO_BED_DB') ?? '';
const KEY = Deno.env.get('ODOO_BED_KEY') ?? '';

Deno.test({
  name: 'AC-OPP-040 / AC-OPP-020 on the bed: a bill of 100 + VAT 11% + withholding 2%, from an order and free-standing, posted once with Odoo\'s own money and the cost account on every line',
  ignore: !(BED && DB && KEY),
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    const raw = bindCall({ baseUrl: BED!, apiKey: KEY, database: DB, fetchImpl: fetch });
    const stamp = `P5-${Date.now()}`;
    // Accounting runs in the company with the Indonesian chart (a purchase VAT of 11%); every call is made in that company.
    let companyId = 0;
    for (const { id } of await raw<Array<{ id: number }>>('res.company', 'search_read', { domain: [], fields: ['id'] })) {
      const found = await raw<number[]>('account.tax', 'search', { domain: [['type_tax_use', '=', 'purchase'], ['amount', '=', 11], ['price_include', '=', false], ['company_id', '=', id]], limit: 1, context: { allowed_company_ids: [id] } });
      if (found.length) { companyId = id; break; }
    }
    assert(companyId, 'no company on the bed has a purchase VAT of 11% (load the Indonesian chart, scripts/odoo-probe.mjs)');
    const call = (async (model: string, method: string, body: Record<string, unknown> = {}) => {
      try { return await raw(model, method, { ...body, context: { allowed_company_ids: [companyId], ...((body.context as object) ?? {}) } }); } catch (err) {
        throw new Error(`${model}/${method} refused: ${(err as Error).message}`, { cause: err });   // which call, for the bed's reader
      }
    }) as OdooCall;
    const make = async (model: string, vals: Record<string, unknown>) => (await call<number[]>(model, 'create', { vals_list: [vals] }))[0];
    // An order needs a receiving operation type, so the company needs a warehouse; seed one once if the Indonesian company has none.
    if (!(await call<number[]>('stock.warehouse', 'search', { domain: [['company_id', '=', companyId]], limit: 1 })).length) {
      await call('stock.warehouse', 'create', { vals_list: [{ name: 'P5 bed warehouse', code: 'P5W', company_id: companyId }] });
    }
    const [company] = await call<Array<{ id: number; currency_id: [number, string] }>>('res.company', 'read', { ids: [companyId], fields: ['currency_id'] });
    const [plan] = await call<Array<{ id: number }>>('account.analytic.plan', 'search_read', { domain: [], fields: ['id'], limit: 1 });
    const partner = await make('res.partner', { name: `${stamp} vendor`, supplier_rank: 1 });
    const service = await make('product.product', { name: `${stamp} service`, type: 'service', purchase_ok: true });
    const account = await make('account.analytic.account', { name: `${stamp} cost account`, code: stamp, plan_id: plan.id });

    // The tax set: the chart's purchase VAT 11% and a synthetic -2% withholding posting to a liability account.
    const [vat] = await call<Array<{ id: number; name: string; amount: number }>>('account.tax', 'search_read', {
      domain: [['type_tax_use', '=', 'purchase'], ['amount', '=', 11], ['price_include', '=', false], ['company_id', '=', companyId]], fields: ['name', 'amount'], limit: 1 });
    if (!vat) {
      const seen = await call<Array<{ id: number; name: string; amount: number; company_id: [number, string]; price_include: boolean }>>('account.tax', 'search_read', { domain: [['type_tax_use', '=', 'purchase']], fields: ['name', 'amount', 'company_id', 'price_include'], limit: 40 });
      throw new Error(`the bed chart has no purchase VAT 11% in company ${companyId}; purchase taxes: ${JSON.stringify(seen.map((t) => [t.id, t.name, t.amount, t.company_id?.[0], t.price_include]))}`);
    }
    const [liability] = await call<Array<{ id: number }>>('account.account', 'search_read', { domain: [['account_type', '=', 'liability_current']], fields: ['id'], limit: 1 });
    const withholdingId = await make('account.tax', { name: `${stamp} withholding 2%`, company_id: companyId, type_tax_use: 'purchase', amount_type: 'percent', amount: -2 });
    const [wTax] = await call<Array<{ invoice_repartition_line_ids: number[] }>>('account.tax', 'read', { ids: [withholdingId], fields: ['invoice_repartition_line_ids'] });
    const parts = await call<Array<{ id: number; repartition_type: string }>>('account.tax.repartition.line', 'read', { ids: wTax.invoice_repartition_line_ids, fields: ['repartition_type'] });
    await call('account.tax.repartition.line', 'write', { ids: parts.filter((p) => p.repartition_type === 'tax').map((p) => p.id), vals: { account_id: liability.id } });
    const taxes: BillTax[] = [
      { id: vat.id, name: vat.name, rate: 11, active: true, companyId, scope: 'purchase', liabilityAccount: false },
      { id: withholdingId, name: `${stamp} withholding 2%`, rate: -2, active: true, companyId, scope: 'purchase', liabilityAccount: true },
    ];

    // An order for the bill to name (service line, 100).
    const orderInput: OrderInput = { vendor: `Vendor:${partner}`, caseNumber: stamp, vendorReference: `${stamp}-PO`, expectedDate: '2026-12-01', projectIds: ['p-1'], lines: [{ name: 'service', quantity: 1, rate: 100 }] };
    const orderCtx: OrderCtx = { companyId, currencyId: company.currency_id[0], itemMap: { service: String(service) }, unitMap: {}, costAccountId: String(account), taxIds: [] };
    const billInput = (purchaseLineId: number | null): BillInput => ({
      vendor: `Vendor:${partner}`, reference: `${stamp}-INV`, invoiceDate: '2026-12-05', projectIds: ['p-1'], lines: [{ name: 'service', quantity: 1, rate: 100, purchaseLineId }],
    });
    const billCtx: BillCtx = { companyId, currencyId: company.currency_id[0], itemMap: { service: String(service) }, unitMap: {}, costAccountId: String(account), taxes };
    const adapterFor = (bill: BillInput) => createOdooProcurementAdapter({
      call, resolveOrder: async () => ({ input: orderInput, ctx: orderCtx }), resolveRevise: () => Promise.reject(new Error('no revise')), resolveBill: async () => ({ input: bill, ctx: billCtx }),
    });
    const expectation = (bill: BillInput): BillExpect => ({ total: expectedBillTotal(bill, taxes), costAccountId: String(account) });
    const composite: BillComposite = { partnerId: partner, amount: '100.00', lineCount: 1, createdAfter: '2000-01-01 00:00:00' };
    const orderCommand: AdapterCommand = { domain: 'procurement', operation: 'create', idempotencyKey: `${stamp}-o`, record: { id: crypto.randomUUID(), erp_doc_kind: 'purchase-order', procurementId: 'case-1', amount: '100.00' } };

    const moveRead = (id: number) => call<Array<{ state: string; move_type: string; ref: string; invoice_date: string; partner_id: [number, string]; amount_untaxed: number; amount_tax: number; amount_total: number; amount_residual: number; name: string }>>(
      'account.move', 'read', { ids: [id], fields: ['state', 'move_type', 'ref', 'invoice_date', 'partner_id', 'amount_untaxed', 'amount_tax', 'amount_total', 'amount_residual', 'name'] });
    const productLines = (id: number) => call<Array<{ analytic_distribution: Record<string, number> | false; purchase_line_id: [number, string] | false; quantity: number; price_unit: number }>>(
      'account.move.line', 'search_read', { domain: [['move_id', '=', id], ['display_type', '=', 'product']], fields: ['analytic_distribution', 'purchase_line_id', 'quantity', 'price_unit'], order: 'id asc' });
    const taxLines = (id: number) => call<Array<{ balance: number }>>('account.move.line', 'search_read', { domain: [['move_id', '=', id], ['tax_line_id', '!=', false]], fields: ['balance'] });
    const anchored = (key: string) => call<Array<{ res_id: number }>>('ir.model.data', 'search_read', { domain: [['module', '=', 'pmo'], ['name', '=', key], ['model', '=', 'account.move']], fields: ['res_id'] });

    const order = await adapterFor(billInput(null)).commit(orderCommand);
    const [orderLine] = await call<Array<{ id: number }>>('purchase.order.line', 'search_read', { domain: [['order_id', '=', parseOdooExternalRef('purchase.order', order.externalRecordId)]], fields: ['id'] });

    for (const [label, link] of [['from an order', orderLine.id], ['free-standing', null]] as const) {
      const input = billInput(link);
      const adapter = adapterFor(input);
      const id = crypto.randomUUID();
      const command: AdapterCommand = { domain: 'procurement', operation: 'create', idempotencyKey: `${stamp}-${label}`, record: { id, erp_doc_kind: 'purchase-invoice', procurementId: 'case-1' } };
      const attempt = async () => (await recoverBill(call, command.record, composite, expectation(input))) ?? adapter.commit(command);

      const first = await attempt();
      const billId = parseOdooExternalRef('account.move', first.externalRecordId)!;   // model-qualified: Odoo ids are per model
      assertEquals(first.externalRecordId, odooExternalRef('account.move', billId), label);
      const [bill] = await moveRead(billId);
      // one posted vendor bill: the vendor's invoice number is the reference, the vendor's date its date
      assertEquals([bill.state, bill.move_type, bill.ref, bill.invoice_date, bill.partner_id[0]], ['posted', 'in_invoice', `${stamp}-INV`, '2026-12-05', partner], label);
      // PMO's money equals Odoo's to the cent: total 109 (net of the withholding), tax lines +11 and -2
      assertEquals([bill.amount_untaxed, bill.amount_tax, bill.amount_total, bill.amount_residual], [100, 9, 109, 109], label);
      assertEquals((await taxLines(billId)).map((l) => l.balance).sort((a, b) => a - b), [-2, 11], label);
      assertEquals(
        [first.canonical.amount, first.canonical.tax_amount, first.canonical.withheld_amount, first.canonical.erp_outstanding_amount, first.canonical.vi_number, first.canonical.reference_number],
        ['111.00', '11.00', '2.00', '109.00', bill.name, `${stamp}-INV`], label);
      assert(!('odoo_outcome' in first.canonical), `${label}: Odoo computed the figure PMO sent, so nothing is flagged: ${JSON.stringify(first.canonical)}`);
      // AC-OPP-020: every bill line carries the project's cost account; an order-raised bill names its order line
      const lines = await productLines(billId);
      assertEquals(lines.length, 1, label);
      assertEquals(lines[0].analytic_distribution, { [String(account)]: 100 }, label);
      assertEquals(lines[0].purchase_line_id === false ? null : lines[0].purchase_line_id[0], link, label);
      // anchored once, and a replay finds the same bill and creates or posts nothing
      assertEquals((await anchored(`bill_${id.replaceAll('-', '_')}`)).map((r) => r.res_id), [billId], label);
      const again = await attempt();
      assertEquals([again.externalRecordId, again.canonical], [first.externalRecordId, first.canonical], label);
      assertEquals((await call<number[]>('account.move', 'search', { domain: [['ref', '=', `${stamp}-INV`], ['move_type', '=', 'in_invoice']] })).length, link === null ? 2 : 1, label);
    }
    // the order line was billed by the first bill only
    const [billed] = await call<Array<{ qty_invoiced: number }>>('purchase.order.line', 'read', { ids: [orderLine.id], fields: ['qty_invoiced'] });
    assertEquals(billed.qty_invoiced, 1);
  },
});
