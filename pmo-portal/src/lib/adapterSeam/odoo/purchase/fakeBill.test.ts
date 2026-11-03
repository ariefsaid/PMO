import { describe, expect, it } from 'vitest';
import { createFakeOdoo } from '../fakeOdoo.ts';

function rig() {
  const fake = createFakeOdoo({ key: 'k' });
  fake.seed('account.tax', [{ id: 11, name: 'VAT 11%', amount: 11 }, { id: 12, name: 'Withholding 2%', amount: -2 }, { id: 13, name: 'Hidden default 10%', amount: 10 }]);
  fake.seed('product.product', [{ id: 55, name: 'Cable tray', supplier_taxes_id: [13] }]);
  fake.seed('purchase.order.line', [{ id: 301, qty_invoiced: 0 }]);
  const call = async (model: string, method: string, body: object) => {
    const r = await fake.fetch(`https://example.test/json/2/${model}/${method}`, { method: 'POST', headers: { Authorization: 'bearer k' }, body: JSON.stringify(body) });
    return { status: r.status, body: await r.json() };
  };
  return { fake, call };
}
const bill = (line: Record<string, unknown>) => ({ move_type: 'in_invoice', partner_id: 9, invoice_date: '2026-12-05', invoice_line_ids: [[0, 0, { product_id: 55, quantity: 1, price_unit: 100, ...line }]] });

describe('the fake models a vendor bill the way the bed shows it (V-OPP5/6)', () => {
  it('100 + 11% VAT + 2% withholding: untaxed 100, tax 9, total and residual 109, tax lines +11 and -2', async () => {
    const { fake, call } = rig();
    const { body: [id] } = await call('account.move', 'create', { vals_list: [bill({ tax_ids: [[6, 0, [11, 12]]] })] });
    expect(fake.rows('account.move')[0]).toMatchObject({ amount_untaxed: 100, amount_tax: 9, amount_total: 109, amount_residual: 109, state: 'draft' });
    const tax = fake.rows('account.move.line').filter((l) => l.display_type === 'tax');
    expect(tax.map((l) => [l.balance, l.tax_base_amount])).toEqual([[11, 100], [-2, 100]]);
    expect(tax.every((l) => l.move_id === id)).toBe(true);
  });

  it('a line that names no taxes takes the product\'s own: the hidden default PMO must never rely on', async () => {
    const { fake, call } = rig();
    await call('account.move', 'create', { vals_list: [bill({})] });
    expect(fake.rows('account.move')[0]).toMatchObject({ amount_tax: 10, amount_total: 110 });
    await call('account.move', 'create', { vals_list: [bill({ tax_ids: [[6, 0, []]] })] });
    expect(fake.rows('account.move')[1]).toMatchObject({ amount_tax: 0, amount_total: 100 });
  });

  it('posting numbers the bill and bills the order line; a second post is a 422; a bill with no date will not post', async () => {
    const { fake, call } = rig();
    const { body: [id] } = await call('account.move', 'create', { vals_list: [bill({ tax_ids: [[6, 0, []]], purchase_line_id: 301 })] });
    expect((await call('account.move', 'action_post', { ids: [id] })).status).toBe(200);
    expect(fake.rows('account.move')[0]).toMatchObject({ state: 'posted', name: 'BILL/2026/00001' });
    expect(fake.rows('purchase.order.line')[0].qty_invoiced).toBe(1);
    expect((await call('account.move', 'action_post', { ids: [id] })).status).toBe(422);
    expect(fake.rows('purchase.order.line')[0].qty_invoiced).toBe(1);
    const undated = await call('account.move', 'create', { vals_list: [{ ...bill({}), invoice_date: false }] });
    expect((await call('account.move', 'action_post', { ids: undated.body })).status).toBe(422);
  });
});
