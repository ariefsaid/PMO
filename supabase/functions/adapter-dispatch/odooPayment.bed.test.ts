/**
 * AC-OPP-050 / AC-OPP-052 / AC-OPP-053 (layer B, #1505 P6) on the stock Odoo bed: a vendor bill of 98 is paid from the chosen bank journal
 * and Odoo's own residual reaches 0; a split of 40 then 58 settles it; 99 is refused before any write (Odoo would accept it); a payment
 * whose reconcile response was lost is found again by its memo and not duplicated; and when a clerk has edited the memo of a payment that
 * was never reconciled the recovery holds instead of guessing. The SHIPPED Odoo procurement adapter and recovery probe run against the real
 * JSON-2 API. Gated on the dependency, never on CI: the bed's URL, database and key come from its untracked env file, sourced and never
 * printed. Everything is synthetic and stamped; the bed is throwaway (a posted bill cannot be deleted, it stays as stamped data).
 *   scripts/with-odoo-lock.sh bash -c 'set -a; . ./.env.odoo.local; set +a; ODOO_BED_URL=http://127.0.0.1:$ODOO_PORT \
 *     ODOO_BED_DB=$ODOO_DB ODOO_BED_KEY=$ODOO_API_KEY deno test --allow-env --allow-net --allow-read supabase/functions/adapter-dispatch/odooPayment.bed.test.ts'
 */
import { assert, assertEquals, assertRejects } from '@std/assert';
import type { AdapterCommand } from '../../../pmo-portal/src/lib/adapterSeam/contract.ts';
import { bindCall, type OdooCall } from '../../../pmo-portal/src/lib/adapterSeam/odoo/client.ts';
import { createOdooProcurementAdapter, recoverPayment, type PaymentFacts } from '../../../pmo-portal/src/lib/adapterSeam/odoo/procurementAdapter.ts';
import { createOdooRevenueAdapter, recoverReceipt } from '../../../pmo-portal/src/lib/adapterSeam/odoo/revenueAdapter.ts';
import type { ReceiptDefaults, ReceiptInput, ReceiptInvoice } from '../../../pmo-portal/src/lib/adapterSeam/odoo/revenue/receiptBody.ts';
import type { ReceiptComposite } from '../../../pmo-portal/src/lib/adapterSeam/odoo/revenue/receiptRecoveryProbe.ts';
import { externalIdentifier as receiptExternalIdentifier } from '../../../pmo-portal/src/lib/adapterSeam/odoo/revenue/anchors.ts';
import { invoiceReceiptAwaitingOdoo, invoiceStatus } from '../../../pmo-portal/src/lib/adapterSeam/odoo/revenue/status.ts';
import { odooExternalRef, parseOdooExternalRef } from '../../../pmo-portal/src/lib/adapterSeam/odoo/purchase/anchors.ts';

const BED = Deno.env.get('ODOO_BED_URL');
const DB = Deno.env.get('ODOO_BED_DB') ?? '';
const KEY = Deno.env.get('ODOO_BED_KEY') ?? '';

Deno.test({
  name: 'AC-OPP-050 / AC-OPP-052 / AC-OPP-053 on the bed: a bill of 98 is paid once from the chosen journal to residual 0; 40 + 58 settles it; 99 is refused; a lost response is not paid twice; an edited memo on an unreconciled payment is held',
  ignore: !(BED && DB && KEY),
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    const stamp = `P6-${Date.now()}`;
    let lose: { model: string; method: string; mode: 'lost-response' | 'transport' } | null = null;
    const faultyFetch = (async (url: string | URL | Request, init?: RequestInit) => {
      const [model, method] = String(url).split('/').slice(-2);
      const armed = lose && lose.model === model && lose.method === method ? lose : null;
      if (armed?.mode === 'transport') { lose = null; throw new TypeError('connection reset'); }
      const response = await fetch(url, init);
      if (armed) { lose = null; throw new TypeError('connection reset after the server answered'); }
      return response;
    }) as typeof fetch;
    const raw = bindCall({ baseUrl: BED!, apiKey: KEY, database: DB, fetchImpl: faultyFetch });
    // Accounting runs in the company with a chart; every call is made in that company.
    let companyId = 0;
    for (const { id } of await raw<Array<{ id: number }>>('res.company', 'search_read', { domain: [], fields: ['id'] })) {
      const found = await raw<number[]>('account.journal', 'search', { domain: [['type', '=', 'purchase'], ['company_id', '=', id]], limit: 1, context: { allowed_company_ids: [id] } });
      if (found.length) { companyId = id; break; }
    }
    assert(companyId, 'no company on the bed has a purchase journal (load a chart, scripts/odoo-probe.mjs)');
    const call = (async (model: string, method: string, body: Record<string, unknown> = {}) => {
      try { return await raw(model, method, { ...body, context: { allowed_company_ids: [companyId], ...((body.context as object) ?? {}) } }); } catch (err) {
        throw new Error(`${model}/${method} refused: ${(err as Error).message}`, { cause: err });
      }
    }) as OdooCall;
    const make = async (model: string, vals: Record<string, unknown>) => (await call<number[]>(model, 'create', { vals_list: [vals] }))[0];
    const [company] = await call<Array<{ currency_id: [number, string] }>>('res.company', 'read', { ids: [companyId], fields: ['currency_id'] });
    const currencyId = company.currency_id[0];

    // The chosen payment journal: a bank journal with an outbound payment method line (seeded once if the company has none).
    let [journal] = await call<Array<{ id: number; outbound_payment_method_line_ids: number[] }>>('account.journal', 'search_read', {
      domain: [['type', '=', 'bank'], ['company_id', '=', companyId]], fields: ['outbound_payment_method_line_ids'], limit: 1 });
    if (!journal) {
      const id = await make('account.journal', { name: `${stamp} bank`, code: 'P6B', type: 'bank', company_id: companyId });
      [journal] = await call('account.journal', 'read', { ids: [id], fields: ['outbound_payment_method_line_ids'] });
    }
    assert(journal.outbound_payment_method_line_ids.length > 0, 'the bed bank journal has no outbound payment method line');

    const partner = await make('res.partner', { name: `${stamp} vendor`, supplier_rank: 1 });
    const service = await make('product.product', { name: `${stamp} service`, type: 'service', purchase_ok: true });
    const postedBill = async (total: number) => {
      const id = await make('account.move', { move_type: 'in_invoice', partner_id: partner, currency_id: currencyId, invoice_date: '2026-12-05', ref: `${stamp}-${total}-${crypto.randomUUID()}`,
        invoice_line_ids: [[0, 0, { product_id: service, quantity: 1, price_unit: total, tax_ids: [[6, 0, []]] }]] });
      await call('account.move', 'action_post', { ids: [id] });
      return id;
    };
    const residual = async (id: number) => (await call<Array<{ amount_residual: number }>>('account.move', 'read', { ids: [id], fields: ['amount_residual'] }))[0].amount_residual;
    const paymentsOf = (id: number) => call<Array<{ id: number; state: string; amount: number; memo: string; reconciled_bill_ids: number[]; partner_id: [number, string]; journal_id: [number, string] }>>(
      'account.payment', 'search_read', { domain: [['partner_id', '=', partner], ['reconciled_bill_ids', 'in', [id]]], fields: ['state', 'amount', 'memo', 'reconciled_bill_ids', 'partner_id', 'journal_id'], order: 'id asc' });
    const allPayments = () => call<Array<{ id: number }>>('account.payment', 'search_read', { domain: [['partner_id', '=', partner]], fields: ['id'] });

    const rig = (billId: number, amount: string) => {
      const facts: PaymentFacts = { billRef: odooExternalRef('account.move', billId), amount, date: '2026-12-10', vendorPartnerId: partner, journalId: journal.id, companyCurrencyId: currencyId };
      const adapter = createOdooProcurementAdapter({
        call, resolveOrder: () => Promise.reject(new Error('no order')), resolveRevise: () => Promise.reject(new Error('no revise')), resolveBill: () => Promise.reject(new Error('no bill')),
        resolvePayment: async () => facts,
      });
      const command = (id = crypto.randomUUID()): AdapterCommand => ({
        domain: 'procurement', operation: 'create', idempotencyKey: `${stamp}-${id}`, record: { id, erp_doc_kind: 'payment', procurementId: 'case-1', invoiceId: 'inv-1', paid_amount: amount, date: '2026-12-10' } });
      const window = { createdAfter: '2000-01-01 00:00:00' };
      const attempt = async (cmd: AdapterCommand, recovery = false) =>
        (await recoverPayment(call, cmd.record, recovery ? { partnerId: partner, amount, billId, ...window } : undefined, facts.billRef!)) ?? adapter.commit(cmd);
      return { command, attempt };
    };

    // 1) The whole bill, from the chosen journal: one posted payment reconciled to the bill, Odoo's residual 0.
    const whole = await postedBill(98);
    {
      const { command, attempt } = rig(whole, '98.00');
      const cmd = command();
      const first = await attempt(cmd);
      const [payment] = await paymentsOf(whole);
      assertEquals(first.externalRecordId, odooExternalRef('account.payment', payment.id));
      assertEquals([payment.amount, payment.memo, payment.journal_id[0], payment.reconciled_bill_ids], [98, `pmo:pay:${cmd.record.id}`, journal.id, [whole]]);
      assert(['paid', 'in_process', 'reconciled'].includes(payment.state), payment.state);   // the stock bed reports `paid` before any bank matching (SD-7)
      assertEquals(await residual(whole), 0);
      assertEquals(first.canonical.odoo_bill_residual, '0.00');
      // a replay finds the same payment and writes nothing
      const again = await attempt(cmd, true);
      assertEquals(again.externalRecordId, first.externalRecordId);
      assertEquals((await paymentsOf(whole)).length, 1);
    }

    // 2) A split, 40 then 58: two payments, partial and then settled.
    const split = await postedBill(98);
    await rig(split, '40.00').attempt(rig(split, '40.00').command());
    assertEquals(await residual(split), 58);
    await rig(split, '58.00').attempt(rig(split, '58.00').command());
    assertEquals([await residual(split), (await paymentsOf(split)).length], [0, 2]);

    // 3) 99 on a bill of 98 is refused before any write (Odoo would have accepted it).
    const over = await postedBill(98);
    const before = (await allPayments()).length;
    {
      const { command, attempt } = rig(over, '99.00');
      await assertRejects(() => attempt(command()), Error, 'over-payment');
      assertEquals([(await allPayments()).length, await residual(over)], [before, 98]);
    }

    // 4) The reconcile answered and the response was lost: the retry (a recovery) finds the payment by its memo; one payment in all.
    const lost = await postedBill(98);
    {
      const { command, attempt } = rig(lost, '98.00');
      const cmd = command();
      lose = { model: 'account.move.line', method: 'reconcile', mode: 'lost-response' };
      await assertRejects(() => attempt(cmd), Error);
      const retry = await attempt(cmd, true);
      assertEquals(parseOdooExternalRef('account.payment', retry.externalRecordId) !== null, true);
      assertEquals([(await paymentsOf(lost)).length, await residual(lost)], [1, 0]);
    }

    // 5) The reconcile never reached Odoo and a clerk edited the memo: the payment exists, unreconciled and unrecognised. Held, not guessed.
    const edited = await postedBill(98);
    {
      const { command, attempt } = rig(edited, '98.00');
      const cmd = command();
      lose = { model: 'account.move.line', method: 'reconcile', mode: 'transport' };
      await assertRejects(() => attempt(cmd), Error);
      const [stray] = await call<Array<{ id: number }>>('account.payment', 'search_read', { domain: [['partner_id', '=', partner], ['memo', '=', `pmo:pay:${cmd.record.id}`]], fields: ['id'] });
      assert(stray, 'the payment was created and posted before the reconcile was lost');
      await call('account.payment', 'write', { ids: [stray.id], vals: { memo: 'paid by transfer' } });
      const heldCount = async () => (await call<unknown[]>('account.payment', 'search', { domain: [['partner_id', '=', partner], ['amount', '=', 98]] })).length;
      const paymentsBefore = await heldCount();
      await assertRejects(() => attempt(cmd, true), Error, 'ambiguous-anchor');
      assertEquals([await heldCount(), await residual(edited)], [paymentsBefore, 98], 'the held retry made no second payment');
    }
  },
});

Deno.test({
  name: 'AC-OCI-040 / AC-OCI-044 C5-T7 on the bed: one and split client receipts settle only to Odoo residual, overpay refuses, withholding posts to a tax-prepaid account, and a lost response recovers one receipt',
  ignore: !(BED && DB && KEY),
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    const stamp = `C5-${Date.now()}`;
    const raw = bindCall({ baseUrl: BED!, apiKey: KEY, database: DB, fetchImpl: fetch });
    let companyId = 0;
    let currency = '';
    for (const { id, currency_id } of await raw<Array<{ id: number; currency_id: [number, string] }>>('res.company', 'search_read', { domain: [], fields: ['currency_id'] })) {
      if (currency_id?.[1] === 'IDR') { companyId = id; currency = currency_id[1]; break; }
    }
    assert(companyId, 'the bed has an Indonesian company chart');
    const call = (async (model: string, method: string, body: Record<string, unknown> = {}) => {
      try { return await raw(model, method, { ...body, context: { allowed_company_ids: [companyId], ...((body.context as object) ?? {}) } }); } catch (err) {
        throw new Error(`${model}/${method} refused: ${(err as Error).message}`, { cause: err });
      }
    }) as OdooCall;
    const make = async (model: string, vals: Record<string, unknown>) => (await call<number[]>(model, 'create', { vals_list: [vals] }))[0];
    const [journal] = await call<Array<{ id: number; inbound_payment_method_line_ids: number[]; default_account_id: [number, string] }>>('account.journal', 'search_read', {
      domain: [['type', '=', 'bank'], ['company_id', '=', companyId]], fields: ['inbound_payment_method_line_ids', 'default_account_id'], limit: 20,
    });
    const selectedJournal = journal && journal.inbound_payment_method_line_ids.length > 0 ? journal : null;
    assert(selectedJournal, 'the bank journal has an inbound payment method line');
    const [taxPrepaid] = await call<Array<{ id: number; currency_id: false | [number, string]; account_type: string }>>('account.account', 'search_read', {
      domain: [['account_type', 'in', ['asset_current', 'asset_prepayments']], ['company_ids', 'in', [companyId]]],
      fields: ['currency_id', 'account_type'], limit: 20,
    });
    assert(taxPrepaid, 'the chart has a live current asset account for client withholding');
    const customer = await make('res.partner', { name: `${stamp} client`, customer_rank: 1 });
    const service = await make('product.product', { name: `${stamp} service`, type: 'service', sale_ok: true });
    const date = '2026-11-03';
    const invoice = async (total: number, label: string) => {
      const id = await make('account.move', {
        move_type: 'out_invoice', partner_id: customer, invoice_date: date, ref: `${stamp}-${label}`,
        invoice_line_ids: [[0, 0, { product_id: service, name: `${stamp} ${label}`, quantity: 1, price_unit: total, tax_ids: [[6, 0, []]] }]],
      });
      await call('account.move', 'action_post', { ids: [id] });
      return id;
    };
    const readInvoice = async (id: number) => (await call<Array<{ state: string; move_type: string; partner_id: [number, string]; currency_id: false | [number, string]; amount_residual: number; write_date: string }>>(
      'account.move', 'read', { ids: [id], fields: ['state', 'move_type', 'partner_id', 'currency_id', 'amount_residual', 'write_date'] }))[0];
    const paymentsOf = (id: number) => call<Array<{ id: number; state: string; amount: number; payment_type: string; partner_type: string; reconciled_invoice_ids: number[] }>>(
      'account.payment', 'search_read', { domain: [['partner_id', '=', customer], ['reconciled_invoice_ids', 'in', [id]]], fields: ['state', 'amount', 'payment_type', 'partner_type', 'reconciled_invoice_ids'], order: 'id asc' });
    const currencies = async (ids: number[]) => {
      const accounts = await call<Array<{ id: number; currency_id: false | [number, string] }>>('account.account', 'read', { ids, fields: ['currency_id'] });
      return new Map(accounts.map((row) => [row.id, row.currency_id === false ? currency : row.currency_id[1]]));
    };
    const receiptId = () => crypto.randomUUID();
    const makeReceiptRig = (invoiceId: number, settled: number, options: { cash?: number; withheld?: number; slip?: string; id?: string; failAt?: { model: string; method: string } } = {}) => {
      const id = options.id ?? receiptId();
      const receiptInput: ReceiptInput = {
        id, orgId: 'bed-org', date, currency, settled, cash: options.cash ?? settled,
        ...(options.withheld ? { withheld: options.withheld, slipNumber: options.slip } : {}),
      };
      let trigger = options.failAt;
      const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
        const [, model, method] = /\/json\/2\/([^/]+)\/([^/]+)$/.exec(String(url)) ?? [];
        const response = await fetch(url, init);
        if (trigger?.model === model && trigger.method === method) {
          trigger = undefined;
          throw new TypeError('connection reset after the server answered');
        }
        return response;
      }) as typeof fetch;
      const receiptCall = bindCall({ baseUrl: BED!, apiKey: KEY, database: DB, fetchImpl });
      const resolveReceipt = async () => {
        const move = await readInvoice(invoiceId);
        const invoiceInput: ReceiptInvoice = { id: String(invoiceId), orgId: 'bed-org', customerId: 'bed-customer', state: move.state, outstanding: move.amount_residual, currency: move.currency_id === false ? currency : move.currency_id[1] };
        const receivable = await call<Array<{ account_id: [number, string] }>>('account.move.line', 'search_read', {
          domain: [['move_id', '=', invoiceId], ['account_type', '=', 'asset_receivable']], fields: ['account_id'], limit: 2,
        });
        assertEquals(receivable.length, 1, 'one receivable line is present for the posted customer invoice');
        const accountCurrencies = await currencies([receivable[0].account_id[0], selectedJournal.default_account_id[0], taxPrepaid.id]);
        const defaults: ReceiptDefaults = {
          companyCurrency: currency, partners: { 'bed-customer': customer }, journalId: selectedJournal.id,
          inboundMethodLineId: selectedJournal.inbound_payment_method_line_ids[0], taxPrepaidAccountId: taxPrepaid.id,
          accountCurrencies: {
            receivable: accountCurrencies.get(receivable[0].account_id[0])!, cash: accountCurrencies.get(selectedJournal.default_account_id[0])!,
            taxPrepaid: accountCurrencies.get(taxPrepaid.id)!,
          },
        };
        return { input: receiptInput, invoice: invoiceInput, defaults, recordedBy: 'bed-finance-user', invoiceRef: odooExternalRef('account.move', invoiceId) };
      };
      const adapter = createOdooRevenueAdapter({ call: receiptCall, resolveInvoice: async () => { throw new Error('invoice path unused'); }, resolveReceipt });
      const command: AdapterCommand = {
        domain: 'revenue', operation: 'create', idempotencyKey: `bed-${id}`,
        record: { id, erp_doc_kind: 'incoming-payment', salesInvoiceId: `pmo-${invoiceId}`, customerId: 'bed-customer', date, paid_amount: settled, received_amount: options.cash ?? settled, withheld_amount: options.withheld ?? 0, withholding_slip_number: options.slip ?? null },
      };
      const recoveryWindow = (): ReceiptComposite => ({
          partnerId: customer, amount: options.cash ?? settled, date, invoiceId,
          createdAfter: new Date(Date.now() - 10 * 60_000).toISOString().slice(0, 19).replace('T', ' '),
          createdBefore: new Date(Date.now() + 120_000).toISOString().slice(0, 19).replace('T', ' '),
        });
      const observed = async () => {
        const window = recoveryWindow();
        return { window, result: await recoverReceipt(receiptCall, command.record, window, receiptInput) };
      };
      return { id, input: receiptInput, command, adapter, call: receiptCall, recoveryWindow, observed };
    };

    // One receipt closes the invoice in Odoo; the PMO status changes only when the next invoice read supplies residual zero.
    const oneGo = await invoice(111_000, 'one-go');
    const before = await readInvoice(oneGo);
    assertEquals(invoiceStatus(before.state, before.amount_residual).status, 'Unpaid');
    const pushAt = new Date(Date.now() - 5_000).toISOString();
    assertEquals(invoiceReceiptAwaitingOdoo({ invoiceStatus: 'Unpaid', invoiceErpModified: before.write_date, receiptCommandState: 'pending', receiptCommandCreatedAt: pushAt }), true);
    const oneReceipt = makeReceiptRig(oneGo, 111_000);
    await oneReceipt.adapter.commit(oneReceipt.command);
    assertEquals((await readInvoice(oneGo)).amount_residual, 0);
    assertEquals(invoiceStatus(before.state, before.amount_residual).status, 'Unpaid', 'the saved PMO snapshot has not been replaced by the receipt command');
    const nextRead = await readInvoice(oneGo);
    assertEquals(invoiceStatus(nextRead.state, nextRead.amount_residual).status, 'Paid');
    assertEquals((await paymentsOf(oneGo)).length, 1);

    // Two separate receipt records settle in two writes; a new receipt's facts are resolved against the current residual.
    const split = await invoice(111_000, 'split');
    const firstPart = makeReceiptRig(split, 40_000);
    await firstPart.adapter.commit(firstPart.command);
    assertEquals((await readInvoice(split)).amount_residual, 71_000);
    const finalPart = makeReceiptRig(split, 71_000);
    await finalPart.adapter.commit(finalPart.command);
    assertEquals([(await readInvoice(split)).amount_residual, (await paymentsOf(split)).length], [0, 2]);

    // Odoo accepts an over-receipt, so the adapter must leave Odoo untouched.
    const over = await invoice(111_000, 'overpay');
    const overReceipt = makeReceiptRig(over, 112_000);
    const beforeOver = await paymentsOf(over);
    await assertRejects(() => overReceipt.adapter.commit(overReceipt.command), Error, 'over-receipt');
    assertEquals([(await paymentsOf(over)).length, (await readInvoice(over)).amount_residual], [beforeOver.length, 111_000]);

    // The client pays 109,000 and withholds 2,000; the difference is a debit to the chart's tax-prepaid asset.
    const withheldInvoice = await invoice(111_000, 'withheld');
    const withheldReceipt = makeReceiptRig(withheldInvoice, 111_000, { cash: 109_000, withheld: 2_000, slip: `${stamp}-SLIP` });
    const withheldResult = await withheldReceipt.adapter.commit(withheldReceipt.command);
    assertEquals((await readInvoice(withheldInvoice)).amount_residual, 0);
    assertEquals({ amount: withheldResult.canonical.amount, received: withheldResult.canonical.received_amount, withheld: withheldResult.canonical.withheld_amount, slip: withheldResult.canonical.withholding_slip_number, actor: withheldResult.canonical.recorded_by_id },
      { amount: 111_000, received: 109_000, withheld: 2_000, slip: `${stamp}-SLIP`, actor: 'bed-finance-user' });
    const paymentId = Number(withheldResult.externalRecordId.split(':')[1]);
    const [withheldPayment] = await call<Array<{ move_id: [number, string] }>>('account.payment', 'read', { ids: [paymentId], fields: ['move_id'] });
    assert(withheldPayment?.move_id, 'the posted receipt has its accounting move');
    const writeOff = await call<Array<{ account_id: [number, string]; balance: number }>>('account.move.line', 'search_read', {
      domain: [['move_id', '=', withheldPayment.move_id[0]], ['account_id', '=', taxPrepaid.id]], fields: ['account_id', 'balance'],
    });
    assert(writeOff.some((line) => line.account_id[0] === taxPrepaid.id && Math.abs(line.balance) === 2_000), 'the withheld amount is booked to the chosen tax-prepaid asset');

    // A response lost after reconciliation is the same intent on retry: recover its posted receipt and do not create another.
    const lostInvoice = await invoice(111_000, 'lost-response');
    const lost = makeReceiptRig(lostInvoice, 111_000, { failAt: { model: 'account.move.line', method: 'reconcile' } });
    await assertRejects(() => lost.adapter.commit(lost.command), Error);
    const { result: recovered } = await lost.observed();
    assertEquals(recovered?.externalRecordId.startsWith('account.payment:'), true);
    assertEquals([(await paymentsOf(lostInvoice)).length, (await readInvoice(lostInvoice)).amount_residual], [1, 0]);

    // A memo edit remains adoptable only when the immutable conjunction is unique and the payment is already linked to this invoice (FR-OCI-052).
    const editedInvoice = await invoice(111_000, 'edited-unique');
    const edited = makeReceiptRig(editedInvoice, 40_000, { failAt: { model: 'account.move.line', method: 'reconcile' } });
    await assertRejects(() => edited.adapter.commit(edited.command), Error);
    const [linked] = await call<Array<{ id: number; reconciled_invoice_ids: number[] }>>('account.payment', 'search_read', {
      domain: [['partner_id', '=', customer], ['reconciled_invoice_ids', 'in', [editedInvoice]], ['amount', '=', 40_000], ['date', '=', date]], fields: ['id', 'reconciled_invoice_ids'], order: 'id desc', limit: 1,
    });
    assert(linked, 'the committed receipt is already reconciled to the invoice though its reconcile response was lost');
    const anchor = receiptExternalIdentifier(`ip:${edited.id}`);
    const [anchorRow] = await call<Array<{ id: number }>>('ir.model.data', 'search_read', {
      domain: [['module', '=', anchor.module], ['name', '=', anchor.name], ['model', '=', 'account.payment'], ['res_id', '=', linked.id]], fields: ['id'], limit: 1,
    });
    assert(anchorRow, 'the payment has its PMO external identifier before the operator edits it');
    await call('ir.model.data', 'write', { ids: [anchorRow.id], vals: { name: `${stamp}-renamed-external-id` } });
    await call('account.payment', 'write', { ids: [linked.id], vals: { memo: `${stamp}-memo-edited` } });
    const { result: adopted } = await edited.observed();
    assertEquals(adopted?.externalRecordId, odooExternalRef('account.payment', linked.id));
    assertEquals([(await paymentsOf(editedInvoice)).length, (await readInvoice(editedInvoice)).amount_residual], [1, 71_000]);

    // An Odoo user edits both mutable traces on a posted-but-unreconciled payment. With no invoice link left to prove ownership,
    // the changed primary identifier and memo are not enough to recover it.
    const renamedAnchorInvoice = await invoice(111_000, 'renamed-anchor-held');
    const renamedAnchor = makeReceiptRig(renamedAnchorInvoice, 111_000, { failAt: { model: 'account.payment', method: 'action_post' } });
    await assertRejects(() => renamedAnchor.adapter.commit(renamedAnchor.command), Error);
    const [postedWithoutLink] = await call<Array<{ id: number }>>('account.payment', 'search_read', {
      domain: [['partner_id', '=', customer], ['amount', '=', 111_000], ['date', '=', date], ['state', '=', 'paid']], fields: ['id'], order: 'id desc', limit: 1,
    });
    assert(postedWithoutLink, 'the posted receipt remains after its response is lost');
    const originalAnchor = receiptExternalIdentifier(`ip:${renamedAnchor.id}`);
    const [originalAnchorRow] = await call<Array<{ id: number }>>('ir.model.data', 'search_read', {
      domain: [['module', '=', originalAnchor.module], ['name', '=', originalAnchor.name], ['model', '=', 'account.payment'], ['res_id', '=', postedWithoutLink.id]], fields: ['id'], limit: 1,
    });
    assert(originalAnchorRow, 'the primary identifier was written before the post response was lost');
    await call('ir.model.data', 'write', { ids: [originalAnchorRow.id], vals: { name: `${stamp}-external-id-edited` } });
    await call('account.payment', 'write', { ids: [postedWithoutLink.id], vals: { memo: `${stamp}-memo-edited` } });
    const renamedWindow = renamedAnchor.recoveryWindow();
    await assertRejects(() => recoverReceipt(renamedAnchor.call, renamedAnchor.command.record, renamedWindow, renamedAnchor.input), Error, 'ambiguous-anchor');
    assertEquals([(await paymentsOf(renamedAnchorInvoice)).length, (await readInvoice(renamedAnchorInvoice)).amount_residual], [0, 111_000]);

    // If the mutable memo is gone and two rows satisfy the conjunction, recovery is held rather than guessing or creating a third.
    const heldInvoice = await invoice(111_000, 'edited-ambiguous');
    const settledFirst = makeReceiptRig(heldInvoice, 40_000);
    await settledFirst.adapter.commit(settledFirst.command);
    const held = makeReceiptRig(heldInvoice, 40_000, { failAt: { model: 'account.payment', method: 'create' } });
    await assertRejects(() => held.adapter.commit(held.command), Error);
    const [secondUnanchored] = await call<Array<{ id: number }>>('account.payment', 'search_read', {
      domain: [['partner_id', '=', customer], ['amount', '=', 40_000], ['date', '=', date], ['state', '=', 'draft']], fields: ['id'], order: 'id desc', limit: 1,
    });
    assert(secondUnanchored, 'the pending receipt has no external identifier yet');
    await call('account.payment', 'write', { ids: [secondUnanchored.id], vals: { memo: `${stamp}-memo-edited-ambiguous` } });
    const beforeHeld = await paymentsOf(heldInvoice);
    const window = held.recoveryWindow();
    await assertRejects(() => recoverReceipt(held.call, held.command.record, window, held.input), Error, 'ambiguous-anchor');
    assertEquals([(await paymentsOf(heldInvoice)).length, (await readInvoice(heldInvoice)).amount_residual], [beforeHeld.length, 71_000]);
  },
});
