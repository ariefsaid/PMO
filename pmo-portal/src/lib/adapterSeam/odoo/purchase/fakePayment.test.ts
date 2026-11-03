import { describe, expect, it } from 'vitest';
import { createFakeOdoo } from '../fakeOdoo.ts';

function rig() {
  const fake = createFakeOdoo({ key: 'k' });
  fake.seed('account.tax', [{ id: 11, name: 'VAT 11%', amount: 11 }]);
  fake.seed('product.product', [{ id: 55, name: 'Cable tray', supplier_taxes_id: [] }]);
  const call = async (model: string, method: string, body: object) => {
    const r = await fake.fetch(`https://example.test/json/2/${model}/${method}`, { method: 'POST', headers: { Authorization: 'bearer k' }, body: JSON.stringify(body) });
    return { status: r.status, body: await r.json() };
  };
  const bill = async (price = 98) => {
    const { body: [id] } = await call('account.move', 'create', { vals_list: [{ move_type: 'in_invoice', partner_id: 9, invoice_date: '2026-12-05', invoice_line_ids: [[0, 0, { product_id: 55, quantity: 1, price_unit: price, tax_ids: [[6, 0, []]] }]] }] });
    await call('account.move', 'action_post', { ids: [id] });
    return id as number;
  };
  const pay = async (billId: number, amount: number) => {
    const { body: [id] } = await call('account.payment', 'create', { vals_list: [{ payment_type: 'outbound', partner_type: 'supplier', partner_id: 9, amount, journal_id: 7, payment_method_line_id: 31, memo: 'pmo:x' }] });
    await call('account.payment', 'action_post', { ids: [id] });
    const [payment] = (await call('account.payment', 'read', { ids: [id], fields: ['move_id'] })).body;
    const lines = (await call('account.move.line', 'search_read', { domain: [['move_id', 'in', [billId, payment.move_id[0]]], ['account_type', '=', 'liability_payable'], ['reconciled', '=', false]], fields: ['amount_residual'] })).body;
    return { id: id as number, lines: lines as Array<{ id: number }> };
  };
  return { fake, call, bill, pay };
}

describe('the fake models a vendor payment the way the bed shows it (V-OPP7)', () => {
  it('a draft payment posts once; a repeat post is accepted and changes nothing', async () => {
    const { fake, call, bill, pay } = rig();
    const b = await bill();
    const { id } = await pay(b, 98);
    expect(fake.rows('account.payment')[0]).toMatchObject({ id, state: 'paid', amount: 98 });
    expect((await call('account.payment', 'action_post', { ids: [id] })).status).toBe(200);
    expect(fake.rows('account.move.line').filter((l) => l.account_type === 'liability_payable')).toHaveLength(2);
  });

  it('reconciling the whole bill: residual 0, paid, the payment shows the bill it settled', async () => {
    const { fake, call, bill, pay } = rig();
    const b = await bill();
    const { lines } = await pay(b, 98);
    expect(lines).toHaveLength(2);
    expect((await call('account.move.line', 'reconcile', { ids: lines.map((l) => l.id) })).status).toBe(200);
    expect(fake.rows('account.move').find((m) => m.id === b)).toMatchObject({ amount_residual: 0, payment_state: 'paid' });
    expect(fake.rows('account.payment')[0].reconciled_bill_ids).toEqual([b]);
  });

  it('40 then 58: partial, then paid; the second payment reconciles the remainder', async () => {
    const { fake, call, bill, pay } = rig();
    const b = await bill();
    await call('account.move.line', 'reconcile', { ids: (await pay(b, 40)).lines.map((l) => l.id) });
    expect(fake.rows('account.move').find((m) => m.id === b)).toMatchObject({ amount_residual: 58, payment_state: 'partial' });
    await call('account.move.line', 'reconcile', { ids: (await pay(b, 58)).lines.map((l) => l.id) });
    expect(fake.rows('account.move').find((m) => m.id === b)).toMatchObject({ amount_residual: 0, payment_state: 'paid' });
  });

  it('Odoo ACCEPTS an overpayment: the bill is paid and the surplus stays on the payment line', async () => {
    const { fake, call, bill, pay } = rig();
    const b = await bill();
    await call('account.move.line', 'reconcile', { ids: (await pay(b, 99)).lines.map((l) => l.id) });
    expect(fake.rows('account.move').find((m) => m.id === b)).toMatchObject({ amount_residual: 0, payment_state: 'paid' });
    expect(fake.rows('account.move.line').find((l) => l.account_type === 'liability_payable' && Number(l.amount_residual) > 0)).toMatchObject({ amount_residual: 1 });
  });

  it('lines that are already reconciled are a 422', async () => {
    const { call, bill, pay } = rig();
    const b = await bill();
    const { lines } = await pay(b, 98);
    await call('account.move.line', 'reconcile', { ids: lines.map((l) => l.id) });
    expect((await call('account.move.line', 'reconcile', { ids: lines.map((l) => l.id) })).status).toBe(422);
  });
});
