import { describe, expect, it } from 'vitest';
import type { OrderCtx } from './orderBody.ts';
import { planRevise, type CurrentLine, type ReviseLine } from './orderRevise.ts';

const CTX: OrderCtx = { companyId: 1, itemMap: { A: '55', B: '56', C: '57' }, unitMap: {}, costAccountId: '101', taxIds: [] };
const cur = (id: number, product: number, qty: number, price = 10, received = 0, invoiced = 0): CurrentLine => ({ id, product_id: [product, 'p'], product_qty: qty, price_unit: price, qty_received: received, qty_invoiced: invoiced });
const tgt = (itemRef: string, quantity: string, rate = '10.00'): ReviseLine => ({ itemRef, quantity, rate, unit: '' });
const plan = (state: string, current: CurrentLine[], target: ReviseLine[]) => {
  try { return planRevise({ state }, current, target, CTX, '2026-12-01 00:00:00'); } catch (e) { return e as Error; }
};

describe('AC-OPP-016 revising a confirmed order edits it in place', () => {
  it('raises one line, lowers another above what was received, and adds a new one (with the project distribution)', () => {
    const result = plan('purchase', [cur(1, 55, 10), cur(2, 56, 8, 10, 4)], [tgt('A', '12.000'), tgt('B', '6.000', '11.00'), tgt('C', '1.000')]);
    expect(result).toEqual({ commands: [
      [1, 1, { product_qty: 12 }],
      [1, 2, { product_qty: 6, price_unit: 11 }],
      [0, 0, expect.objectContaining({ product_id: 57, product_qty: 1, price_unit: 10, analytic_distribution: { '101': 100 } })],
    ] });
  });

  it('a revision that changes nothing yields no command (a replay is a no-op)', () => {
    expect(plan('purchase', [cur(1, 55, 12)], [tgt('A', '12.000')])).toEqual({ commands: [] });
  });

  it('refuses a quantity below what was received, naming the item, and below what was billed', () => {
    expect(plan('purchase', [cur(2, 56, 8, 10, 4)], [tgt('B', '3.000')])).toMatchObject({ code: 'commit-rejected', message: 'below-received: B' });
    expect(plan('purchase', [cur(2, 56, 8, 10, 0, 5)], [tgt('B', '4.000')])).toMatchObject({ code: 'commit-rejected', message: 'below-received: B' });
  });

  it('a quantity equal to what was received is allowed', () => {
    expect(plan('purchase', [cur(2, 56, 8, 10, 4)], [tgt('B', '4.000')])).toEqual({ commands: [[1, 2, { product_qty: 4 }]] });
  });

  it('a line dropped from the revision is set to zero when untouched, refused when received or billed (Odoo cannot delete a confirmed line)', () => {
    expect(plan('purchase', [cur(1, 55, 10), cur(2, 56, 8)], [tgt('A', '10.000')])).toEqual({ commands: [[1, 2, { product_qty: 0 }]] });
    expect(plan('purchase', [cur(1, 55, 10), cur(2, 56, 8, 10, 4)], [tgt('A', '10.000')])).toMatchObject({ message: 'below-received: product 56' });
  });

  it.each([['cancel'], ['done'], ['draft'], ['to approve']])('refuses an order that is %s, with no command', (state) => {
    expect(plan(state, [cur(1, 55, 10)], [tgt('A', '12.000')])).toMatchObject({ code: 'commit-rejected', message: `order-${state}` });
  });

  it('refuses an unmapped item and the same item twice (ambiguous line)', () => {
    expect(plan('purchase', [cur(1, 55, 10)], [tgt('Z', '1.000')])).toMatchObject({ message: 'item-unmapped: Z' });
    expect(plan('purchase', [cur(1, 55, 10)], [tgt('A', '1.000'), tgt('A', '2.000')])).toMatchObject({ message: 'ambiguous-line: A' });
  });
});
