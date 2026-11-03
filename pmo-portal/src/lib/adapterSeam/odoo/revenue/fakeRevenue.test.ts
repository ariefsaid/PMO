import { describe, expect, it } from 'vitest';
import { bindCall, OdooError } from '../client.ts';
import { createFakeOdoo } from '../fakeOdoo.ts';

function setup() {
  const fake = createFakeOdoo({ key: 'k' });
  const call = bindCall({ baseUrl: 'https://odoo.example.test', apiKey: 'k', database: 'db1', fetchImpl: fake.fetch });
  fake.seed('account.tax', [{ id: 5, name: '12% (Non-Luxury Good)', amount: 11 }, { id: 7, name: '12%', amount: 12 }]);
  fake.seed('product.product', [{ id: 71, taxes_id: [5], income_account_id: 149 }, { id: 72, taxes_id: [], income_account_id: 210 }]);
  fake.seed('res.partner', [{ id: 41, name: 'Client' }]);
  const invoice = async (lines: Array<Record<string, unknown>>, extra: Record<string, unknown> = {}) => {
    const [id] = await call<number[]>('account.move', 'create', { vals_list: [{ move_type: 'out_invoice', partner_id: 41, invoice_date: '2026-11-03', invoice_line_ids: lines.map((l) => [0, 0, l]), ...extra }] });
    return id;
  };
  const read = async (id: number, fields = ['state', 'name', 'amount_untaxed', 'amount_tax', 'amount_total', 'amount_residual', 'payment_state']) =>
    (await call<Array<Record<string, unknown>>>('account.move', 'read', { ids: [id], fields }))[0];
  const post = (id: number) => call('account.move', 'action_post', { ids: [id] });
  const line = (price: number, extra: Record<string, unknown> = {}) => ({ product_id: 71, name: 'line', quantity: 1, price_unit: price, ...extra });
  return { fake, call, invoice, read, post, line };
}
const failure = async (p: Promise<unknown>) => { try { await p; } catch (e) { return e as OdooError; } throw new Error('expected a failure'); };

describe('fakeOdoo customer invoice (C0 V-OCI1, V-OCI4..6)', () => {
  it('creates a draft with Odoo\'s own money: 1000 + 11% = 1110, no number until posted', async () => {
    const { read, invoice, line } = setup();
    const id = await invoice([line(1000, { tax_ids: [[6, 0, [5]]], analytic_distribution: { '4': 100 } })]);
    expect(await read(id)).toEqual({ id, state: 'draft', name: false, amount_untaxed: 1000, amount_tax: 110, amount_total: 1110, amount_residual: 1110, payment_state: 'not_paid' });
  });

  it('omitted tax_ids applies the product default; [[6,0,[]]] and [[5,0,0]] are explicit empty sets', async () => {
    const { read, invoice, line } = setup();
    expect((await read(await invoice([line(1000)]))).amount_tax).toBe(110);
    expect((await read(await invoice([line(1000, { tax_ids: [[6, 0, []]] })]))).amount_tax).toBe(0);
    expect((await read(await invoice([line(1000, { tax_ids: [[5, 0, 0]] })]))).amount_tax).toBe(0);
    expect((await read(await invoice([line(1000, { tax_ids: [[6, 0, [7]]] })]))).amount_tax).toBe(120);
  });

  it('posts: state posted, a number is assigned, tax and receivable lines exist, and the distribution survives on product lines', async () => {
    const { fake, read, invoice, post, line } = setup();
    const id = await invoice([line(1000, { tax_ids: [[6, 0, [5]]], analytic_distribution: { '4': 100 } }), line(-200, { tax_ids: [[6, 0, [5]]], analytic_distribution: { '4': 100 } })]);
    await post(id);
    const posted = await read(id);
    expect(posted).toMatchObject({ state: 'posted', amount_untaxed: 800, amount_tax: 88, amount_total: 888, amount_residual: 888, payment_state: 'not_paid' });
    expect(String(posted.name)).toMatch(/^INV\/\d{4}\/\d{5}$/);
    const lines = fake.rows('account.move.line').filter((l) => l.move_id === id);
    expect(lines.filter((l) => l.display_type === 'product').map((l) => l.analytic_distribution)).toEqual([{ '4': 100 }, { '4': 100 }]);
    expect(lines.filter((l) => l.display_type === 'tax').map((l) => l.balance)).toEqual([-88]);
    expect(lines.filter((l) => l.display_type === 'payment_term').map((l) => l.balance)).toEqual([888]);
  });

  it('numbers are unique and sequential', async () => {
    const { read, invoice, post, line } = setup();
    const [a, b] = [await invoice([line(1)]), await invoice([line(1)])];
    await post(a); await post(b);
    expect([String((await read(a)).name), String((await read(b)).name)]).toEqual([expect.stringMatching(/00001$/), expect.stringMatching(/00002$/)]);
  });

  it('a second post is a 422 UserError and changes nothing; a negative total does not post; a zero total posts and reads paid', async () => {
    const { read, invoice, post, line } = setup();
    const id = await invoice([line(1000)]);
    await post(id);
    const again = await failure(post(id));
    expect(again).toMatchObject({ errorClass: 'validation', status: 422 });
    expect((await read(id)).state).toBe('posted');
    const negative = await invoice([line(-100)]);
    expect(await failure(post(negative))).toMatchObject({ errorClass: 'validation', status: 422 });
    expect((await read(negative)).state).toBe('draft');
    const zero = await invoice([line(0)]);
    await post(zero);
    expect(await read(zero)).toMatchObject({ state: 'posted', amount_total: 0, amount_residual: 0, payment_state: 'paid' });
  });

  it('a failure body carries the six keys with the exception name', async () => {
    const { fake, invoice, line } = setup();
    const id = await invoice([line(1)]);
    const res = await fake.fetch('https://odoo.example.test/json/2/account.move/action_post', { method: 'POST', headers: { Authorization: 'bearer k' }, body: JSON.stringify({ ids: [id] }) });
    const second = await fake.fetch('https://odoo.example.test/json/2/account.move/action_post', { method: 'POST', headers: { Authorization: 'bearer k' }, body: JSON.stringify({ ids: [id] }) });
    expect(res.status).toBe(200);
    expect(second.status).toBe(422);
    expect(Object.keys(await second.json()).sort()).toEqual(['arguments', 'context', 'debug', 'message', 'name', 'timestamp']);
  });

  it('a post without a partner is refused (422)', async () => {
    const { call } = setup();
    const [id] = await call<number[]>('account.move', 'create', { vals_list: [{ move_type: 'out_invoice', invoice_line_ids: [[0, 0, { product_id: 71, quantity: 1, price_unit: 1 }]] }] });
    expect(await failure(call('account.move', 'action_post', { ids: [id] }))).toMatchObject({ errorClass: 'validation' });
  });

  it('keeps the purchase bill behaviour: a bill with no move_type posts as before', async () => {
    const { fake, call } = setup();
    const [bill] = await call<number[]>('account.move', 'create', { vals_list: [{ state: 'draft' }] });
    await call('account.move', 'action_post', { ids: [bill] });
    expect(fake.rows('account.move').find((r) => r.id === bill)?.state).toBe('posted');
  });
});

describe('fakeOdoo register-payment wizard and inbound payments (C0 V-OCI7, V-OCI8)', () => {
  const pay = async (s: ReturnType<typeof setup>, invoiceId: number, vals: Record<string, unknown> = {}) => {
    const context = { active_model: 'account.move', active_ids: [invoiceId] };
    const ids = await s.call<number[]>('account.payment.register', 'create', { vals_list: [vals], context });
    return s.call<Record<string, unknown>>('account.payment.register', 'action_create_payments', { ids, context });
  };
  const posted = async (s: ReturnType<typeof setup>, price = 1000) => { const id = await s.invoice([s.line(price, { tax_ids: [[6, 0, [5]]] })]); await s.post(id); return id; };

  it('a full receipt creates a posted inbound customer payment and closes the invoice', async () => {
    const s = setup();
    const id = await posted(s);
    const action = await pay(s, id);
    expect(action).toMatchObject({ type: 'ir.actions.act_window', res_model: 'account.payment' });
    expect(await s.read(id)).toMatchObject({ amount_residual: 0, payment_state: 'paid' });
    expect(s.fake.rows('account.payment')).toEqual([expect.objectContaining({ id: action.res_id, payment_type: 'inbound', partner_type: 'customer', partner_id: 41, amount: 1110, state: 'paid' })]);
  });

  it('a partial receipt leaves the rest outstanding; two receipts settle it', async () => {
    const s = setup();
    const id = await posted(s);
    await pay(s, id, { amount: 400 });
    expect(await s.read(id)).toMatchObject({ amount_residual: 710, payment_state: 'partial' });
    await pay(s, id, { amount: 710 });
    expect(await s.read(id)).toMatchObject({ amount_residual: 0, payment_state: 'paid' });
  });

  it('accepts an amount above the residual (the excess stays on the payment), as the bed does', async () => {
    const s = setup();
    const id = await posted(s);
    await pay(s, id, { amount: 2000 });
    expect(await s.read(id)).toMatchObject({ amount_residual: 0, payment_state: 'paid' });
    expect(s.fake.rows('account.payment')[0].amount).toBe(2000);
  });

  it('a second wizard on a paid invoice is refused (422); a wizard on a draft is refused', async () => {
    const s = setup();
    const id = await posted(s);
    await pay(s, id);
    expect(await failure(pay(s, id))).toMatchObject({ errorClass: 'validation' });
    const draft = await s.invoice([s.line(1000)]);
    expect(await failure(pay(s, draft))).toMatchObject({ errorClass: 'validation' });
  });

  it('client-withheld tax: reconcile with a write-off account books the difference and closes the invoice', async () => {
    const s = setup();
    const id = await posted(s);
    await pay(s, id, { amount: 1090, payment_difference_handling: 'reconcile', writeoff_account_id: 88, writeoff_label: 'BP-1' });
    expect(await s.read(id)).toMatchObject({ amount_residual: 0, payment_state: 'paid' });
    expect(s.fake.rows('account.move.line').filter((l) => l.account_id === 88)).toEqual([expect.objectContaining({ balance: 20, name: 'BP-1' })]);
  });

  it('a standalone payment posts, then reconciling its receivable line with the invoice\'s closes the invoice; a lone line is a silent no-op', async () => {
    const s = setup();
    const id = await posted(s);
    const [payment] = await s.call<number[]>('account.payment', 'create', { vals_list: [{ payment_type: 'inbound', partner_type: 'customer', partner_id: 41, amount: 1110, memo: 'pmo:ip:x' }] });
    await s.call('account.payment', 'action_post', { ids: [payment] });
    const receivable = s.fake.rows('account.move.line').filter((l) => l.account_type === 'asset_receivable');
    expect(receivable.map((l) => l.balance).sort((a, b) => Number(a) - Number(b))).toEqual([-1110, 1110]);
    expect(await s.call('account.move.line', 'reconcile', { ids: [receivable[0].id] })).toBe(true);
    expect((await s.read(id)).amount_residual).toBe(1110);
    await s.call('account.move.line', 'reconcile', { ids: receivable.map((l) => l.id) });
    expect(await s.read(id)).toMatchObject({ amount_residual: 0, payment_state: 'paid' });
    expect(s.fake.rows('account.payment')[0]).toMatchObject({ state: 'paid', is_reconciled: true });
  });
});

describe('fakeOdoo named faults: the step completes in Odoo and the response is lost', () => {
  it('after-create leaves one draft; the next create is unaffected (the fault is one-shot)', async () => {
    const s = setup();
    s.fake.failAt('after-create');
    await expect(s.invoice([s.line(1)])).rejects.toMatchObject({ errorClass: 'unreachable' });
    expect(s.fake.rows('account.move').map((r) => r.state)).toEqual(['draft']);
    await s.invoice([s.line(1)]);
    expect(s.fake.rows('account.move')).toHaveLength(2);
  });

  it('after-post leaves the invoice posted', async () => {
    const s = setup();
    const id = await s.invoice([s.line(1000)]);
    s.fake.failAt('after-post');
    await expect(s.post(id)).rejects.toMatchObject({ errorClass: 'unreachable' });
    expect((await s.read(id)).state).toBe('posted');
  });

  it('after-reconcile leaves the receipt applied', async () => {
    const s = setup();
    const id = await s.invoice([s.line(1000, { tax_ids: [[6, 0, [5]]] })]);
    await s.post(id);
    const context = { active_model: 'account.move', active_ids: [id] };
    const ids = await s.call<number[]>('account.payment.register', 'create', { vals_list: [{}], context });
    s.fake.failAt('after-reconcile');
    await expect(s.call('account.payment.register', 'action_create_payments', { ids, context })).rejects.toMatchObject({ errorClass: 'unreachable' });
    expect(await s.read(id)).toMatchObject({ amount_residual: 0, payment_state: 'paid' });
    expect(s.fake.rows('account.payment')).toHaveLength(1);
  });

  it('lost-response loses the next call of any kind after it completes', async () => {
    const s = setup();
    s.fake.failAt('lost-response');
    await expect(s.call('res.partner', 'create', { vals_list: [{ name: 'x' }] })).rejects.toBeInstanceOf(OdooError);
    expect(s.fake.rows('res.partner').some((r) => r.name === 'x')).toBe(true);
  });

  it('stores and finds a stock external identifier (the anchor) by name', async () => {
    const s = setup();
    const id = await s.invoice([s.line(1)]);
    await s.call('ir.model.data', 'create', { vals_list: [{ module: 'pmo', name: 'si_123', model: 'account.move', res_id: id }] });
    expect(await s.call('ir.model.data', 'search_read', { domain: [['module', '=', 'pmo'], ['name', '=', 'si_123']], fields: ['res_id'] })).toEqual([{ id: expect.any(Number), res_id: id }]);
  });
});
