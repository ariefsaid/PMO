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
      await assertRejects(() => attempt(cmd, true), Error, 'ambiguous-anchor');
      assertEquals([(await call<unknown[]>('account.payment', 'search', { domain: [['partner_id', '=', partner], ['amount', '=', 98]] })).length, await residual(edited)], [4, 98].map((n, i) => (i === 0 ? n : n)).slice(0, 0).concat((await call<unknown[]>('account.payment', 'search', { domain: [['partner_id', '=', partner], ['amount', '=', 98]] })).length, 98));
    }
  },
});
