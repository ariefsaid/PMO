/**
 * AC-OCI-001 secondary (layer B, #1506 C2) on the stock Odoo bed: the capability snapshot the real key produces shows every model an invoice
 * and a receipt need, so the employ/dispatch capability check does not wrongly refuse a working connection; and the tax directory the mirror
 * reads carries each sale tax's tax group, which is what tells a PPN output tax from a collector or exempt tax (FR-OCI-023): the effective-11%
 * tax is accepted as the default sales tax and the collector's tax is refused. Gated on the dependency, never on CI: the bed's URL, database and
 * key come from its untracked env file, sourced and never printed. Read-only.
 *   scripts/with-odoo-lock.sh bash -c 'set -a; . ./.env.odoo.local; set +a; ODOO_BED_URL=http://127.0.0.1:$ODOO_PORT \
 *     ODOO_BED_DB=$ODOO_DB ODOO_BED_KEY=$ODOO_API_KEY deno test --allow-env --allow-net --allow-read supabase/functions/adapter-dispatch/odooRevenue.bed.test.ts'
 */
import { assert, assertEquals, assertRejects } from '@std/assert';
import { bindCall, type OdooCall } from '../../../pmo-portal/src/lib/adapterSeam/odoo/client.ts';
import { discoverCapabilities } from '../../../pmo-portal/src/lib/adapterSeam/odoo/discovery.ts';
import { KIND_SPECS } from '../../../pmo-portal/src/lib/adapterSeam/odoo/kinds.ts';
import { revenueCapabilityGap } from '../../../pmo-portal/src/lib/adapterSeam/odoo/revenue/capabilities.ts';
import { createOdooRevenueAdapter, invoiceKey, recoverInvoice, recoverReceipt } from '../../../pmo-portal/src/lib/adapterSeam/odoo/revenueAdapter.ts';
import type { AdapterCommand } from '../../../pmo-portal/src/lib/adapterSeam/contract.ts';
import { externalIdentifier } from '../../../pmo-portal/src/lib/adapterSeam/odoo/revenue/anchors.ts';
import type { InvoiceMaps, PmoInvoice } from '../../../pmo-portal/src/lib/adapterSeam/odoo/revenue/invoiceBody.ts';
import { expectedInvoiceTotal, type InvoiceExpect } from '../../../pmo-portal/src/lib/adapterSeam/odoo/revenue/invoiceReadBack.ts';
import type { ReceiptDefaults, ReceiptInput } from '../../../pmo-portal/src/lib/adapterSeam/odoo/revenue/receiptBody.ts';
import type { ReceiptComposite } from '../../../pmo-portal/src/lib/adapterSeam/odoo/revenue/receiptRecoveryProbe.ts';
import { parseOdooExternalRef } from '../../../pmo-portal/src/lib/adapterSeam/odoo/purchase/anchors.ts';
import { selectSaleTaxes, type SaleTax } from '../../../pmo-portal/src/lib/adapterSeam/odoo/revenue/taxValidate.ts';

const BED = Deno.env.get('ODOO_BED_URL');
const DB = Deno.env.get('ODOO_BED_DB') ?? '';
const KEY = Deno.env.get('ODOO_BED_KEY') ?? '';

Deno.test({
  name: 'AC-OCI-001 / FR-OCI-023 on the bed: the real snapshot passes the revenue capability check, and the mirrored tax group separates a PPN output tax from a collector tax',
  ignore: !(BED && DB && KEY),
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    const call = bindCall({ baseUrl: BED!, apiKey: KEY, database: DB, fetchImpl: fetch });
    const snapshot = await discoverCapabilities(call, { versionMajor: 20, now: new Date() });
    assertEquals(revenueCapabilityGap(snapshot), null, `the snapshot shows every revenue model (missing: ${snapshot.missing.join(', ')})`);
    assertEquals(snapshot.models['account.tax'].fields_missing, [], 'the tax group field is readable');

    const spec = KIND_SPECS.tax;
    const rows = await call<Array<Record<string, unknown>>>(spec.model, 'search_read', { domain: [['type_tax_use', '=', 'sale']], fields: [...spec.fields, 'company_id'], limit: 200 });
    const taxes = rows.flatMap((r): SaleTax[] => {
      const parsed = spec.parse(r);
      const company = Array.isArray(r.company_id) ? Number(r.company_id[0]) : NaN;
      return parsed && Number.isFinite(company)
        ? [{ id: Number(parsed.external_id), name: parsed.name, rate: Number(parsed.attrs.amount), active: parsed.active, companyId: company, scope: String(parsed.attrs.use), priceIncluded: parsed.attrs.price_include === true, taxGroup: parsed.attrs.tax_group as string | null }]
        : [];
    });
    assert(taxes.length > 0 && taxes.every((t) => 'taxGroup' in t), 'every parsed tax carries its tax group');
    const effective = taxes.find((t) => t.name === '12% (Non-Luxury Good)' && t.active && !t.priceIncluded);
    assert(effective, 'the stock Indonesian chart has its effective 11% sale tax (V-OCI5)');
    assertEquals(effective.rate, 11);
    assertEquals(selectSaleTaxes({ vatFlag: true, defaultTaxId: effective.id, taxes, companyId: effective.companyId }), { outcome: 'accepted', taxIds: [effective.id] });
    const collector = taxes.find((t) => t.taxGroup === 'Collected by VAT Collector' && t.companyId === effective.companyId);
    assert(collector, 'the chart carries the collector-booked taxes');
    assertEquals(selectSaleTaxes({ vatFlag: true, defaultTaxId: collector.id, taxes, companyId: effective.companyId }), { outcome: 'refused', code: 'config-rejected', tax: collector.name });
  },
});

Deno.test({
  name: 'AC-OCI-100 bed composite: a project-attributed claim and both receipt shapes recover after a lost response without duplicate ledger documents',
  ignore: !(BED && DB && KEY),
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    const raw = bindCall({ baseUrl: BED!, apiKey: KEY, database: DB, fetchImpl: fetch });
    let companyId = 0;
    let taxId = 0;
    for (const { id } of await raw<Array<{ id: number }>>('res.company', 'search_read', { domain: [], fields: ['id'] })) {
      const found = await raw<number[]>('account.tax', 'search', {
        domain: [['type_tax_use', '=', 'sale'], ['amount', '=', 11], ['price_include', '=', false], ['company_id', '=', id]], limit: 1,
        context: { allowed_company_ids: [id] },
      });
      if (found.length) { companyId = id; taxId = found[0]; break; }
    }
    assert(companyId, 'the stock bed has an Indonesian company with an effective 11% sales tax');
    const call = (async <T>(model: string, method: string, body: Record<string, unknown> = {}) => {
      try {
        return await raw<T>(model, method, { ...body, context: { allowed_company_ids: [companyId], ...((body.context as object) ?? {}) } });
      } catch (error) {
        throw new Error(`${model}/${method} refused: ${(error as Error).message}`, { cause: error });
      }
    }) as OdooCall;
    const make = async (model: string, vals: Record<string, unknown>) => (await call<number[]>(model, 'create', { vals_list: [vals] }))[0];
    const stamp = `C9-${Date.now()}`;
    const [company] = await call<Array<{ currency_id: [number, string] }>>('res.company', 'read', { ids: [companyId], fields: ['currency_id'] });
    const currency = company.currency_id[1];
    const [plan] = await call<Array<{ id: number }>>('account.analytic.plan', 'search_read', { domain: [], fields: ['id'], limit: 1 });
    const [income] = await call<Array<{ id: number }>>('account.account', 'search_read', {
      domain: [['account_type', '=', 'income'], ['company_ids', 'in', [companyId]]], fields: ['id'], limit: 1,
    });
    assert(plan && income, 'the bed has a project analytic plan and an income account');
    const [journalCandidate] = await call<Array<{ id: number; inbound_payment_method_line_ids: number[]; default_account_id: [number, string] }>>('account.journal', 'search_read', {
      domain: [['company_id', '=', companyId], ['type', '=', 'bank']],
      fields: ['inbound_payment_method_line_ids', 'default_account_id'], limit: 20,
    });
    const journal = journalCandidate && journalCandidate.inbound_payment_method_line_ids.length > 0 ? journalCandidate : null;
    assert(journal, 'the company has a bank receipt journal with an inbound payment method');
    const prepaidRows = await call<Array<{ id: number; currency_id: false | [number, string] }>>('account.account', 'search_read', {
      domain: [['account_type', 'in', ['asset_current', 'asset_prepayments']], ['company_ids', 'in', [companyId]]],
      fields: ['currency_id'], limit: 100,
    });
    const prepaid = prepaidRows.find((row) => !row.currency_id || row.currency_id[0] === company.currency_id[0]);
    assert(prepaid, 'the company has a current asset account usable for withheld tax');
    const partnerId = await make('res.partner', { name: `${stamp} client`, customer_rank: 1 });
    const productId = await make('product.product', {
      name: `${stamp} progress claim`, type: 'service', sale_ok: true, property_account_income_id: income.id,
    });
    const projectAccountId = await make('account.analytic.account', { name: `${stamp} project`, code: stamp, plan_id: plan.id });
    const maps: InvoiceMaps = {
      companyCurrency: currency, partners: { client: partnerId },
      items: { service: { productId, incomeAccountId: income.id } }, units: {}, costAccountId: projectAccountId, taxIds: [taxId],
    };
    const makeInvoice = async (lostPostResponse: boolean) => {
      const id = crypto.randomUUID();
      const lines = [{ itemId: 'service', description: `${stamp} approved progress claim`, quantity: 1, unitPrice: 100000 }];
      const input: PmoInvoice = { id, customerId: 'client', invoiceDate: new Date().toISOString().slice(0, 10), currency, referenceNumber: `${stamp}-PO`, lines };
      const expectation: InvoiceExpect = { total: expectedInvoiceTotal(lines, [11]), costAccountId: projectAccountId };
      let cut = lostPostResponse;
      const invoiceCall = (async <T>(model: string, method: string, body: Record<string, unknown> = {}) => {
        const result = await call<T>(model, method, body);
        if (cut && model === 'account.move' && method === 'action_post') { cut = false; throw new TypeError('simulated lost response after invoice posting'); }
        return result;
      }) as typeof call;
      const record = { id, erp_doc_kind: 'sales-invoice', verb: 'submit' };
      const command: AdapterCommand = { domain: 'revenue', operation: 'transition', idempotencyKey: `${stamp}-${id}`, record };
      const adapter = createOdooRevenueAdapter({ call: invoiceCall, resolveInvoice: async () => ({ input, maps, expect: expectation }) });
      let completed: Awaited<ReturnType<typeof adapter.commit>> | null;
      if (lostPostResponse) {
        await assertRejects(() => adapter.commit(command), Error, 'simulated lost response after invoice posting');
        completed = await recoverInvoice(call, record, undefined, expectation);
      } else {
        completed = await adapter.commit(command);
      }
      assert(completed, 'the approved claim is confirmed or recovered');
      const moveId = parseOdooExternalRef('account.move', completed.externalRecordId);
      assert(moveId, 'the claim has a model-qualified Odoo invoice reference');
      const [move] = await call<Array<{ state: string; move_type: string; partner_id: [number, string]; amount_total: number; amount_residual: number }>>('account.move', 'read', {
        ids: [moveId], fields: ['state', 'move_type', 'partner_id', 'amount_total', 'amount_residual'],
      });
      assertEquals([move.state, move.move_type, move.partner_id[0], move.amount_total], ['posted', 'out_invoice', partnerId, 111000]);
      const productLines = await call<Array<{ analytic_distribution: Record<string, number> | false }>>('account.move.line', 'search_read', {
        domain: [['move_id', '=', moveId], ['display_type', '=', 'product']], fields: ['analytic_distribution'],
      });
      assertEquals(productLines.map((line) => line.analytic_distribution), [{ [String(projectAccountId)]: 100 }], 'the claim is attributed to its project');
      const anchor = externalIdentifier(invoiceKey(record));
      const anchors = await call<Array<{ res_id: number }>>('ir.model.data', 'search_read', {
        domain: [['module', '=', anchor.module], ['name', '=', anchor.name], ['model', '=', 'account.move']], fields: ['res_id'],
      });
      assertEquals(anchors.map((row) => row.res_id), [moveId], 'exactly one invoice anchor is present after the interruption/recovery');
      return { id, moveId, amount: move.amount_total, residual: move.amount_residual };
    };

    const plainInvoice = await makeInvoice(false);
    const withheldInvoice = await makeInvoice(true);
    const makeReceipt = async (invoiceId: string, moveId: number, receipt: ReceiptInput, loseWizardResponse: boolean) => {
      const record = {
        id: receipt.id, erp_doc_kind: 'incoming-payment', date: receipt.date, paid_amount: receipt.settled,
        received_amount: receipt.cash ?? receipt.settled, withheld_amount: receipt.withheld ?? 0,
        withholding_slip_number: receipt.slipNumber ?? null,
      };
      const command: AdapterCommand = { domain: 'revenue', operation: 'create', idempotencyKey: `${stamp}-${receipt.id}`, record };
      let cut = loseWizardResponse;
      const receiptCall = (async <T>(model: string, method: string, body: Record<string, unknown> = {}) => {
        const result = await call<T>(model, method, body);
        if (cut && model === 'account.payment.register' && method === 'action_create_payments') {
          cut = false;
          throw new TypeError('simulated lost response after receipt registration');
        }
        return result;
      }) as typeof call;
      const [invoiceMove] = await call<Array<{ state: string; amount_residual: number; currency_id: false | [number, string] }>>('account.move', 'read', {
        ids: [moveId], fields: ['state', 'amount_residual', 'currency_id'],
      });
      const receivableLines = await call<Array<{ account_id: [number, string] }>>('account.move.line', 'search_read', {
        domain: [['move_id', '=', moveId], ['account_type', '=', 'asset_receivable']], fields: ['account_id'], limit: 2,
      });
      assertEquals(receivableLines.length, 1, 'one receivable account exists for the posted invoice');
      const accountIds = [receivableLines[0].account_id[0], journal.default_account_id[0], prepaid.id];
      const accountRows = await call<Array<{ id: number; currency_id: false | [number, string] }>>('account.account', 'read', {
        ids: accountIds, fields: ['currency_id'],
      });
      const accountCurrency = new Map(accountRows.map((row) => [row.id, row.currency_id === false ? currency : row.currency_id[1]]));
      const defaults: ReceiptDefaults = {
        companyCurrency: currency, partners: { client: partnerId }, journalId: journal.id,
        inboundMethodLineId: journal.inbound_payment_method_line_ids[0], taxPrepaidAccountId: prepaid.id,
        accountCurrencies: {
          receivable: accountCurrency.get(receivableLines[0].account_id[0])!,
          cash: accountCurrency.get(journal.default_account_id[0])!,
          taxPrepaid: accountCurrency.get(prepaid.id)!,
        },
      };
      const adapter = createOdooRevenueAdapter({
        call: receiptCall,
        resolveInvoice: async () => { throw new Error('invoice resolution is unused for receipt commands'); },
        resolveReceipt: async () => ({
          input: receipt,
          invoice: { id: invoiceId, orgId: 'bed', customerId: 'client', state: invoiceMove.state, outstanding: invoiceMove.amount_residual, currency: invoiceMove.currency_id === false ? currency : invoiceMove.currency_id[1] },
          defaults, recordedBy: 'bed-finance-approver', invoiceRef: `account.move:${moveId}`,
        }),
      });
      const started = new Date(Date.now() - 60_000).toISOString().slice(0, 19).replace('T', ' ');
      const ended = new Date(Date.now() + 10 * 60_000).toISOString().slice(0, 19).replace('T', ' ');
      if (loseWizardResponse) await assertRejects(() => adapter.commit(command), Error, 'simulated lost response after receipt registration');
      const composite: ReceiptComposite & { recordedBy: string } = {
        partnerId, amount: Number(receipt.cash ?? receipt.settled), date: receipt.date, invoiceId: moveId,
        createdAfter: started, createdBefore: ended, recordedBy: 'bed-finance-approver',
      };
      const recovered = await recoverReceipt(call, record, composite, receipt);
      const result = recovered ?? (loseWizardResponse ? null : await adapter.commit(command));
      assert(result, 'the receipt is confirmed or recovered');
      const paymentId = parseOdooExternalRef('account.payment', result.externalRecordId);
      assert(paymentId, 'the receipt has a model-qualified payment reference');
      const [payment] = await call<Array<{ state: string; payment_type: string; amount: number; reconciled_invoice_ids: number[]; move_id: [number, string] }>>('account.payment', 'read', {
        ids: [paymentId], fields: ['state', 'payment_type', 'amount', 'reconciled_invoice_ids', 'move_id'],
      });
      assertEquals(payment.payment_type, 'inbound');
      assertEquals(payment.amount, receipt.cash ?? receipt.settled);
      assert(payment.reconciled_invoice_ids.includes(moveId), 'receipt is reconciled to the intended invoice');
      const [settledInvoice] = await call<Array<{ amount_residual: number }>>('account.move', 'read', { ids: [moveId], fields: ['amount_residual'] });
      assertEquals(settledInvoice.amount_residual, 0, 'the gross receipt settles the invoice');
      const paymentMoveId = payment.move_id[0];
      const entries = await call<Array<{ account_id: [number, string]; debit: number; credit: number }>>('account.move.line', 'search_read', {
        domain: [['move_id', '=', paymentMoveId]], fields: ['account_id', 'debit', 'credit'],
      });
      const withheld = Number(receipt.withheld ?? 0);
      if (withheld > 0) {
        assert(entries.some((line) => line.account_id[0] === prepaid.id && line.debit - line.credit === withheld),
          'withheld tax is booked to the configured tax-prepaid current asset');
      }
      const anchor = externalIdentifier(`ip:${receipt.id}`);
      const anchors = await call<Array<{ res_id: number }>>('ir.model.data', 'search_read', {
        domain: [['module', '=', anchor.module], ['name', '=', anchor.name], ['model', '=', 'account.payment']], fields: ['res_id'],
      });
      assertEquals(anchors.map((row) => row.res_id), [paymentId], 'exactly one receipt anchor is present after the interruption/recovery');
      return { result, paymentId, residual: settledInvoice.amount_residual };
    };

    const date = new Date().toISOString().slice(0, 10);
    const plainReceipt = await makeReceipt(plainInvoice.id, plainInvoice.moveId, {
      id: crypto.randomUUID(), orgId: 'bed', date, currency, settled: 111000, cash: 111000,
    }, false);
    const withheldReceipt = await makeReceipt(withheldInvoice.id, withheldInvoice.moveId, {
      id: crypto.randomUUID(), orgId: 'bed', date, currency, settled: 111000, cash: 109000, withheld: 2000,
      slipNumber: `${stamp}-BP`,
    }, true);
    assertEquals([plainReceipt.residual, withheldReceipt.residual], [0, 0]);
    assertEquals([plainReceipt.result.canonical.amount, plainReceipt.result.canonical.received_amount, plainReceipt.result.canonical.withheld_amount], [111000, 111000, 0]);
    assertEquals([withheldReceipt.result.canonical.amount, withheldReceipt.result.canonical.received_amount, withheldReceipt.result.canonical.withheld_amount], [111000, 109000, 2000]);
  },
});
