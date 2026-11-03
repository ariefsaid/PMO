import { describe, expect, it } from 'vitest';
import { bindCall } from '../client.ts';
import { createFakeOdoo } from '../fakeOdoo.ts';
import { anchorValue, externalIdentifier } from './anchors.ts';
import { probeOdooByAnchor, type BillComposite, type OrderComposite, type PaymentComposite } from './recoveryProbe.ts';

const UUID = '123e4567-e89b-12d3-a456-426614174000';
const OTHER = '223e4567-e89b-12d3-a456-426614174000';
const WINDOW = '2026-11-03 10:00:00';
const BILL = 301;
const COMPOSITE: PaymentComposite = { partnerId: 77, amount: '98.00', createdAfter: WINDOW, createdBefore: '2026-11-03 10:30:00', billId: BILL };

function bed() {
  const fake = createFakeOdoo({ key: 'k' });
  const call = bindCall({ baseUrl: 'https://odoo.example.test', apiKey: 'k', database: 'db1', fetchImpl: fake.fetch });
  const identifier = (key: string, model: string, resId: number) =>
    fake.seed('ir.model.data', [{ module: externalIdentifier(key).module, name: externalIdentifier(key).name, model, res_id: resId }]);
  const payment = (row: Record<string, unknown>) =>
    fake.seed('account.payment', [{ payment_type: 'outbound', partner_type: 'supplier', state: 'paid', partner_id: [77, 'Vendor'], amount: 98, create_date: '2026-11-03 10:05:00', ...row }]);
  return { fake, call, identifier, payment };
}

describe('AC-OPP-053 the recovery probe finds a document by its anchor, and never by a look-alike', () => {
  it.each([
    ['order', `po:${UUID}`, 'purchase.order'],
    ['receipt', `gr:${UUID}:ab12`, 'stock.picking'],
    ['bill', `bill:${UUID}`, 'account.move'],
  ] as const)('a %s is adopted through its external identifier', async (kind, key, model) => {
    const { call, identifier } = bed();
    identifier(key, model, 41);
    expect(await probeOdooByAnchor(call, kind, key)).toEqual({ externalRecordId: `${model}:41` });
  });

  it('zero matches is null (the caller decides whether that is conclusive)', async () => {
    const { call, identifier } = bed();
    identifier(`po:${OTHER}`, 'purchase.order', 5);
    expect(await probeOdooByAnchor(call, 'order', `po:${UUID}`)).toBeNull();
  });

  it('an identifier of another model is not this document', async () => {
    const { call, identifier } = bed();
    identifier(`po:${UUID}`, 'account.move', 9);
    expect(await probeOdooByAnchor(call, 'order', `po:${UUID}`)).toBeNull();
  });

  it('a key that is not a PMO purchase key is refused before any Odoo call (no LIKE metacharacter can reach a query)', async () => {
    const { call, fake } = bed();
    for (const key of ['po:%', 'po:_', `po:${UUID}%`, `po:${UUID.slice(0, 35)}_`, 'x', '']) {
      await expect(probeOdooByAnchor(call, 'order', key)).rejects.toThrow();
    }
    expect(fake.calls).toEqual([]);
  });

  it('a payment is adopted by its exact memo', async () => {
    const { call, payment } = bed();
    payment({ id: 90, memo: anchorValue(`pay:${UUID}`) });
    expect(await probeOdooByAnchor(call, 'payment', `pay:${UUID}`, COMPOSITE)).toEqual({ externalRecordId: 'account.payment:90' });
  });

  it('two documents with the exact anchor are ambiguous: the probe throws rather than choose', async () => {
    const { call, payment } = bed();
    payment({ id: 90, memo: anchorValue(`pay:${UUID}`) });
    payment({ id: 91, memo: anchorValue(`pay:${UUID}`) });
    await expect(probeOdooByAnchor(call, 'payment', `pay:${UUID}`, COMPOSITE)).rejects.toThrow(/ambiguous/);
  });
});

describe('AC-OPP-053 the payment composite probe (the memo is editable; recovery only; doubt holds)', () => {
  const key = `pay:${UUID}`;
  const reconciledToBill = { reconciled_bill_ids: [BILL] };

  it('adopts the ONE payment with our vendor and amount in the window that Odoo shows reconciled to THIS bill when the memo was edited away', async () => {
    const { call, payment } = bed();
    payment({ id: 90, memo: 'edited by a clerk', ...reconciledToBill });
    expect(await probeOdooByAnchor(call, 'payment', key, COMPOSITE)).toEqual({ externalRecordId: 'account.payment:90' });
  });

  it.each([
    ['not reconciled to any bill (created, or posted and not yet reconciled)', { reconciled_bill_ids: [] }],
    ['reconciled to another bill', { reconciled_bill_ids: [BILL + 1] }],
    ['carrying our anchor with extra text after it', { memo: `${anchorValue(key)} paid on Friday`, ...reconciledToBill }],
  ])('HOLDS (throws, never adopts, never null) on a look-alike %s', async (_label, over) => {
    const { call, payment } = bed();
    payment({ id: 90, memo: 'edited by a clerk', ...over });
    await expect(probeOdooByAnchor(call, 'payment', key, COMPOSITE)).rejects.toThrow(/ambiguous/);
  });

  it('HOLDS on two look-alikes, even when both are reconciled to the bill', async () => {
    const { call, payment } = bed();
    payment({ id: 90, memo: 'a', ...reconciledToBill });
    payment({ id: 91, memo: 'b', ...reconciledToBill });
    await expect(probeOdooByAnchor(call, 'payment', key, COMPOSITE)).rejects.toThrow(/ambiguous/);
  });

  it('holds on a look-alike when the composite names no bill: nothing can then say it is ours', async () => {
    const { call, payment } = bed();
    payment({ id: 90, memo: 'edited', ...reconciledToBill });
    await expect(probeOdooByAnchor(call, 'payment', key, { ...COMPOSITE, billId: undefined })).rejects.toThrow(/ambiguous/);
  });

  it('never adopts a payment that carries another PMO payment\'s anchor (wrong-document adoption): it is not a candidate at all', async () => {
    const { call, payment } = bed();
    payment({ id: 90, memo: anchorValue(`pay:${OTHER}`), ...reconciledToBill });
    expect(await probeOdooByAnchor(call, 'payment', key, COMPOSITE)).toBeNull();
  });

  it.each([
    ['another vendor', { partner_id: [78, 'Other'] }],
    ['another amount', { amount: 97 }],
    ['before the window', { create_date: '2026-11-03 09:00:00' }],
    ['after the window', { create_date: '2026-11-03 11:00:00' }],
    ['a cancelled payment', { state: 'canceled' }],
    ['a customer receipt', { payment_type: 'inbound', partner_type: 'customer' }],
  ])('does not match %s', async (_label, over) => {
    const { call, payment } = bed();
    payment({ id: 90, memo: null, ...reconciledToBill, ...over });
    expect(await probeOdooByAnchor(call, 'payment', key, COMPOSITE)).toBeNull();
  });

  it('nothing in the window is plain absence (null): the caller holds it, a payment is never reissued on doubt', async () => {
    const { call } = bed();
    expect(await probeOdooByAnchor(call, 'payment', key, COMPOSITE)).toBeNull();
  });

  it('without composite inputs (a first attempt) a missing anchor is simply null: no look-alike is consulted', async () => {
    const { call, payment, fake } = bed();
    payment({ id: 90, memo: 'edited', ...reconciledToBill });
    fake.calls.length = 0;
    expect(await probeOdooByAnchor(call, 'payment', key)).toBeNull();
    expect(fake.calls).toHaveLength(1);   // the exact-memo lookup only
  });
});

describe('AC-OPP-011 the order composite probe (the create-to-anchor gap, DD-OPP-4 amendment)', () => {
  const key = `po:${UUID}`;
  const ORDER: OrderComposite = { partnerId: 77, amount: '25.00', lineCount: 2, createdAfter: WINDOW };
  const order = (fake: ReturnType<typeof bed>['fake'], row: Record<string, unknown>) =>
    fake.seed('purchase.order', [{ state: 'draft', partner_id: [77, 'Vendor'], amount_untaxed: 25, order_line: [1, 2], create_date: '2026-11-03 10:05:00', ...row }]);

  it('adopts the one unanchored order with our vendor, amount and line count inside the window', async () => {
    const { call, fake } = bed();
    order(fake, { id: 40 });
    expect(await probeOdooByAnchor(call, 'order', key, ORDER)).toEqual({ externalRecordId: 'purchase.order:40' });
  });

  it('the exact identifier wins over any look-alike', async () => {
    const { call, fake, identifier } = bed();
    order(fake, { id: 40 });
    order(fake, { id: 41 });
    identifier(key, 'purchase.order', 41);
    expect(await probeOdooByAnchor(call, 'order', key, ORDER)).toEqual({ externalRecordId: 'purchase.order:41' });
  });

  it('never adopts an order that already carries a PMO identifier (another PMO document)', async () => {
    const { call, fake, identifier } = bed();
    order(fake, { id: 40 });
    identifier(`po:${OTHER}`, 'purchase.order', 40);
    expect(await probeOdooByAnchor(call, 'order', key, ORDER)).toBeNull();
  });

  it.each([
    ['another vendor', { partner_id: [78, 'Other'] }],
    ['before the window', { create_date: '2026-11-03 09:00:00' }],
    ['a cancelled order', { state: 'cancel' }],
  ])('does not match %s: conclusive absence is null', async (_label, over) => {
    const { call, fake } = bed();
    order(fake, { id: 40, ...over });
    expect(await probeOdooByAnchor(call, 'order', key, ORDER)).toBeNull();
  });

  // I1: a look-alike that misses the exact figure (float tie, unit precision, tax-included price, an edit in Odoo) is NOT proof of
  // absence; it may be our own order. Any unanchored vendor order in the window that is not the one exact match holds the row.
  it.each([
    ['a 0.01 difference in the untaxed amount', { amount_untaxed: 25.01 }],
    ['another amount', { amount_untaxed: 24 }],
    ['another line count', { order_line: [1] }],
  ])('I1 an unanchored order of our vendor in the window with %s is doubt: held, never absence', async (_label, over) => {
    const { call, fake } = bed();
    order(fake, { id: 40, ...over });
    await expect(probeOdooByAnchor(call, 'order', key, ORDER)).rejects.toThrow(/ambiguous/);
  });

  it('I1 an exact match beside a near-miss is still doubt (two unanchored orders)', async () => {
    const { call, fake } = bed();
    order(fake, { id: 40 });
    order(fake, { id: 41, amount_untaxed: 25.01 });
    await expect(probeOdooByAnchor(call, 'order', key, ORDER)).rejects.toThrow(/ambiguous/);
  });

  it('I1 a near-miss that already carries a PMO identifier is another document: absence stays null', async () => {
    const { call, fake, identifier } = bed();
    order(fake, { id: 40, amount_untaxed: 99 });
    identifier(`po:${OTHER}`, 'purchase.order', 40);
    expect(await probeOdooByAnchor(call, 'order', key, ORDER)).toBeNull();
  });

  it('two look-alikes are doubt: the probe throws (the order is held), it neither adopts nor reports absence', async () => {
    const { call, fake } = bed();
    order(fake, { id: 40 });
    order(fake, { id: 41 });
    await expect(probeOdooByAnchor(call, 'order', key, ORDER)).rejects.toThrow(/ambiguous/);
  });

  it('without composite inputs a missing identifier is simply null', async () => {
    const { call, fake } = bed();
    order(fake, { id: 40 });
    expect(await probeOdooByAnchor(call, 'order', key)).toBeNull();
  });
});

describe('AC-OPP-041 the bill composite probe (the create-to-anchor gap; a bill is held on doubt, never reissued)', () => {
  const key = `bill:${UUID}`;
  const BILL: BillComposite = { partnerId: 77, amount: '100.00', lineCount: 2, createdAfter: WINDOW };
  const bill = (fake: ReturnType<typeof bed>['fake'], row: Record<string, unknown>) =>
    fake.seed('account.move', [{ move_type: 'in_invoice', state: 'draft', partner_id: [77, 'Vendor'], amount_untaxed: 100, invoice_line_ids: [1, 2], create_date: '2026-11-03 10:05:00', ...row }]);

  it('I1 (#1505 P5 review) a look-alike with our vendor, untaxed amount and line count is NEVER adopted: it may be a clerk\'s own bill, so the probe throws (held)', async () => {
    const { call, fake } = bed();
    bill(fake, { id: 50 });
    await expect(probeOdooByAnchor(call, 'bill', key, BILL)).rejects.toThrow(/ambiguous/);
  });

  it('I1 a bill created after the window closes cannot be ours: the window is bounded above, absence stays null', async () => {
    const { call, fake } = bed();
    bill(fake, { id: 50, create_date: '2026-11-03 10:20:00' });
    expect(await probeOdooByAnchor(call, 'bill', key, { ...BILL, createdBefore: '2026-11-03 10:10:00' })).toBeNull();
    bill(fake, { id: 51, create_date: '2026-11-03 10:06:00' });
    await expect(probeOdooByAnchor(call, 'bill', key, { ...BILL, createdBefore: '2026-11-03 10:10:00' })).rejects.toThrow(/ambiguous/);
  });

  it('the exact identifier wins over any look-alike', async () => {
    const { call, fake, identifier } = bed();
    bill(fake, { id: 50 });
    bill(fake, { id: 51 });
    identifier(key, 'account.move', 51);
    expect(await probeOdooByAnchor(call, 'bill', key, BILL)).toEqual({ externalRecordId: 'account.move:51' });
  });

  it('never adopts a bill that already carries a PMO identifier (another PMO bill)', async () => {
    const { call, fake, identifier } = bed();
    bill(fake, { id: 50 });
    identifier(`bill:${OTHER}`, 'account.move', 50);
    expect(await probeOdooByAnchor(call, 'bill', key, BILL)).toBeNull();
  });

  it.each([
    ['another vendor', { partner_id: [78, 'Other'] }],
    ['before the window', { create_date: '2026-11-03 09:00:00' }],
    ['a cancelled bill', { state: 'cancel' }],
    ['a customer invoice', { move_type: 'out_invoice' }],
    ['a vendor credit note', { move_type: 'in_refund' }],
  ])('does not match %s: conclusive absence is null', async (_label, over) => {
    const { call, fake } = bed();
    bill(fake, { id: 50, ...over });
    expect(await probeOdooByAnchor(call, 'bill', key, BILL)).toBeNull();
  });

  it.each([
    ['a 0.01 difference in the untaxed amount', { amount_untaxed: 100.01 }],
    ['another line count', { invoice_line_ids: [1] }],
  ])('an unanchored bill of our vendor in the window with %s is doubt: held, never absence', async (_label, over) => {
    const { call, fake } = bed();
    bill(fake, { id: 50, ...over });
    await expect(probeOdooByAnchor(call, 'bill', key, BILL)).rejects.toThrow(/ambiguous/);
  });

  it('two look-alikes are doubt: the probe throws, it neither adopts nor reports absence', async () => {
    const { call, fake } = bed();
    bill(fake, { id: 50 });
    bill(fake, { id: 51 });
    await expect(probeOdooByAnchor(call, 'bill', key, BILL)).rejects.toThrow(/ambiguous/);
  });

  it('without composite inputs a missing identifier is simply null', async () => {
    const { call, fake } = bed();
    bill(fake, { id: 50 });
    expect(await probeOdooByAnchor(call, 'bill', key)).toBeNull();
  });
});
