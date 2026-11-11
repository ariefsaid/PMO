/**
 * AC-OCI-010 and AC-OCI-030 (layer B, #1506 C3) on the stock Odoo bed: an approved invoice of two lines at 11% PPN, ordinary (from an
 * order-less project) and free-standing (no cost account), is created, anchored and posted exactly once; Odoo's number, reference, total and
 * explicit tax land in the canonical; every product line carries the project's cost account; a replay finds the same invoice and writes
 * nothing; and a draft that was left with one line stripped of its cost account is posted by the recovery probe and flagged
 * `cost-account-missing`. C4 also bills a 200,000 down payment and a 10 km x 50,000 progress claim with its -40,000 recovery line; both
 * use the liability account and project distribution, and Odoo's totals are the canonical. The SHIPPED Odoo revenue adapter and recovery probe run against the real JSON-2 API. Gated on the dependency,
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
import { odooFloatRound, odooLineSubtotal } from '../../../pmo-portal/src/lib/adapterSeam/odoo/revenue/odooRounding.ts';
import { parseOdooExternalRef } from '../../../pmo-portal/src/lib/adapterSeam/odoo/purchase/anchors.ts';
import { formatTimeMaterialsDescription } from '../../../pmo-portal/src/lib/adapterSeam/erpnext/dispatchRevenueFormatting.ts';

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
    const productLines = (id: number) => call<Array<{ analytic_distribution: Record<string, number> | false; tax_ids: number[]; product_id: [number, string]; account_id: [number, string]; product_uom_id?: [number, string]; quantity: number; price_unit: number }>>(
      'account.move.line', 'search_read', { domain: [['move_id', '=', id], ['display_type', '=', 'product']], fields: ['analytic_distribution', 'tax_ids', 'product_id', 'account_id', 'product_uom_id', 'quantity', 'price_unit'], order: 'id asc' });
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

    // C4 AC-OCI-021: a down-payment invoice is an ordinary invoice line on the configured customer-advance liability account.
    const [advance] = await call<Array<{ id: number; account_type: string }>>('account.account', 'search_read', {
      domain: [['account_type', '=', 'liability_current'], ['company_ids', 'in', [companyId]]], fields: ['id', 'account_type'], limit: 1,
    });
    assert(advance && advance.account_type.startsWith('liability'), 'the Indonesian chart has a customer-advance liability account');
    const downPaymentProduct = await make('product.product', {
      name: `${stamp} advance item`, type: 'service', sale_ok: true, property_account_income_id: advance.id,
    });
    const downPaymentInput: PmoInvoice = {
      id: crypto.randomUUID(), customerId: 'c', invoiceDate: '2026-12-05', currency: company.currency_id[1], referenceNumber: `${stamp}-DP`,
      lines: [{ itemId: 'advance', description: 'Down payment', quantity: 1, unitPrice: 200000, kind: 'down-payment' }],
    };
    const downPaymentMaps: InvoiceMaps = {
      ...mapsFor(account), items: { svc: { productId: service, incomeAccountId: income.id }, advance: { productId: downPaymentProduct, incomeAccountId: advance.id } },
      downPayment: { itemId: 'advance', advanceAccountId: advance.id },
    };
    const downPaymentExpectation: InvoiceExpect = { total: expectedInvoiceTotal(downPaymentInput.lines, [11]), costAccountId: account,
      advanceAccount: { productId: downPaymentProduct, accountId: advance.id } };
    const downPaymentAdapter = createOdooRevenueAdapter({ call, resolveInvoice: async () => ({ input: downPaymentInput, maps: downPaymentMaps, expect: downPaymentExpectation }) });
    const downPaymentCommand: AdapterCommand = {
      domain: 'revenue', operation: 'transition', idempotencyKey: `${stamp}-DP`,
      record: { id: downPaymentInput.id, erp_doc_kind: 'sales-invoice', verb: 'submit', workOrderId: null },
    };
    const downPaymentResult = await downPaymentAdapter.commit(downPaymentCommand);
    const downPaymentId = parseOdooExternalRef('account.move', downPaymentResult.externalRecordId)!;
    const [postedDownPaymentLine] = await productLines(downPaymentId);
    assertEquals([postedDownPaymentLine.product_id[0], postedDownPaymentLine.account_id[0], postedDownPaymentLine.analytic_distribution],
      [downPaymentProduct, advance.id, { [String(account)]: 100 }], 'the posted down-payment line uses the advance account and project distribution');
    assertEquals(downPaymentResult.canonical.odoo_attention, null);

    // C4 AC-OCI-020: Odoo receives the immutable claim lines, including the negative recovery, unchanged.
    const claimId = crypto.randomUUID();
    const claimLines = [
      { itemId: 'svc', description: 'Roadworks (km)', quantity: 10, unitPrice: 50000 },
      { itemId: 'advance', description: 'Down-payment recovery', quantity: 1, unitPrice: -40000, kind: 'recovery' as const },
    ];
    const claimInput: PmoInvoice = {
      id: claimId, customerId: 'c', invoiceDate: '2026-12-05', currency: company.currency_id[1], referenceNumber: null,
      workOrderPoNumber: `${stamp}-WO-PO`, lines: claimLines,
    };
    const claimMaps = downPaymentMaps;
    const claimExpectation: InvoiceExpect = { total: expectedInvoiceTotal(claimLines, [11]), costAccountId: account,
      advanceAccount: { productId: downPaymentProduct, accountId: advance.id } };
    const claimAdapter = createOdooRevenueAdapter({ call, resolveInvoice: async () => ({ input: claimInput, maps: claimMaps, expect: claimExpectation }) });
    const claimCommand: AdapterCommand = { domain: 'revenue', operation: 'transition', idempotencyKey: `${stamp}-CLAIM`,
      record: { id: claimId, erp_doc_kind: 'sales-invoice', verb: 'submit', workOrderId: crypto.randomUUID() } };
    const claimResult = await claimAdapter.commit(claimCommand);
    const claimMoveId = parseOdooExternalRef('account.move', claimResult.externalRecordId)!;
    const [claimMove] = await moveRead(claimMoveId);
    const claimPostedLines = await productLines(claimMoveId);
    assertEquals([claimMove.amount_untaxed, claimMove.amount_tax, claimMove.amount_total], [460000, 50600, 510600], 'Odoo computes the same total from the recorded claim and explicit tax');
    assertEquals(claimPostedLines.map((line) => [line.product_id[0], line.quantity, line.price_unit, line.account_id[0], line.analytic_distribution]), [
      [service, 10, 50000, income.id, { [String(account)]: 100 }],
      [downPaymentProduct, 1, -40000, advance.id, { [String(account)]: 100 }],
    ]);
    assertEquals([claimResult.canonical.odoo_attention, claimResult.canonical.amount, claimResult.canonical.reference_number], [null, '510600.00', `${stamp}-WO-PO`]);

    // C4b AC-OCI-024: a signed T&M claim's frozen 120 hours × contract rate is booked on the project distribution.
    const hourUnits = await call<Array<{ id: number; name: string }>>('uom.uom', 'search_read', {
      domain: [['name', 'ilike', 'hour']], fields: ['id', 'name'], limit: 1,
    });
    assert(hourUnits[0], 'the bed has an hour unit of measure');
    const tmService = await make('product.product', {
      name: `${stamp} T&M service`, type: 'service', sale_ok: true, property_account_income_id: income.id,
      uom_id: hourUnits[0].id,
    });
    const tmId = crypto.randomUUID();
    const tmLines = [{ itemId: 'tm-service', description: `${stamp} Field labour (hour)`, quantity: 120, unitPrice: 50000, unit: 'hour', amount: 6000000 }];
    const tmInput: PmoInvoice = { id: tmId, customerId: 'c', invoiceDate: '2026-12-05', currency: company.currency_id[1], lines: tmLines };
    const [productUnitPrecision] = await call<Array<{ name: string; digits: number }>>('decimal.precision', 'search_read', {
      domain: [['name', '=', 'Product Unit']], fields: ['name', 'digits'], limit: 1,
    });
    assert(productUnitPrecision?.name === 'Product Unit' && Number.isInteger(productUnitPrecision.digits) && productUnitPrecision.digits >= 0,
      'Odoo exposes the Product Unit precision used by account.move.line.quantity');
    const tmMaps: InvoiceMaps = {
      ...mapsFor(account), items: { svc: { productId: service, incomeAccountId: income.id }, 'tm-service': { productId: tmService, incomeAccountId: income.id } },
      units: { hour: hourUnits[0].id },
      quantityRounding: 10 ** -productUnitPrecision.digits,
    };
    const tmTotal = expectedInvoiceTotal(tmLines, [11]);
    const tmExpectation: InvoiceExpect = { total: tmTotal, costAccountId: account };
    const tmAdapter = createOdooRevenueAdapter({ call, resolveInvoice: () => Promise.resolve({ input: tmInput, maps: tmMaps, expect: tmExpectation }) });
    const tmCommand: AdapterCommand = { domain: 'revenue', operation: 'transition', idempotencyKey: `${stamp}-TM`, record: { id: tmId, erp_doc_kind: 'sales-invoice', verb: 'submit' } };
    const tmResult = await tmAdapter.commit(tmCommand);
    const tmMoveId = parseOdooExternalRef('account.move', tmResult.externalRecordId)!;
    const [tmMove] = await moveRead(tmMoveId);
    const [tmPostedLine] = await productLines(tmMoveId);
    assertEquals([tmPostedLine.product_id[0], tmPostedLine.quantity, tmPostedLine.price_unit, tmPostedLine.product_uom_id?.[0], tmPostedLine.analytic_distribution],
      [tmService, 120, 50000, hourUnits[0].id, { [String(account)]: 100 }]);
    assertEquals([tmMove.amount_untaxed, tmMove.amount_tax, tmMove.amount_total, tmResult.canonical.amount], [6000000, 660000, 6660000, '6660000.00']);
    // C4: confirm the signed PMO line amount survives the actual Product Unit and currency precision on the bed.
    const precisionRows = await call<Array<{ digits: number }>>('decimal.precision', 'search_read', {
      domain: [['name', '=', 'Product Unit']], fields: ['digits'], limit: 2,
    });
    assertEquals(precisionRows.length, 1, 'the Product Unit precision is readable');
    const [currencyPrecision] = await call<Array<{ rounding: number }>>('res.currency', 'read', {
      ids: [company.currency_id[0]], fields: ['rounding'],
    });
    assert(currencyPrecision && currencyPrecision.rounding > 0, 'the company currency rounding is readable');
    const claimQuantity = 0.333;
    const claimRate = 1000.01;
    const signedAmount = odooFloatRound(claimQuantity * claimRate, { precisionDigits: 2 });
    const qtyRounding = 10 ** -precisionRows[0].digits;
    const bookedFromOriginal = odooLineSubtotal(claimQuantity, claimRate, qtyRounding, currencyPrecision.rounding);
    const needsReshape = bookedFromOriginal !== signedAmount;
    const bookedLine = needsReshape
      ? { quantity: 1, unitPrice: signedAmount, description: formatTimeMaterialsDescription('Roadworks', 'km', claimQuantity, claimRate, signedAmount, company.currency_id[1]) }
      : { quantity: claimQuantity, unitPrice: claimRate, description: 'Roadworks (km)' };
    const fractionalInput: PmoInvoice = {
      id: crypto.randomUUID(), customerId: 'c', invoiceDate: '2026-12-05', currency: company.currency_id[1], referenceNumber: `${stamp}-C4`,
      lines: [{ itemId: 'svc', ...bookedLine }],
    };
    const fractionalExpectation: InvoiceExpect = {
      total: expectedInvoiceTotal([{ quantity: bookedLine.quantity, unitPrice: bookedLine.unitPrice, amount: signedAmount }], [11], currencyPrecision.rounding),
      costAccountId: account,
    };
    const fractionalAdapter = createOdooRevenueAdapter({ call, resolveInvoice: async () => ({ input: fractionalInput, maps: mapsFor(account), expect: fractionalExpectation }) });
    const fractionalCommand: AdapterCommand = {
      domain: 'revenue', operation: 'transition', idempotencyKey: `${stamp}-C4`,
      record: { id: fractionalInput.id, erp_doc_kind: 'sales-invoice', verb: 'submit' },
    };
    const fractionalResult = await fractionalAdapter.commit(fractionalCommand);
    const fractionalMoveId = parseOdooExternalRef('account.move', fractionalResult.externalRecordId)!;
    const [fractionalMove] = await moveRead(fractionalMoveId);
    const [fractionalPostedLine] = await productLines(fractionalMoveId);
    assertEquals([fractionalMove.amount_untaxed, fractionalPostedLine.quantity, fractionalPostedLine.price_unit],
      [signedAmount, bookedLine.quantity, bookedLine.unitPrice], 'the bed books the signed progress-claim amount at its actual precision');
  },
});
