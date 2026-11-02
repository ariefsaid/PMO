import { expect, it } from 'vitest';
import { createFakeOdoo } from '../fakeOdoo.ts';
it('models order, stock, bill and payment transitions, including a lost response', async () => {
  const fake = createFakeOdoo({ key: 'key' });
  const call = async (model: string, method: string, body: object) => {
    const r = await fake.fetch(`https://example.test/json/2/${model}/${method}`, { method: 'POST', headers: { Authorization: 'bearer key' }, body: JSON.stringify(body) });
    return r.json();
  };
  await call('purchase.order', 'create', { vals_list: [{ state: 'draft' }] });
  await call('purchase.order', 'button_confirm', { ids: [1000] });
  fake.seed('stock.move', [{ id: 7, product_id: 3, quantity: 6 }]);
  await call('stock.picking', 'create', { vals_list: [{ state: 'assigned', move_ids: [7] }] });
  fake.failNext('lost-response');
  await expect(call('stock.picking', 'button_validate', { ids: [1001] })).rejects.toThrow();
  expect(fake.rows('stock.picking')[0]).toMatchObject({ state: 'done' });
  expect(fake.rows('stock.quant')[0]).toMatchObject({ product_id: 3, quantity: 6 });
  await call('stock.picking', 'button_validate', { ids: [1001] });
  expect(fake.rows('stock.quant')[0].quantity).toBe(6);
  const bill = await call('account.move', 'create', { vals_list: [{ state: 'draft' }] });
  await call('account.move', 'action_post', { ids: bill });
  const payment = await call('account.payment', 'create', { vals_list: [{ state: 'draft' }] });
  await call('account.payment', 'action_post', { ids: payment });
  fake.seed('account.move.line', [{ id: 10, balance: 100 }, { id: 11, balance: -40 }]);
  await call('account.move.line', 'reconcile', { ids: [10, 11] });
  expect(fake.rows('account.move.line').map((row) => row.amount_residual)).toEqual([60, 0]);
  expect(fake.rows('purchase.order')[0].state).toBe('purchase');
  expect(fake.rows('account.move')[0].state).toBe('posted');
  expect(fake.rows('account.payment')[0].state).toBe('paid');
});
