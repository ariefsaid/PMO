/**
 * AC-OCI-010 and AC-OCI-030 (layer B, #1506 C3) on the stock Odoo bed: an approved invoice of two lines at 11% PPN, ordinary (from an
 * order-less project) and free-standing (no cost account), is created, anchored and posted exactly once; Odoo's number, reference, total and
 * explicit tax land in the canonical; every product line carries the project's cost account; a replay finds the same invoice and writes
 * nothing; and a draft that was left with one line stripped of its cost account is posted by the recovery probe and flagged
 * `cost-account-missing`. The SHIPPED Odoo revenue adapter and recovery probe run against the real JSON-2 API. Gated on the dependency,
 * never on CI: the bed's URL, database and key come from its untracked env file, sourced and never printed. Everything is synthetic and
 * stamped; the bed is throwaway (a posted invoice cannot be deleted, it stays as stamped data).
 *   scripts/with-odoo-lock.sh bash -c 'set -a; . ./.env.odoo.local; set +a; ODOO_BED_URL=http://127.0.0.1:$ODOO_PORT \
 *     ODOO_BED_DB=$ODOO_DB ODOO_BED_KEY=$ODOO_API_KEY deno test --allow-env --allow-net --allow-read supabase/functions/adapter-dispatch/odooInvoice.bed.test.ts'
 */
import { assert, assertEquals } from '@std/assert';
import type { AdapterCommand } from '../../../pmo-portal/src/lib/adapterSeam/contract.ts';
import { bindCall, type OdooCall } from '../../../pmo-portal/src/lib/adapterSeam/odoo/client.ts';
import { createOdooRevenueAdapter, invoiceKey, recoverInvoice } from '../../../pmo-portal/src/lib/adapterSeam/odoo/revenueAdapter.ts';
import { externalIdentifier } from '../../../pmo-portal/src/lib/adapterSeam/odoo/revenue/anchors.ts';
import type { InvoiceMaps, PmoInvoice } from '../../../pmo-portal/src/lib/adapterSeam/odoo/revenue/invoiceBody.ts';
import { expectedInvoiceTotal, type InvoiceExpect } from '../../../pmo-portal/src/lib/adapterSeam/odoo/revenue/invoiceReadBack.ts';
import { parseOdooExternalRef } from '../../../pmo-portal/src/lib/adapterSeam/odoo/purchase/anchors.ts';

const BED = Deno.env.get('ODOO_BED_URL');
const DB = Deno.env.get('ODOO_BED_DB') ?? '';
const KEY = Deno.env.get('ODOO_BED_KEY') ?? '';

Deno.test({
  name: 'AC-OCI-010 / AC-OCI-030 on the bed: an invoice of two lines at PPN 11%, with and without a cost account, is posted once with Odoo\'s own money; a draft missing a line\'s cost account is posted and flagged',
  ignore: !(BED && DB && KEY),
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    const raw = bindCall({ baseUrl: BED!, apiKey: KEY, database: DB, fetchImpl: fetch });
    const stamp = `C3-${Date.now()}`;
    // Accounting runs in the company with the Indonesian chart (a sale tax of 11%); every call is made in that company.
    let companyId = 0;
    let taxId = 0;
    for (const { id } of await raw<Array<{ id: number }>>('res.company', 'search_read', { domain: [], fields: ['id'] })) {
      const found = await raw<number[]>('account.tax', 'search', { domain: [['type_tax_use', '=', 'sale'], ['amount', '=', 11], ['price_include', '=', false], ['company_id', '=', id]], limit: 1, context: { allowed_company_ids: [id] } });
      if (found.length) { companyId = id; taxId = found[0]; break; }
    }
    assert(companyId, 'no company on the bed has a sale tax of 11% (load the Indonesian chart, scripts/odoo-probe.mjs)');
    const call = (async (model: string, method: string, body: Record<string, unknown> = {}) => {
      try { return await raw(model, method, { ...body, context: { allowed_company_ids: [companyId], ...((body.context as object) ?? {}) } }); } catch (err) {
        throw new Error(`${model}/${method} refused: ${(err as Error).message}`, { cause: err });   // which call, for the bed's reader
      }
    }) as OdooCall;
    const make = async (model: string, vals: Record<string, unknown>) => (await call<number[]>(model, 'create', { vals_list: [vals] }))[0];
    const [company] = await call<Array<{ currency_id: [number, string] }>>('res.company', 'read', { ids: [companyId], fields: ['currency_id'] });
    const [plan] = await call<Array<{ id: number }>>('account.analytic.plan', 'search_read', { domain: [], fields: ['id'], limit: 1 });
    const partner = await make('res.partner', { name: `${stamp} client`, customer_rank: 1 });
    const service = await make('product.product', { name: `${stamp} service`, type: 'service', sale_ok: true });
    // the product's own income account, which the mirror's item directory carries (the chart's default for a service)
    const [income] = await call<Array<{ id: number }>>('account.account', 'search_read', { domain: [['account_type', '=', 'income'], ['company_ids', 'in', [companyId]]], fields: ['id'], limit: 1 });
    assert(income, 'the bed chart has an income account');
    const account = await make('account.analytic.account', { name: `${stamp} cost account`, code: stamp, plan_id: plan.id });

    const lines = [{ itemId: 'svc', description: 'BoQ 1', quantity: 4, unitPrice: 250 }, { itemId: 'svc', description: 'BoQ 2', quantity: 2, unitPrice: 500 }];
    const mapsFor = (costAccountId: number | null): InvoiceMaps => ({ companyCurrency: company.currency_id[1], partners: { c: partner }, items: { svc: { productId: service, incomeAccountId: income.id } }, units: {}, costAccountId, taxIds: [taxId] });
    const inputFor = (id: string): PmoInvoice => ({ id, customerId: 'c', invoiceDate: '2026-12-05', currency: company.currency_id[1], referenceNumber: `${stamp}-PO`, lines });
    const total = expectedInvoiceTotal(lines, [11]);   // 2000 + 11% = 2220.00
    const moveRead = (id: number) => call<Array<{ state: string; move_type: string; ref: string; invoice_date: string; partner_id: [number, string]; amount_untaxed: number; amount_tax: number; amount_total: number; amount_residual: number; name: string }>>(
      'account.move', 'read', { ids: [id], fields: ['state', 'move_type', 'ref', 'invoice_date', 'partner_id', 'amount_untaxed', 'amount_tax', 'amount_total', 'amount_residual', 'name'] });
    const productLines = (id: number) => call<Array<{ analytic_distribution: Record<string, number> | false; tax_ids: number[] }>>(
      'account.move.line', 'search_read', { domain: [['move_id', '=', id], ['display_type', '=', 'product']], fields: ['analytic_distribution', 'tax_ids'], order: 'id asc' });
    const anchored = (id: string) => call<Array<{ res_id: number }>>('ir.model.data', 'search_read', { domain: [['module', '=', 'pmo'], ['name', '=', externalIdentifier(invoiceKey({ id })).name], ['model', '=', 'account.move']], fields: ['res_id'] });

    for (const [label, costAccountId] of [['ordinary, with a cost account', account], ['free-standing, no project', null]] as const) {
      const id = crypto.randomUUID();
      const expectation: InvoiceExpect = { total, costAccountId };
      const adapter = createOdooRevenueAdapter({ call, resolveInvoice: async () => ({ input: inputFor(id), maps: mapsFor(costAccountId), expect: expectation }) });
      const command: AdapterCommand = { domain: 'revenue', operation: 'transition', idempotencyKey: `${stamp}-${label}`, record: { id, erp_doc_kind: 'sales-invoice', verb: 'submit' } };
      const attempt = async () => (await recoverInvoice(call, command.record, undefined, expectation)) ?? adapter.commit(command);

      const first = await attempt();
      const moveId = parseOdooExternalRef('account.move', first.externalRecordId)!;   // model-qualified: Odoo ids are per model
      const [move] = await moveRead(moveId);
      assertEquals([move.state, move.move_type, move.ref, move.invoice_date, move.partner_id[0]], ['posted', 'out_invoice', `${stamp}-PO`, '2026-12-05', partner], label);
      assertEquals([move.amount_untaxed, move.amount_tax, move.amount_total, move.amount_residual], [2000, 220, 2220, 2220], label);
      assertEquals([first.canonical.amount, first.canonical.tax_amount, first.canonical.erp_outstanding_amount, first.canonical.si_number, first.canonical.reference_number, first.canonical.odoo_state],
        ['2220.00', '220.00', '2220.00', move.name, `${stamp}-PO`, 'posted'], label);
      // the explicit tax set on every line (never the product's hidden default), and the cost account on every line when there is a project
      const posted = await productLines(moveId);
      assertEquals(posted.length, 2, label);
      for (const l of posted) {
        assertEquals(l.tax_ids, [taxId], label);
        assertEquals(l.analytic_distribution, costAccountId === null ? false : { [String(costAccountId)]: 100 }, label);
      }
      assertEquals(first.canonical.odoo_attention, null, label);
      // anchored once; a replay finds the same invoice and creates or posts nothing
      assertEquals((await anchored(id)).map((r) => r.res_id), [moveId], label);
      const again = await attempt();
      assertEquals([again.externalRecordId, again.canonical.si_number], [first.externalRecordId, first.canonical.si_number], label);
      assertEquals((await call<number[]>('account.move', 'search', { domain: [['ref', '=', `${stamp}-PO`], ['partner_id', '=', partner], ['move_type', '=', 'out_invoice']] })).length, costAccountId === null ? 2 : 1, label);
    }

    // a draft left behind by a cut connection, one line with no cost account: the recovery probe posts it and the read-back flags it
    const id = crypto.randomUUID();
    const draft = await make('account.move', {
      move_type: 'out_invoice', partner_id: partner, invoice_date: '2026-12-05', ref: `${stamp}-STRIPPED`,
      invoice_line_ids: [
        [0, 0, { product_id: service, name: 'with', quantity: 1, price_unit: 1000, tax_ids: [[6, 0, [taxId]]], analytic_distribution: { [String(account)]: 100 } }],
        [0, 0, { product_id: service, name: 'without', quantity: 1, price_unit: 1000, tax_ids: [[6, 0, [taxId]]] }],
      ],
    });
    const { module, name } = externalIdentifier(invoiceKey({ id }));
    await call('ir.model.data', 'create', { vals_list: [{ module, name, model: 'account.move', res_id: draft }] });
    const recovered = await recoverInvoice(call, { id }, undefined, { total, costAccountId: account });
    assertEquals(recovered?.externalRecordId, `account.move:${draft}`);
    assertEquals([(await moveRead(draft))[0].state, recovered?.canonical.odoo_state, recovered?.canonical.odoo_attention], ['posted', 'posted', 'cost-account-missing']);
  },
});
