/**
 * AC-ODR-011 (#2290) on the stock Odoo bed: with the company's fiscal-year lock set to a synthetic past date, a vendor bill, a customer
 * invoice, a vendor payment and a customer receipt dated INSIDE the lock are posted by Odoo on a later accounting date instead of being
 * refused. The SHIPPED Odoo adapters push each one; the canonical must carry Odoo's own accounting date (`erp_posting_date`) and name the
 * difference (`ledger-date-differs`); a re-dated receipt is adopted and flagged, never refused. Each case reads Odoo's `account.move.date`
 * itself and compares it with PMO's canonical. The lock is read first (the bed must start with none, so another run's lock is never
 * overwritten), set per case and restored in `finally`. Gated on the dependency, never on CI: the bed's URL, database and key come from
 * its untracked env file, sourced and never printed. Everything is synthetic and stamped; a posted document cannot be deleted on the
 * bed, so it stays as stamped throwaway data, like the other bed tests'.
 *   scripts/with-odoo-lock.sh bash -c 'set -a; . ./.env.odoo.local; set +a; ODOO_BED_URL=http://127.0.0.1:$ODOO_PORT \
 *     ODOO_BED_DB=$ODOO_DB ODOO_BED_KEY=$ODOO_API_KEY deno test --allow-env --allow-net --allow-read supabase/functions/adapter-dispatch/odooLedgerDate.bed.test.ts'
 */
import { assert, assertEquals } from '@std/assert';
import type { AdapterCommand } from '../../../pmo-portal/src/lib/adapterSeam/contract.ts';
import { bindCall, type OdooCall } from '../../../pmo-portal/src/lib/adapterSeam/odoo/client.ts';
import { createOdooProcurementAdapter, type PaymentFacts } from '../../../pmo-portal/src/lib/adapterSeam/odoo/procurementAdapter.ts';
import { createOdooRevenueAdapter } from '../../../pmo-portal/src/lib/adapterSeam/odoo/revenueAdapter.ts';
import type { BillCtx, BillInput } from '../../../pmo-portal/src/lib/adapterSeam/odoo/purchase/billBody.ts';
import type { OrderCtx, OrderInput } from '../../../pmo-portal/src/lib/adapterSeam/odoo/purchase/orderBody.ts';
import { odooExternalRef, parseOdooExternalRef } from '../../../pmo-portal/src/lib/adapterSeam/odoo/purchase/anchors.ts';
import type { InvoiceMaps, PmoInvoice } from '../../../pmo-portal/src/lib/adapterSeam/odoo/revenue/invoiceBody.ts';
import { expectedInvoiceTotal, type InvoiceExpect } from '../../../pmo-portal/src/lib/adapterSeam/odoo/revenue/invoiceReadBack.ts';
import type { ReceiptDefaults, ReceiptInput } from '../../../pmo-portal/src/lib/adapterSeam/odoo/revenue/receiptBody.ts';

const BED = Deno.env.get('ODOO_BED_URL');
const DB = Deno.env.get('ODOO_BED_DB') ?? '';
const KEY = Deno.env.get('ODOO_BED_KEY') ?? '';
const LOCK = '2025-01-31';   // synthetic past date: no other bed test dates anything on or before it
const INSIDE = '2025-01-20';
const OPEN = '2026-12-05';   // after the lock: the document a payment settles is posted unlocked

/** The bed's accounting company, a call scoped to it, and the lock helpers shared by every case. */
async function rig() {
  const raw = bindCall({ baseUrl: BED!, apiKey: KEY, database: DB, fetchImpl: fetch });
  let companyId = 0;
  for (const { id } of await raw<Array<{ id: number }>>('res.company', 'search_read', { domain: [], fields: ['id'] })) {
    const found = await raw<number[]>('account.tax', 'search', { domain: [['type_tax_use', '=', 'purchase'], ['amount', '=', 11], ['price_include', '=', false], ['company_id', '=', id]], limit: 1, context: { allowed_company_ids: [id] } });
    if (found.length) { companyId = id; break; }
  }
  assert(companyId, 'no company on the bed has the Indonesian chart (load it, scripts/odoo-probe.mjs)');
  const call = (async (model: string, method: string, body: Record<string, unknown> = {}) => {
    try { return await raw(model, method, { ...body, context: { allowed_company_ids: [companyId], ...((body.context as object) ?? {}) } }); } catch (err) {
      throw new Error(`${model}/${method} refused: ${(err as Error).message}`, { cause: err });
    }
  }) as OdooCall;
  const make = async (model: string, vals: Record<string, unknown>) => (await call<number[]>(model, 'create', { vals_list: [vals] }))[0];
  const readLock = async () => (await call<Array<{ fiscalyear_lock_date: string | false }>>('res.company', 'read', { ids: [companyId], fields: ['fiscalyear_lock_date'] }))[0].fiscalyear_lock_date;
  /** Run `fn` with the lock set; restore the bed's own value afterwards and prove it by reading it back. */
  const inLock = async <T>(fn: () => Promise<T>): Promise<T> => {
    const before = await readLock();
    assertEquals(before, false, 'the bed must start with no fiscal-year lock; this test will not overwrite another run\'s');
    await call('res.company', 'write', { ids: [companyId], vals: { fiscalyear_lock_date: LOCK } });
    try { return await fn(); } finally {
      await call('res.company', 'write', { ids: [companyId], vals: { fiscalyear_lock_date: before } });
      assertEquals(await readLock(), before, 'the lock is restored');
    }
  };
  const [company] = await call<Array<{ currency_id: [number, string] }>>('res.company', 'read', { ids: [companyId], fields: ['currency_id'] });
  const moveDate = async (id: number) => (await call<Array<{ date: string; invoice_date: string | false }>>('account.move', 'read', { ids: [id], fields: ['date', 'invoice_date'] }))[0];
  const paymentMoveDate = async (id: number) => {
    const [p] = await call<Array<{ date: string; move_id: [number, string] }>>('account.payment', 'read', { ids: [id], fields: ['date', 'move_id'] });
    return { paymentDate: p.date, moveDate: (await moveDate(p.move_id[0])).date };
  };
  return { call, make, inLock, company, currency: company.currency_id, moveDate, paymentMoveDate, companyId };
}

/** Odoo moved the date: later than the lock, and not the one PMO sent. Returns the ledger's date. */
function movedBy(odoo: string, sent: string): string {
  assert(odoo > LOCK && odoo !== sent, `Odoo posted on ${odoo}; expected a date after the lock ${LOCK}, not ${sent}`);
  return odoo;
}

const gate = { ignore: !(BED && DB && KEY), sanitizeResources: false, sanitizeOps: false } as const;

Deno.test({
  name: 'AC-ODR-003 / AC-ODR-011 on the bed: a vendor bill dated inside the locked period is posted on Odoo\'s later date, which the canonical carries with ledger-date-differs',
  ...gate,
  fn: async () => {
    const { call, make, inLock, currency, moveDate, companyId } = await rig();
    const stamp = `L2290B-${Date.now()}`;
    const [plan] = await call<Array<{ id: number }>>('account.analytic.plan', 'search_read', { domain: [], fields: ['id'], limit: 1 });
    const partner = await make('res.partner', { name: `${stamp} vendor`, supplier_rank: 1 });
    const service = await make('product.product', { name: `${stamp} service`, type: 'service', purchase_ok: true });
    const account = await make('account.analytic.account', { name: `${stamp} cost account`, code: stamp, plan_id: plan.id });
    const bill: BillInput = { vendor: `Vendor:${partner}`, reference: `${stamp}-INV`, invoiceDate: INSIDE, projectIds: ['p-1'], lines: [{ name: 'service', quantity: 1, rate: 100, purchaseLineId: null }] };
    const ctx: BillCtx = { companyId, currencyId: currency[0], itemMap: { service: String(service) }, unitMap: {}, costAccountId: String(account), taxes: [] };
    const orderInput: OrderInput = { vendor: `Vendor:${partner}`, caseNumber: stamp, vendorReference: `${stamp}-PO`, expectedDate: OPEN, projectIds: ['p-1'], lines: [{ name: 'service', quantity: 1, rate: 100 }] };
    const orderCtx: OrderCtx = { companyId, currencyId: currency[0], itemMap: { service: String(service) }, unitMap: {}, costAccountId: String(account), taxIds: [] };
    const adapter = createOdooProcurementAdapter({
      call, resolveOrder: async () => ({ input: orderInput, ctx: orderCtx }), resolveRevise: () => Promise.reject(new Error('no revise')), resolveBill: async () => ({ input: bill, ctx }),
    });
    const command: AdapterCommand = { domain: 'procurement', operation: 'create', idempotencyKey: `${stamp}-bill`, record: { id: crypto.randomUUID(), erp_doc_kind: 'purchase-invoice', procurementId: 'case-1' } };
    const result = await inLock(() => adapter.commit(command));
    const move = await moveDate(parseOdooExternalRef('account.move', result.externalRecordId)!);
    const ledger = movedBy(move.date, INSIDE);
    console.log(`[odr] ${stamp}: Odoo ledger date ${ledger}, PMO erp_posting_date ${result.canonical.erp_posting_date}`);
    assertEquals(move.invoice_date, INSIDE, 'the document date is left as typed');
    assertEquals(result.canonical.erp_posting_date, ledger);
    assertEquals(result.canonical.invoice_date, INSIDE);
    assertEquals([result.canonical.odoo_outcome, result.canonical.odoo_attention], ['needs-attention', ['ledger-date-differs']]);
    // an unmoved bill carries the ledger's own date and no flag (the lock is off again here)
    const openBill: BillInput = { ...bill, reference: `${stamp}-OPEN`, invoiceDate: OPEN };
    const open = await createOdooProcurementAdapter({
      call, resolveOrder: async () => ({ input: orderInput, ctx: orderCtx }), resolveRevise: () => Promise.reject(new Error('no revise')), resolveBill: async () => ({ input: openBill, ctx }),
    }).commit({ ...command, idempotencyKey: `${stamp}-open`, record: { ...command.record, id: crypto.randomUUID() } });
    assertEquals([open.canonical.erp_posting_date, 'odoo_outcome' in open.canonical], [OPEN, false]);
  },
});

Deno.test({
  name: 'AC-ODR-004 / AC-ODR-011 on the bed: a customer invoice dated inside the locked period is posted on Odoo\'s later date, which the canonical carries with ledger-date-differs',
  ...gate,
  fn: async () => {
    const { call, make, inLock, currency, moveDate, companyId } = await rig();
    const stamp = `L2290I-${Date.now()}`;
    const taxIds = await call<number[]>('account.tax', 'search', { domain: [['type_tax_use', '=', 'sale'], ['amount', '=', 11], ['price_include', '=', false], ['company_id', '=', companyId]], limit: 1 });
    assert(taxIds.length, 'the Indonesian chart has its sale tax of 11%');
    const [plan] = await call<Array<{ id: number }>>('account.analytic.plan', 'search_read', { domain: [], fields: ['id'], limit: 1 });
    const [income] = await call<Array<{ id: number }>>('account.account', 'search_read', { domain: [['account_type', '=', 'income'], ['company_ids', 'in', [companyId]]], fields: ['id'], limit: 1 });
    const partner = await make('res.partner', { name: `${stamp} client`, customer_rank: 1 });
    const service = await make('product.product', { name: `${stamp} service`, type: 'service', sale_ok: true });
    const account = await make('account.analytic.account', { name: `${stamp} cost account`, code: stamp, plan_id: plan.id });
    const lines = [{ itemId: 'svc', description: 'BoQ 1', quantity: 1, unitPrice: 100 }];
    const maps: InvoiceMaps = { companyCurrency: currency[1], partners: { c: partner }, items: { svc: { productId: service, incomeAccountId: income.id } }, units: {}, costAccountId: account, taxIds };
    const id = crypto.randomUUID();
    const input: PmoInvoice = { id, customerId: 'c', invoiceDate: INSIDE, currency: currency[1], referenceNumber: `${stamp}-PO`, lines };
    const expect: InvoiceExpect = { total: expectedInvoiceTotal(lines, [11]), costAccountId: account, date: INSIDE, ref: `${stamp}-PO` };
    const adapter = createOdooRevenueAdapter({ call, resolveInvoice: async () => ({ input, maps, expect }) });
    const command: AdapterCommand = { domain: 'revenue', operation: 'transition', idempotencyKey: `${stamp}-inv`, record: { id, erp_doc_kind: 'sales-invoice', verb: 'submit' } };
    const result = await inLock(() => adapter.commit(command));
    const move = await moveDate(parseOdooExternalRef('account.move', result.externalRecordId)!);
    const ledger = movedBy(move.date, INSIDE);
    console.log(`[odr] ${stamp}: Odoo ledger date ${ledger}, PMO erp_posting_date ${result.canonical.erp_posting_date}`);
    assertEquals(move.invoice_date, INSIDE, 'the document date is left as typed');
    assertEquals(result.canonical.erp_posting_date, ledger);
    assertEquals(result.canonical.invoice_date, INSIDE);
    assertEquals(result.canonical.odoo_attention, 'ledger-date-differs');
  },
});

Deno.test({
  name: 'AC-ODR-006 / AC-ODR-011 on the bed: a vendor payment dated inside the locked period is posted on Odoo\'s later date, which the canonical carries with ledger-date-differs',
  ...gate,
  fn: async () => {
    const { call, make, inLock, currency, paymentMoveDate } = await rig();
    const stamp = `L2290P-${Date.now()}`;
    const [journal] = await call<Array<{ id: number; outbound_payment_method_line_ids: number[] }>>('account.journal', 'search_read', { domain: [['type', '=', 'bank']], fields: ['outbound_payment_method_line_ids'], limit: 1 });
    assert(journal?.outbound_payment_method_line_ids.length, 'the bed has a bank journal with an outbound payment method');
    const partner = await make('res.partner', { name: `${stamp} vendor`, supplier_rank: 1 });
    const service = await make('product.product', { name: `${stamp} service`, type: 'service', purchase_ok: true });
    const billId = await make('account.move', { move_type: 'in_invoice', partner_id: partner, currency_id: currency[0], invoice_date: OPEN, ref: `${stamp}-INV`,
      invoice_line_ids: [[0, 0, { product_id: service, quantity: 1, price_unit: 100, tax_ids: [[6, 0, []]] }]] });
    await call('account.move', 'action_post', { ids: [billId] });
    const facts: PaymentFacts = { billRef: odooExternalRef('account.move', billId), amount: '100.00', date: INSIDE, vendorPartnerId: partner, journalId: journal.id, companyCurrencyId: currency[0] };
    const adapter = createOdooProcurementAdapter({
      call, resolveOrder: () => Promise.reject(new Error('no order')), resolveRevise: () => Promise.reject(new Error('no revise')), resolveBill: () => Promise.reject(new Error('no bill')),
      resolvePayment: async () => facts,
    });
    const id = crypto.randomUUID();
    const command: AdapterCommand = { domain: 'procurement', operation: 'create', idempotencyKey: `${stamp}-pay`, record: { id, erp_doc_kind: 'payment', procurementId: 'case-1', invoiceId: 'inv-1', paid_amount: '100.00', date: INSIDE } };
    const result = await inLock(() => adapter.commit(command));
    const posted = await paymentMoveDate(parseOdooExternalRef('account.payment', result.externalRecordId)!);
    const ledger = movedBy(posted.moveDate, INSIDE);
    console.log(`[odr] ${stamp}: Odoo ledger date ${ledger}, PMO erp_posting_date ${result.canonical.erp_posting_date}`);
    assertEquals(result.canonical.erp_posting_date, ledger, `Odoo's ledger date is the payment's move date (the payment's own date reads ${posted.paymentDate})`);
    assertEquals([result.canonical.odoo_outcome, result.canonical.odoo_attention], ['needs-attention', ['ledger-date-differs']]);
  },
});

Deno.test({
  name: 'AC-ODR-007 / AC-ODR-011 on the bed: a customer receipt dated inside the locked period is adopted on Odoo\'s later date and flagged ledger-date-differs, never refused',
  ...gate,
  fn: async () => {
    const { call, make, inLock, currency, paymentMoveDate } = await rig();
    const stamp = `L2290R-${Date.now()}`;
    const [journal] = await call<Array<{ id: number; inbound_payment_method_line_ids: number[] }>>('account.journal', 'search_read', { domain: [['type', '=', 'bank']], fields: ['inbound_payment_method_line_ids'], limit: 1 });
    assert(journal?.inbound_payment_method_line_ids.length, 'the bed has a bank journal with an inbound payment method');
    const partner = await make('res.partner', { name: `${stamp} client`, customer_rank: 1 });
    const service = await make('product.product', { name: `${stamp} service`, type: 'service', sale_ok: true });
    const moveId = await make('account.move', { move_type: 'out_invoice', partner_id: partner, currency_id: currency[0], invoice_date: OPEN,
      invoice_line_ids: [[0, 0, { product_id: service, quantity: 1, price_unit: 100, tax_ids: [[6, 0, []]] }]] });
    await call('account.move', 'action_post', { ids: [moveId] });
    const receipt: ReceiptInput = { id: crypto.randomUUID(), orgId: 'bed', date: INSIDE, currency: currency[1], settled: 100, cash: 100 };
    const defaults: ReceiptDefaults = { companyCurrency: currency[1], partners: { client: partner }, journalId: journal.id, inboundMethodLineId: journal.inbound_payment_method_line_ids[0], taxPrepaidAccountId: null };
    const adapter = createOdooRevenueAdapter({
      call, resolveInvoice: async () => { throw new Error('unused for receipt commands'); },
      resolveReceipt: async () => ({
        input: receipt, invoice: { id: 'inv-1', orgId: 'bed', customerId: 'client', state: 'posted', outstanding: 100, currency: currency[1] },
        defaults, recordedBy: 'bed-finance-approver', invoiceRef: `account.move:${moveId}`,
      }),
    });
    const command: AdapterCommand = { domain: 'revenue', operation: 'create', idempotencyKey: `${stamp}-rcp`, record: { id: receipt.id, erp_doc_kind: 'incoming-payment', date: INSIDE, paid_amount: 100, received_amount: 100, withheld_amount: 0 } };
    const result = await inLock(() => adapter.commit(command));
    const posted = await paymentMoveDate(parseOdooExternalRef('account.payment', result.externalRecordId)!);
    const ledger = movedBy(posted.moveDate, INSIDE);
    console.log(`[odr] ${stamp}: Odoo ledger date ${ledger}, PMO erp_posting_date ${result.canonical.erp_posting_date}`);
    assertEquals(result.canonical.date, INSIDE, 'the entered date stays as typed');
    assertEquals(result.canonical.erp_posting_date, ledger, `Odoo's ledger date is the payment's move date (the payment's own date reads ${posted.paymentDate})`);
    assertEquals(result.canonical.odoo_attention, ['ledger-date-differs']);
  },
});

Deno.test({
  name: 'AC-ODR-007 / AC-ODR-011 on the bed: a withheld customer receipt through the register wizard, dated inside the locked period, is adopted on Odoo\'s later date and flagged ledger-date-differs',
  ...gate,
  fn: async () => {
    const { call, make, inLock, currency, paymentMoveDate, companyId } = await rig();
    const stamp = `L2290W-${Date.now()}`;
    const [journal] = await call<Array<{ id: number; inbound_payment_method_line_ids: number[] }>>('account.journal', 'search_read', { domain: [['type', '=', 'bank']], fields: ['inbound_payment_method_line_ids'], limit: 1 });
    assert(journal?.inbound_payment_method_line_ids.length, 'the bed has a bank journal with an inbound payment method');
    const [prepaid] = await call<Array<{ id: number }>>('account.account', 'search_read', { domain: [['account_type', '=', 'asset_current'], ['company_ids', 'in', [companyId]]], fields: ['id'], limit: 1 });
    assert(prepaid, 'the bed has a current-asset account to take the withheld tax');
    const partner = await make('res.partner', { name: `${stamp} client`, customer_rank: 1 });
    const service = await make('product.product', { name: `${stamp} service`, type: 'service', sale_ok: true });
    const moveId = await make('account.move', { move_type: 'out_invoice', partner_id: partner, currency_id: currency[0], invoice_date: OPEN,
      invoice_line_ids: [[0, 0, { product_id: service, quantity: 1, price_unit: 100, tax_ids: [[6, 0, []]] }]] });
    await call('account.move', 'action_post', { ids: [moveId] });
    const receipt: ReceiptInput = { id: crypto.randomUUID(), orgId: 'bed', date: INSIDE, currency: currency[1], settled: 100, cash: 98, withheld: 2, slipNumber: `${stamp}-BP` };
    const defaults: ReceiptDefaults = {
      companyCurrency: currency[1], partners: { client: partner }, journalId: journal.id, inboundMethodLineId: journal.inbound_payment_method_line_ids[0], taxPrepaidAccountId: prepaid.id,
      accountCurrencies: { receivable: currency[1], cash: currency[1], taxPrepaid: currency[1] },
    };
    const adapter = createOdooRevenueAdapter({
      call, resolveInvoice: async () => { throw new Error('unused for receipt commands'); },
      resolveReceipt: async () => ({
        input: receipt, invoice: { id: 'inv-1', orgId: 'bed', customerId: 'client', state: 'posted', outstanding: 100, currency: currency[1] },
        defaults, recordedBy: 'bed-finance-approver', invoiceRef: `account.move:${moveId}`,
      }),
    });
    const command: AdapterCommand = { domain: 'revenue', operation: 'create', idempotencyKey: `${stamp}-wiz`, record: { id: receipt.id, erp_doc_kind: 'incoming-payment', date: INSIDE, paid_amount: 100, received_amount: 98, withheld_amount: 2, withholding_slip_number: receipt.slipNumber } };
    const result = await inLock(() => adapter.commit(command));
    const posted = await paymentMoveDate(parseOdooExternalRef('account.payment', result.externalRecordId)!);
    const ledger = movedBy(posted.moveDate, INSIDE);
    console.log(`[odr] ${stamp}: Odoo ledger date ${ledger}, PMO erp_posting_date ${result.canonical.erp_posting_date}`);
    assertEquals(result.canonical.date, INSIDE, 'the entered date stays as typed');
    assertEquals(result.canonical.erp_posting_date, ledger, `Odoo's ledger date is the payment's move date (the payment's own date reads ${posted.paymentDate})`);
    assertEquals(result.canonical.odoo_attention, ['ledger-date-differs']);
    assertEquals(result.canonical.withheld_amount, 2);
  },
});
