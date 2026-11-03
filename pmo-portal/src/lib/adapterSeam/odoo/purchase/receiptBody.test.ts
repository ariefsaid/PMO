import { describe, expect, it } from 'vitest';
import { observeReceipt, planReceipt, receiptDigest, receivedStatus, type OrderLineQty } from './receiptBody.ts';

const LINES: OrderLineQty[] = [
  { id: 11, productId: 55, ordered: 10, received: 0 },
  { id: 12, productId: 56, ordered: 4, received: 1 },
];
const MAP = { Cable: '55', Bolt: '56' };

const refusal = async (p: Promise<unknown>) => p.then(() => null, (e: Error) => e.message);

describe('AC-OPP-031 a receipt names the quantity per line and is refused above the open quantity', () => {
  it('plans the entered quantity per line against what Odoo already received', async () => {
    const plan = await planReceipt(7, LINES, [{ itemRef: 'Cable', quantity: '6' }, { itemRef: 'Bolt', quantity: 3 }], MAP);
    expect(plan.orderId).toBe(7);
    expect(plan.lines).toEqual([
      { lineId: 11, productId: 55, base: 0, quantity: 6 },
      { lineId: 12, productId: 56, base: 1, quantity: 3 },
    ]);
  });

  it('a receipt with no entered lines receives every open quantity in full', async () => {
    const plan = await planReceipt(7, LINES, undefined, MAP);
    expect(plan.lines.map((l) => [l.lineId, l.quantity])).toEqual([[11, 10], [12, 3]]);
  });

  it('a line not named is carried at zero so the plan covers the whole order', async () => {
    const plan = await planReceipt(7, LINES, [{ itemRef: 'Cable', quantity: 6 }], MAP);
    expect(plan.lines.map((l) => [l.lineId, l.quantity])).toEqual([[11, 6], [12, 0]]);
  });

  it('refuses above the open quantity (11 of 10; 4 of 3 open) before anything is written', async () => {
    expect(await refusal(planReceipt(7, LINES, [{ itemRef: 'Cable', quantity: 11 }], MAP))).toBe('over-receipt: Cable');
    expect(await refusal(planReceipt(7, LINES, [{ itemRef: 'Bolt', quantity: 4 }], MAP))).toBe('over-receipt: Bolt');
  });

  it('refuses a fully received order, an empty list, a bad quantity, an unmapped, unknown or repeated item', async () => {
    expect(await refusal(planReceipt(7, [{ id: 1, productId: 55, ordered: 2, received: 2 }], undefined, MAP))).toBe('receipt-nothing-open');
    expect(await refusal(planReceipt(7, LINES, [], MAP))).toBe('receipt-empty');
    for (const quantity of [0, -1, 'x', Number.NaN]) expect(await refusal(planReceipt(7, LINES, [{ itemRef: 'Cable', quantity }], MAP))).toBe('receipt-quantity-invalid: Cable');
    expect(await refusal(planReceipt(7, LINES, [{ itemRef: 'Nail', quantity: 1 }], MAP))).toBe('item-unmapped: Nail');
    expect(await refusal(planReceipt(7, LINES, [{ itemRef: 'Cable', quantity: 1 }], { Cable: '99' }))).toBe('receipt-line-missing: Cable');
    expect(await refusal(planReceipt(7, LINES, [{ itemRef: 'Cable', quantity: 1 }, { itemRef: 'Cable', quantity: 1 }], MAP))).toBe('receipt-duplicate-item: Cable');
    const twin = [...LINES, { id: 13, productId: 55, ordered: 1, received: 0 }];
    expect(await refusal(planReceipt(7, twin, [{ itemRef: 'Cable', quantity: 1 }], MAP))).toBe('receipt-line-ambiguous: Cable');
  });

  it('decimal quantities are compared at four places, not as floats', async () => {
    const lines = [{ id: 1, productId: 55, ordered: 0.3, received: 0.1 }];
    const plan = await planReceipt(7, lines, [{ itemRef: 'Cable', quantity: '0.2' }], MAP);   // 0.3 - 0.1 is 0.19999999999999998 as a float
    expect(plan.lines[0]).toMatchObject({ base: 0.1, quantity: 0.2 });
  });
});

describe('PD-4 the receipt key carries the cumulative quantities', () => {
  it('the digest is hex, stable, and changes with any cumulative quantity', async () => {
    const a = await planReceipt(7, LINES, [{ itemRef: 'Cable', quantity: 6 }], MAP);
    const b = await planReceipt(7, LINES, [{ itemRef: 'Cable', quantity: 6 }], MAP);
    const c = await planReceipt(7, LINES, [{ itemRef: 'Cable', quantity: 5 }], MAP);
    expect(a.digest).toMatch(/^[a-f0-9]{32}$/);
    expect(a.digest).toBe(b.digest);
    expect(c.digest).not.toBe(a.digest);
    expect(await receiptDigest(a.lines)).toBe(a.digest);
  });
});

describe('FR-OPP-033 the order\'s received quantities decide whether this receipt already happened', () => {
  it('absent when every line is at its base, done when every line is at base plus the receipt, otherwise differs', async () => {
    const plan = await planReceipt(7, LINES, [{ itemRef: 'Cable', quantity: 6 }, { itemRef: 'Bolt', quantity: 3 }], MAP);
    const at = (a: number, b: number): OrderLineQty[] => [{ ...LINES[0], received: a }, { ...LINES[1], received: b }];
    expect(observeReceipt(plan, at(0, 1))).toBe('absent');
    expect(observeReceipt(plan, at(6, 4))).toBe('done');
    expect(observeReceipt(plan, at(6, 1))).toBe('differs');   // half-booked: doubt
    expect(observeReceipt(plan, at(7, 4))).toBe('differs');   // someone else received more
    expect(observeReceipt(plan, [LINES[0]])).toBe('differs');  // a planned line is gone
  });
});

describe('FR-OPP-034 the received status is read from Odoo\'s quantities', () => {
  it('Complete only when every line is received in full', () => {
    expect(receivedStatus([{ id: 1, productId: 1, ordered: 4, received: 4 }, { id: 2, productId: 2, ordered: 1, received: 1.5 }])).toBe('Complete');
    expect(receivedStatus([{ id: 1, productId: 1, ordered: 4, received: 4 }, { id: 2, productId: 2, ordered: 1, received: 0 }])).toBe('Partial');
  });
});
