import { describe, expect, it } from 'vitest';
import type { AdapterCommand } from '../contract.ts';
import { bindCall } from './client.ts';
import { createFakeOdoo } from './fakeOdoo.ts';
import { createOdooProcurementAdapter, recoverPayment, type PaymentFacts, type PaymentResolution } from './procurementAdapter.ts';
import type { PaymentComposite } from './purchase/recoveryProbe.ts';

const PAY_ID = 'dddddddd-dddd-4ddd-8ddd-000000001505';
const PAY_2 = 'dddddddd-dddd-4ddd-8ddd-000000001506';
const COMPANY_CURRENCY = 12;
const WINDOW: Pick<PaymentComposite, 'createdAfter' | 'createdBefore'> = { createdAfter: '2026-01-01 00:00:00', createdBefore: '2099-01-01 00:00:00' };

type Armed = { model: string; method: string; fault: 'transport' | 'lost-response' };

/** A posted bill of 98 for vendor 9 on a fake Odoo, a bank journal, and a way to fail the next matching call. */
async function rig({ billTotal = 98, currencyId = COMPANY_CURRENCY, billState = 'posted' } = {}) {
  const fake = createFakeOdoo({ key: 'k' });
  fake.seed('product.product', [{ id: 55, name: 'Cable tray', supplier_taxes_id: [] }]);
  fake.seed('account.journal', [{ id: 7, name: 'Bank', type: 'bank', outbound_payment_method_line_ids: [31], company_id: 1 }, { id: 8, name: 'Card', type: 'bank', outbound_payment_method_line_ids: [] }]);
  let armed: Armed | null = null;
  const fetchImpl = ((url: string, init?: RequestInit) => {
    const [model, method] = String(url).split('/').slice(-2);
    if (armed && armed.model === model && armed.method === method) { fake.failNext(armed.fault); armed = null; }
    return fake.fetch(url, init);
  }) as typeof fetch;
  const call = bindCall({ baseUrl: 'https://odoo.example.test', apiKey: 'k', database: 'db1', fetchImpl });
  const [billId] = await call<number[]>('account.move', 'create', { vals_list: [{ move_type: 'in_invoice', partner_id: 9, currency_id: currencyId, invoice_date: '2026-12-05', invoice_line_ids: [[0, 0, { product_id: 55, quantity: 1, price_unit: billTotal, tax_ids: [[6, 0, []]] }]] }] });
  if (billState === 'posted') await call('account.move', 'action_post', { ids: [billId] });
  fake.calls.length = 0;
  const bill = () => fake.rows('account.move').find((m) => m.id === billId)!;
  const facts = (over: Partial<PaymentFacts> = {}): PaymentFacts => ({ billRef: `account.move:${billId}`, amount: '98.00', date: '2026-12-10', vendorPartnerId: 9, journalId: 7, companyCurrencyId: COMPANY_CURRENCY, ...over });
  let current = facts();
  const adapter = createOdooProcurementAdapter({
    call, resolveOrder: async () => { throw new Error('unused'); }, resolveRevise: async () => { throw new Error('unused'); }, resolveBill: async () => { throw new Error('unused'); },
    resolvePayment: async () => current,
  });
  const command = (id = PAY_ID, over: Record<string, unknown> = {}): AdapterCommand => ({
    domain: 'procurement', operation: 'create', idempotencyKey: `k-${id}`,
    record: { id, erp_doc_kind: 'payment', procurementId: 'case-1', invoiceId: 'inv-1', paid_amount: String(current.amount), date: '2026-12-10', ...over },
  });
  /** What `dispatchMoneyWrite` does on every claim: the recovery probe first (the composite only in a recovery), the adapter only when it found nothing. */
  const attempt = async (cmd = command(), recovery = false) =>
    (await recoverPayment(call, cmd.record, recovery ? { partnerId: 9, amount: current.amount, billId, ...WINDOW } : undefined, `account.move:${billId}`)) ?? adapter.commit(cmd);
  const count = (model: string, method: string) => fake.calls.filter((c) => c.model === model && c.method === method).length;
  const writes = () => fake.calls.filter((c) => ['create', 'write', 'action_post', 'reconcile', 'unlink'].includes(c.method));
  return {
    fake, call, adapter, attempt, command, count, writes, bill, billId,
    set: (over: Partial<PaymentFacts>) => { current = facts(over); },
    arm: (model: string, method: string, fault: Armed['fault']) => { armed = { model, method, fault }; },
  };
}

describe('AC-OPP-050 a payment is created, posted and reconciled to its bill once', () => {
  it('pays the whole bill: one posted payment from the chosen journal, reconciled, the bill residual 0, the canonical carries Odoo\'s figures', async () => {
    const r = await rig();
    const result = await r.attempt();
    const [payment] = r.fake.rows('account.payment');
    expect(r.fake.rows('account.payment')).toHaveLength(1);
    expect(payment).toMatchObject({ state: 'reconciled', payment_type: 'outbound', partner_type: 'supplier', partner_id: 9, journal_id: 7, payment_method_line_id: 31, amount: 98, memo: `pmo:pay:${PAY_ID}`, date: '2026-12-10' });
    expect(payment.reconciled_bill_ids).toEqual([r.billId]);
    expect(r.bill()).toMatchObject({ amount_residual: 0, payment_state: 'paid' });
    expect(result.externalRecordId).toBe(`account.payment:${payment.id}`);
    expect(result.canonical).toMatchObject({ id: PAY_ID, pay_number: payment.name, amount: '98.00', erp_docstatus: 1, erp_modified: payment.write_date, odoo_bill_residual: '0.00' });
    expect([r.count('account.payment', 'create'), r.count('account.payment', 'action_post'), r.count('account.move.line', 'reconcile')]).toEqual([1, 1, 1]);
  });

  it('pays in two parts, 40 then 58: two payments, the bill is partial and then settled', async () => {
    const r = await rig();
    r.set({ amount: '40.00' });
    const first = await r.attempt(r.command(PAY_ID));
    expect(first.canonical).toMatchObject({ amount: '40.00', odoo_bill_residual: '58.00' });
    expect(r.bill()).toMatchObject({ amount_residual: 58, payment_state: 'partial' });
    r.set({ amount: '58.00' });
    const second = await r.attempt(r.command(PAY_2));
    expect(second.canonical).toMatchObject({ id: PAY_2, amount: '58.00', odoo_bill_residual: '0.00' });
    expect(r.fake.rows('account.payment')).toHaveLength(2);
    expect(r.bill()).toMatchObject({ amount_residual: 0, payment_state: 'paid' });
  });

  it('an overpayment is refused BEFORE any write (Odoo would accept it); so is paying a bill that is already settled', async () => {
    const r = await rig();
    r.set({ amount: '99.00' });
    await expect(r.attempt()).rejects.toMatchObject({ code: 'commit-rejected', message: 'over-payment' });
    expect(r.writes()).toEqual([]);
    r.set({ amount: '98.00' });
    await r.attempt(r.command(PAY_ID));
    r.fake.calls.length = 0;
    await expect(r.attempt(r.command(PAY_2))).rejects.toMatchObject({ code: 'commit-rejected', message: 'over-payment' });
    expect(r.writes()).toEqual([]);
  });
});

describe('AC-OPP-051 what cannot be paid writes nothing', () => {
  it.each([
    ['no bill reference', { billRef: null }, 'payment-bill-required'],
    ['an unposted bill', {}, 'bill-not-posted', { billState: 'draft' }],
    ['a bill in another currency', {}, 'currency-mismatch', { currencyId: 13 }],
    ['an amount of zero', { amount: '0' }, 'amount-invalid'],
    ['a vendor other than the bill\'s', { vendorPartnerId: 10 }, 'vendor-mismatch'],
    ['no journal chosen', { journalId: null }, 'journal-missing'],
    ['a journal with no outbound method', { journalId: 8 }, 'journal-no-outbound-method'],
  ] as Array<[string, Partial<PaymentFacts>, string, Record<string, unknown>?]>)('%s', async (_label, over, message, bed = {}) => {
    const r = await rig(bed);
    r.set(over);
    await expect(r.adapter.commit(r.command())).rejects.toMatchObject({ code: 'commit-rejected', message });
    expect(r.writes()).toEqual([]);
  });
});

describe('AC-OPP-052 an interrupted payment ends with one posted, reconciled payment and no second create', () => {
  const settled = (r: Awaited<ReturnType<typeof rig>>) => {
    expect(r.fake.rows('account.payment')).toHaveLength(1);
    expect(r.fake.rows('account.payment')[0]).toMatchObject({ state: 'reconciled', reconciled_bill_ids: [r.billId] });
    expect(r.bill()).toMatchObject({ amount_residual: 0, payment_state: 'paid' });
    expect(r.count('account.payment', 'create')).toBe(1);
  };

  it.each([
    ['a lost response on the create', 'account.payment', 'create', 'lost-response', 1],
    ['a failure on the post (nothing posted)', 'account.payment', 'action_post', 'transport', 2],
    ['a lost response on the post', 'account.payment', 'action_post', 'lost-response', 1],
    ['a failure on the reconcile (nothing reconciled)', 'account.move.line', 'reconcile', 'transport', 2],
    ['a lost response on the reconcile', 'account.move.line', 'reconcile', 'lost-response', 1],
  ] as const)('%s: the retry finds the payment by its memo and completes it', async (_label, model, method, fault, calls) => {
    const r = await rig();
    r.arm(model, method, fault);
    await expect(r.attempt()).rejects.toMatchObject({ code: 'external-unreachable' });
    const result = await r.attempt();
    settled(r);
    expect(r.count(model, method)).toBe(method === 'create' ? 1 : calls);
    expect(result.canonical).toMatchObject({ id: PAY_ID, amount: '98.00', erp_docstatus: 1, odoo_bill_residual: '0.00' });
  });

  it('AC-OPP-062 a foreign owner holds a draft payment before recovery posts or reconciles it', async () => {
    const r = await rig();
    r.arm('account.payment', 'action_post', 'transport');
    await expect(r.attempt()).rejects.toMatchObject({ code: 'external-unreachable' });
    const writes = r.writes().length;

    await expect(Reflect.apply(recoverPayment, null, [
      r.call, r.command().record, undefined, `account.move:${r.billId}`, undefined, async () => true,
    ])).rejects.toMatchObject({ code: 'command-held' });

    expect(r.writes()).toHaveLength(writes);
  });

  it('idempotency: the same command twice is one payment, one create, one post, one reconcile', async () => {
    const r = await rig();
    const first = await r.attempt();
    const second = await r.attempt();
    settled(r);
    expect([r.count('account.payment', 'action_post'), r.count('account.move.line', 'reconcile')]).toEqual([1, 1]);
    expect(second.externalRecordId).toBe(first.externalRecordId);
    expect(second.canonical).toEqual(first.canonical);
  });

  it('one payment per command: the adapter itself, committed twice with no probe before it, finds its payment by the memo and creates nothing more', async () => {
    const r = await rig();
    const first = await r.adapter.commit(r.command());
    const second = await r.adapter.commit(r.command());   // the bill is settled now: an overpayment check would refuse a naive second create
    settled(r);
    expect(second).toEqual(first);
    expect([r.count('account.payment', 'action_post'), r.count('account.move.line', 'reconcile')]).toEqual([1, 1]);
  });

  it('a retry after the bill was settled elsewhere is not refused as an overpayment: the payment it made is found first', async () => {
    const r = await rig();
    r.arm('account.move.line', 'reconcile', 'lost-response');
    await expect(r.attempt()).rejects.toMatchObject({ code: 'external-unreachable' });
    expect(r.bill().amount_residual).toBe(0);
    await expect(r.attempt()).resolves.toMatchObject({ canonical: { odoo_bill_residual: '0.00' } });
  });

  it('a found payment that is cancelled, or for another amount, is refused: nothing is created, posted or reconciled', async () => {
    const r = await rig();
    await r.attempt();
    r.fake.calls.length = 0;
    r.fake.rows('account.payment')[0].state = 'canceled';
    await expect(r.attempt()).rejects.toMatchObject({ code: 'commit-rejected', message: 'payment-canceled' });
    r.fake.rows('account.payment')[0].state = 'paid';
    r.fake.rows('account.payment')[0].amount = 97;
    await expect(r.attempt()).rejects.toMatchObject({ code: 'commit-rejected', message: 'payment-amount-differs' });
    expect(r.writes()).toEqual([]);
  });
});

describe('AC-OPP-053 the memo is editable: the recovery composite adopts only a unique conjunction and holds on any doubt', () => {
  const edit = (r: Awaited<ReturnType<typeof rig>>, memo: string) => { r.fake.rows('account.payment')[0].memo = memo; };

  it('a clerk edits the memo of the payment we made: the retry (a recovery) adopts it by vendor, amount, window and bill, and creates nothing', async () => {
    const r = await rig();
    r.arm('account.move.line', 'reconcile', 'lost-response');
    await expect(r.attempt()).rejects.toMatchObject({ code: 'external-unreachable' });
    edit(r, 'paid by transfer');
    const result = await r.attempt(r.command(), true);
    expect(r.fake.rows('account.payment')).toHaveLength(1);
    expect(r.count('account.payment', 'create')).toBe(1);
    expect(result.externalRecordId).toBe(`account.payment:${r.fake.rows('account.payment')[0].id}`);
  });

  it('the same edit when the payment was posted but never reconciled: held, not adopted and not completed (nothing says it is ours)', async () => {
    const r = await rig();
    r.arm('account.move.line', 'reconcile', 'transport');
    await expect(r.attempt()).rejects.toMatchObject({ code: 'external-unreachable' });
    edit(r, 'paid by transfer');
    await expect(r.attempt(r.command(), true)).rejects.toMatchObject({ code: 'commit-rejected', message: 'ambiguous-anchor' });
    expect(r.count('account.payment', 'create')).toBe(1);
    expect(r.count('account.move.line', 'reconcile')).toBe(1);
  });

  it('two look-alikes in the window: held', async () => {
    const r = await rig();
    await r.attempt();
    edit(r, 'edited');
    r.fake.seed('account.payment', [{ payment_type: 'outbound', partner_type: 'supplier', state: 'paid', partner_id: 9, amount: 98, memo: 'another', reconciled_bill_ids: [r.billId], create_date: '2026-06-01 00:00:00' }]);
    await expect(r.attempt(r.command(), true)).rejects.toMatchObject({ code: 'commit-rejected', message: 'ambiguous-anchor' });
    expect(r.count('account.payment', 'create')).toBe(1);
  });

  it('nothing found (the anchor and every look-alike absent): the recovery returns null and the caller holds it, so the adapter is not the one deciding to create after doubt', async () => {
    const r = await rig();
    expect(await recoverPayment(r.call, r.command().record, { partnerId: 9, amount: '98.00', billId: r.billId, ...WINDOW }, `account.move:${r.billId}`)).toBeNull();
    expect(r.writes()).toEqual([]);
  });
});

describe('AC-OPP-064 an operator resolves a held payment: adopt the named payment, or confirm none exists', () => {
  const edit = (r: Awaited<ReturnType<typeof rig>>, memo: string) => { r.fake.rows('account.payment')[0].memo = memo; };
  const probe = (r: Awaited<ReturnType<typeof rig>>, resolution: PaymentResolution | undefined, composite = true) =>
    recoverPayment(r.call, r.command().record, composite ? { partnerId: 9, amount: '98.00', billId: r.billId, ...WINDOW } : undefined, `account.move:${r.billId}`, resolution);

  it('adopt: the named payment, reconciled to this bill, becomes the command\'s result and nothing is created', async () => {
    const r = await rig();
    r.arm('account.move.line', 'reconcile', 'lost-response');
    await expect(r.attempt()).rejects.toMatchObject({ code: 'external-unreachable' });
    edit(r, 'paid by transfer');
    r.fake.seed('account.payment', [{ payment_type: 'outbound', partner_type: 'supplier', state: 'paid', partner_id: 9, amount: 98, memo: 'look-alike', reconciled_bill_ids: [r.billId], create_date: '2026-06-01 00:00:00' }]);   // would make the composite ambiguous
    const named = r.fake.rows('account.payment')[0].id;
    const result = await probe(r, { adoptedRef: `account.payment:${named}` });
    expect(result?.externalRecordId).toBe(`account.payment:${named}`);
    expect(r.count('account.payment', 'create')).toBe(1);
  });

  it('adopt: a named payment Odoo does not show reconciled to this bill is refused; the composite is not consulted', async () => {
    const r = await rig();
    r.fake.seed('account.payment', [{ payment_type: 'outbound', partner_type: 'supplier', state: 'paid', partner_id: 9, amount: 98, memo: 'other', reconciled_bill_ids: [], create_date: '2026-06-01 00:00:00' }]);
    const named = r.fake.rows('account.payment')[0].id;
    await expect(probe(r, { adoptedRef: `account.payment:${named}` })).rejects.toMatchObject({ code: 'commit-rejected', message: 'adopted-payment-not-reconciled' });
    expect(r.writes()).toEqual([]);
  });

  it('absent: only our exact memo is looked for, so a look-alike is not adopted and the caller may now create', async () => {
    const r = await rig();
    r.fake.seed('account.payment', [{ payment_type: 'outbound', partner_type: 'supplier', state: 'paid', partner_id: 9, amount: 98, memo: 'someone else', reconciled_bill_ids: [r.billId], create_date: '2026-06-01 00:00:00' }]);
    expect(await probe(r, { absentConfirmed: true })).toBeNull();
    expect(r.writes()).toEqual([]);
    expect((await probe(r, undefined))?.externalRecordId).toBe(`account.payment:${r.fake.rows('account.payment')[0].id}`);   // without the confirmation the same look-alike is a unique candidate
  });
});
