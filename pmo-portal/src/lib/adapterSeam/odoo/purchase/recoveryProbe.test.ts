import { describe, expect, it } from 'vitest';
import { bindCall } from '../client.ts';
import { createFakeOdoo } from '../fakeOdoo.ts';
import { anchorValue, externalIdentifier } from './anchors.ts';
import { probeOdooByAnchor, type OrderComposite, type PaymentComposite } from './recoveryProbe.ts';

const UUID = '123e4567-e89b-12d3-a456-426614174000';
const OTHER = '223e4567-e89b-12d3-a456-426614174000';
const WINDOW = '2026-11-03 10:00:00';
const COMPOSITE: PaymentComposite = { partnerId: 77, amount: '98.00', createdAfter: WINDOW };

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

describe('AC-OPP-053 the payment composite probe (the memo is editable)', () => {
  const key = `pay:${UUID}`;

  it('adopts the one payment with our vendor and amount inside the window when the memo was edited away', async () => {
    const { call, payment } = bed();
    payment({ id: 90, memo: 'edited by a clerk' });
    expect(await probeOdooByAnchor(call, 'payment', key, COMPOSITE)).toEqual({ externalRecordId: 'account.payment:90' });
  });

  it('holds (does not adopt) a payment whose memo was edited to carry extra text after our anchor', async () => {
    const { call, payment } = bed();
    payment({ id: 90, memo: `${anchorValue(key)} paid on Friday` });
    expect(await probeOdooByAnchor(call, 'payment', key, COMPOSITE)).toBeNull();
  });

  it('never adopts a payment that carries another PMO payment\'s anchor (wrong-document adoption)', async () => {
    const { call, payment } = bed();
    payment({ id: 90, memo: anchorValue(`pay:${OTHER}`) });
    expect(await probeOdooByAnchor(call, 'payment', key, COMPOSITE)).toBeNull();
  });

  it.each([
    ['another vendor', { partner_id: [78, 'Other'] }],
    ['another amount', { amount: 97 }],
    ['before the window', { create_date: '2026-11-03 09:00:00' }],
    ['a cancelled payment', { state: 'canceled' }],
    ['a customer receipt', { payment_type: 'inbound', partner_type: 'customer' }],
  ])('does not match %s', async (_label, over) => {
    const { call, payment } = bed();
    payment({ id: 90, memo: null, ...over });
    expect(await probeOdooByAnchor(call, 'payment', key, COMPOSITE)).toBeNull();
  });

  it('zero or several look-alikes are inconclusive (null), never an adoption', async () => {
    const { call, payment } = bed();
    expect(await probeOdooByAnchor(call, 'payment', key, COMPOSITE)).toBeNull();
    payment({ id: 90, memo: 'a' });
    payment({ id: 91, memo: 'b' });
    expect(await probeOdooByAnchor(call, 'payment', key, COMPOSITE)).toBeNull();
  });

  it('without composite inputs a missing anchor is simply null', async () => {
    const { call, payment } = bed();
    payment({ id: 90, memo: 'edited' });
    expect(await probeOdooByAnchor(call, 'payment', key)).toBeNull();
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
