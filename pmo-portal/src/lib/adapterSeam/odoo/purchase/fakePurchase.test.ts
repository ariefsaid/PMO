import { describe, expect, it } from 'vitest';
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
  await expect(call('stock.picking', 'button_validate', { ids: [1000] })).rejects.toThrow();
  expect(fake.rows('stock.picking')[0]).toMatchObject({ state: 'done' });
  expect(fake.rows('stock.quant')[0]).toMatchObject({ product_id: 3, quantity: 6 });
  await call('stock.picking', 'button_validate', { ids: [1000] });
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

it('models a partial receipt backorder wizard and leaves the remainder open', async () => {
  const fake = createFakeOdoo({ key: 'key' });
  const call = async (model: string, method: string, body: object) => {
    const r = await fake.fetch(`https://example.test/json/2/${model}/${method}`, { method: 'POST', headers: { Authorization: 'bearer key' }, body: JSON.stringify(body) });
    return r.json();
  };
  fake.seed('stock.move', [{ id: 7, product_id: 3, product_uom_qty: 10, quantity: 6 }]);
  const [pickingId] = await call('stock.picking', 'create', { vals_list: [{ state: 'assigned', move_ids: [7] }] }) as number[];

  const action = await call('stock.picking', 'button_validate', { ids: [pickingId] });
  expect(action).toMatchObject({ res_model: 'stock.backorder.confirmation' });
  expect(fake.rows('stock.picking')[0].state).toBe('assigned');
  expect(fake.rows('stock.quant')).toEqual([]);

  const [wizardId] = await call('stock.backorder.confirmation', 'create', { vals_list: [{}], context: action.context }) as number[];
  expect(await call('stock.backorder.confirmation', 'process', { ids: [wizardId], context: action.context })).toBe(true);

  const [completed] = fake.rows('stock.picking').filter((row) => row.state === 'done');
  const [backorder] = fake.rows('stock.picking').filter((row) => row.state !== 'done');
  const [completedMove] = fake.rows('stock.move').filter((move) => (completed.move_ids as number[]).includes(move.id));
  const [remainingMove] = fake.rows('stock.move').filter((move) => (backorder.move_ids as number[]).includes(move.id));
  expect(completedMove).toMatchObject({ quantity: 6 });
  expect(backorder).toMatchObject({ backorder_id: pickingId });
  expect(remainingMove).toMatchObject({ product_uom_qty: 4 });
  expect(fake.rows('stock.quant')[0]).toMatchObject({ product_id: 3, quantity: 6 });
});

it('completes the full receipt when no done quantity was entered', async () => {
  const fake = createFakeOdoo({ key: 'key' });
  const call = async (model: string, method: string, body: object) => {
    const r = await fake.fetch(`https://example.test/json/2/${model}/${method}`, { method: 'POST', headers: { Authorization: 'bearer key' }, body: JSON.stringify(body) });
    return r.json();
  };
  fake.seed('stock.move', [{ id: 7, product_id: 3, product_uom_qty: 3 }]);
  const [pickingId] = await call('stock.picking', 'create', { vals_list: [{ state: 'assigned', move_ids: [7] }] }) as number[];

  expect(await call('stock.picking', 'button_validate', { ids: [pickingId] })).toBe(true);

  expect(fake.rows('stock.picking')[0]).toMatchObject({ state: 'done' });
  expect(fake.rows('stock.move')[0]).toMatchObject({ state: 'done', quantity: 3, product_uom_qty: 3 });
  expect(fake.rows('stock.quant')[0]).toMatchObject({ product_id: 3, quantity: 3 });
});

describe('the fake purchase order (P3)', () => {
  const rig = (options: { doubleValidation?: boolean } = {}) => {
    const fake = createFakeOdoo({ key: 'key', ...options });
    const call = async (model: string, method: string, body: object) => {
      const r = await fake.fetch(`https://example.test/json/2/${model}/${method}`, { method: 'POST', headers: { Authorization: 'bearer key' }, body: JSON.stringify(body) });
      return { status: r.status, json: await r.json() };
    };
    return { fake, call };
  };
  const line = (qty: number, price: number) => [0, 0, { product_id: 5, product_qty: qty, price_unit: price }];

  it('expands order_line commands into lines, totals them, and stamps create_date', async () => {
    const { fake, call } = rig();
    const { json: [id] } = await call('purchase.order', 'create', { vals_list: [{ partner_id: 9, order_line: [line(2, 10), line(1, 5)] }] });
    expect(fake.rows('purchase.order')[0]).toMatchObject({ id, state: 'draft', amount_total: 25, partner_id: 9 });
    expect(fake.rows('purchase.order')[0].create_date).toMatch(/^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/);
    expect(fake.rows('purchase.order.line')).toHaveLength(2);
    expect(fake.rows('purchase.order.line')[0]).toMatchObject({ order_id: id, qty_received: 0, qty_invoiced: 0 });
  });

  it('edits a line in place and adds one, but refuses to remove one (as the bed does)', async () => {
    const { fake, call } = rig();
    await call('purchase.order', 'create', { vals_list: [{ order_line: [line(2, 10)] }] });
    const [first] = fake.rows('purchase.order.line');
    const order = fake.rows('purchase.order')[0];
    await call('purchase.order', 'write', { ids: [order.id], vals: { order_line: [[1, first.id, { product_qty: 3 }], line(1, 4)] } });
    expect(fake.rows('purchase.order')[0].amount_total).toBe(34);
    const removed = await call('purchase.order', 'write', { ids: [order.id], vals: { order_line: [[2, first.id, 0]] } });
    expect(removed.status).toBe(422);
    expect(fake.rows('purchase.order.line')).toHaveLength(2);
  });

  it('waits in "to approve" under double validation until button_approve', async () => {
    const { fake, call } = rig({ doubleValidation: true });
    await call('purchase.order', 'create', { vals_list: [{ order_line: [line(1, 1)] }] });
    const id = fake.rows('purchase.order')[0].id;
    await call('purchase.order', 'button_confirm', { ids: [id] });
    expect(fake.rows('purchase.order')[0].state).toBe('to approve');
    await call('purchase.order', 'button_approve', { ids: [id] });
    expect(fake.rows('purchase.order')[0].state).toBe('purchase');
  });
});
