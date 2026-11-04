import { describe, expect, it } from 'vitest';
import type { AdapterCommand } from '../contract.ts';
import { bindCall } from './client.ts';
import { createFakeOdoo } from './fakeOdoo.ts';
import { createOdooRevenueAdapter, invoiceKey, recoverInvoice } from './revenueAdapter.ts';
import type { InvoiceMaps, PmoInvoice } from './revenue/invoiceBody.ts';
import { expectedInvoiceTotal, type InvoiceExpect } from './revenue/invoiceReadBack.ts';
import type { InvoiceComposite } from './revenue/recoveryProbe.ts';

const INV_ID = '77777777-7777-4777-8777-777777777777';
const MAPS: InvoiceMaps = { companyCurrency: 'IDR', partners: { 'cust-1': 41 }, items: { 'item-a': { productId: 71, incomeAccountId: 149 } }, units: { km: 11 }, costAccountId: 101, taxIds: [5] };
const INPUT: PmoInvoice = {
  id: INV_ID, customerId: 'cust-1', invoiceDate: '2026-11-03', currency: 'IDR', referenceNumber: 'PO-77', receivedDate: '2026-11-04', dueDate: '2026-12-01',
  lines: [{ itemId: 'item-a', description: 'BoQ 1', quantity: 4, unitPrice: 250, unit: 'km' }, { itemId: 'item-a', description: 'BoQ 2', quantity: 2, unitPrice: 500, unit: 'km' }],
};
const EXPECT: InvoiceExpect = { total: expectedInvoiceTotal(INPUT.lines, [11]), costAccountId: 101 };   // 2000 + 11% = 2220.00
const COMPOSITE: InvoiceComposite = { partnerId: 41, createdAfter: '2000-01-01 00:00:00' };
const command = (over: Partial<AdapterCommand['record']> = {}): AdapterCommand => ({
  domain: 'revenue', operation: 'transition', idempotencyKey: 'k-1', record: { id: INV_ID, erp_doc_kind: 'sales-invoice', verb: 'submit', customerId: 'cust-1', ...over },
});

/** A fake Odoo whose next matching call fails the way the bed's network does: before the call, or with the response lost. */
function rig({ input = INPUT, maps = MAPS, expectation = EXPECT, odooTaxRate = 11, stripDistribution = false, advanceProductAccount = 210 } = {}) {
  const fake = createFakeOdoo({ key: 'k' });
  // the directory the explicit taxes come from, and the hidden per-product default (10%) PMO must never rely on
  fake.seed('account.tax', [{ id: 5, name: 'PPN', amount: odooTaxRate }, { id: 9, name: 'Hidden default 10%', amount: 10 }]);
  fake.seed('product.product', [
    { id: 71, name: 'Item A', taxes_id: [9], income_account_id: 149 },
    { id: 72, name: 'Down payment', taxes_id: [9], income_account_id: advanceProductAccount },
  ]);
  fake.seed('res.partner', [{ id: 41, name: 'Client' }, { id: 42, name: 'Another client' }]);
  let armed: { model: string; method: string; fault: 'transport' | 'lost-response' } | null = null;
  const fetchImpl = ((url: string, init?: RequestInit) => {
    const [model, method] = String(url).split('/').slice(-2);
    if (armed && armed.model === model && armed.method === method) { fake.failNext(armed.fault); armed = null; }
    if (stripDistribution && model === 'account.move' && method === 'create' && init?.body) {
      init = { ...init, body: String(init.body).replaceAll(/"analytic_distribution":\{[^}]*\}/g, '"analytic_distribution":false') };
    }
    return fake.fetch(url, init);
  }) as typeof fetch;
  const call = bindCall({ baseUrl: 'https://odoo.example.test', apiKey: 'k', database: 'db1', fetchImpl });
  const adapter = createOdooRevenueAdapter({ call, resolveInvoice: async () => ({ input, maps, expect: expectation }) });
  /** What `dispatchMoneyWrite` does on every claim: the recovery probe first (a retry carries the composite the outbox persisted), the adapter only when it found nothing. */
  const attempt = async (cmd = command(), composite?: InvoiceComposite) => (await recoverInvoice(call, cmd.record, composite, expectation)) ?? adapter.commit(cmd);
  const count = (model: string, method: string) => fake.calls.filter((c) => c.model === model && c.method === method).length;
  const writes = () => fake.calls.filter((c) => !['read', 'search_read', 'search_count'].includes(c.method)).length;
  return { fake, call, adapter, attempt, count, writes, arm: (model: string, method: string, fault: 'transport' | 'lost-response') => { armed = { model, method, fault }; } };
}

describe('AC-OCI-010 an approved invoice is created, anchored and posted once, and its money read back from Odoo', () => {
  it('creates, anchors, posts and reads back: client, reference, explicit tax, cost account on every line, Odoo number and total in the canonical', async () => {
    const { fake, attempt, count } = rig();
    const result = await attempt();
    const [invoice] = fake.rows('account.move');
    expect(result.externalRecordId).toBe(`account.move:${invoice.id}`);
    expect(result.canonical).toMatchObject({
      id: INV_ID, si_number: expect.stringMatching(/^INV\/\d{4}\/\d{5}$/), reference_number: 'PO-77', amount: '2220.00', tax_amount: '220.00', erp_outstanding_amount: '2220.00',
      erp_docstatus: 1, odoo_state: 'posted', odoo_attention: null, odoo_sent_total: null,
    });
    expect(invoice).toMatchObject({ move_type: 'out_invoice', partner_id: 41, ref: 'PO-77', state: 'posted' });
    const lines = fake.rows('account.move.line').filter((l) => l.move_id === invoice.id && l.display_type === 'product');
    expect(lines.map((l) => l.analytic_distribution)).toEqual([{ '101': 100 }, { '101': 100 }]);
    expect([count('account.move', 'create'), count('account.move', 'action_post'), count('ir.model.data', 'create')]).toEqual([1, 1, 1]);
  });

  it('AC-OCI-014 no due date and no received date travel: the create payload carries neither', async () => {
    const { fake, attempt } = rig();
    await attempt();
    const keys = Object.keys(fake.rows('account.move')[0]).join(' ');
    expect(keys).not.toMatch(/date_due|due_date|received/);   // the create stores exactly what it was sent; Odoo derives its own due date from the partner's terms later
  });

  it('AC-OCI-015 taxes are explicit: Odoo\'s hidden per-product default (10%) is never applied; an explicit empty set is no tax', async () => {
    const hidden = rig();
    await hidden.attempt();
    expect(hidden.fake.rows('account.move')[0]).toMatchObject({ amount_tax: 220, amount_total: 2220 });   // 11% from the chosen tax, not 10% from the product
    const none = rig({ maps: { ...MAPS, taxIds: [] }, expectation: { ...EXPECT, total: expectedInvoiceTotal(INPUT.lines, []) } });
    const r = await none.attempt();
    expect(none.fake.rows('account.move')[0]).toMatchObject({ amount_tax: 0, amount_total: 2000 });
    expect(r.canonical).toMatchObject({ amount: '2000.00', tax_amount: '0.00', odoo_attention: null });
  });

  it('a free-standing invoice (no project) pushes with no distribution and no cost-account check', async () => {
    const { fake, attempt } = rig({ maps: { ...MAPS, costAccountId: null }, expectation: { ...EXPECT, costAccountId: null } });
    const r = await attempt();
    expect(fake.rows('account.move.line').filter((l) => l.display_type === 'product').map((l) => l.analytic_distribution)).toEqual([false, false]);
    expect(r.canonical.odoo_attention).toBeNull();
  });
});

describe('AC-OCI-020 / AC-OCI-022 / AC-OCI-023 claim lines use the same invoice command', () => {
  const claimLines = [
    { itemId: 'item-a', description: 'Roadworks (km)', quantity: 10, unitPrice: 50000, unit: 'km' },
    { itemId: 'item-dp', description: 'Down-payment recovery', quantity: 1, unitPrice: -40000, unit: 'km', kind: 'recovery' as const },
  ];
  const claimInput: PmoInvoice = { ...INPUT, id: INV_ID, referenceNumber: null, workOrderPoNumber: 'WO-PO-9', lines: claimLines };
  const claimMaps: InvoiceMaps = {
    ...MAPS,
    items: { ...MAPS.items, 'item-dp': { productId: 72, incomeAccountId: 210 } },
    units: { km: 11 },
    downPayment: { itemId: 'item-dp', advanceAccountId: 210 },
  };
  const claimExpectation: InvoiceExpect = {
    total: expectedInvoiceTotal(claimLines, [11]), costAccountId: 101,
    advanceAccount: { productId: 72, accountId: 210 },
  };

  it('transports the recorded claim lines, uses the work-order PO, and carries work_order_id through read-back', async () => {
    const { fake, adapter } = rig({ input: claimInput, maps: claimMaps, expectation: claimExpectation });
    const result = await adapter.commit(command({ workOrderId: 'wo-1' }));
    const [invoice] = fake.rows('account.move');
    const lines = fake.rows('account.move.line').filter((line) => line.move_id === invoice.id && line.display_type === 'product');

    expect(invoice.ref).toBe('WO-PO-9');
    expect(lines.map((line) => [line.product_id, line.quantity, line.price_unit, line.tax_ids, line.analytic_distribution])).toEqual([
      [71, 10, 50000, [5], { '101': 100 }],
      [72, 1, -40000, [5], { '101': 100 }],
    ]);
    expect(result.canonical.work_order_id).toBe('wo-1');
    expect(result.canonical.odoo_attention).toBeNull();
  });

  it('refuses a down-payment item on the wrong mirrored income account before the first Odoo call', async () => {
    const downPayment = { ...claimInput, lines: [{ itemId: 'item-dp', description: 'Down payment', quantity: 1, unitPrice: 200000, kind: 'down-payment' as const }] };
    const maps = { ...claimMaps, items: { ...claimMaps.items, 'item-dp': { productId: 72, incomeAccountId: 149 } } };
    const { fake, adapter } = rig({ input: downPayment, maps, expectation: { ...claimExpectation, total: '222000.00' } });

    await expect(adapter.commit(command())).rejects.toThrow(/config-rejected: down-payment-account: item-dp/);
    expect(fake.calls).toEqual([]);
  });

  it('flags a posted recovery line whose product resolves to another account', async () => {
    const { adapter } = rig({ input: claimInput, maps: claimMaps, expectation: claimExpectation, advanceProductAccount: 149 });

    const result = await adapter.commit(command({ workOrderId: 'wo-1' }));
    expect(result.canonical.odoo_attention).toBe('advance-account-mismatch');
  });
});

describe('AC-OCI-011 an interrupted command ends with one invoice and never a second create', () => {
  it('a failure between the anchor and the post: the retry finds the draft by its identifier and posts it (never creates)', async () => {
    const { fake, attempt, arm, count } = rig();
    arm('account.move', 'action_post', 'transport');
    await expect(attempt()).rejects.toThrow();
    expect(fake.rows('account.move')[0].state).toBe('draft');
    const result = await attempt(command(), COMPOSITE);
    expect(fake.rows('account.move')).toHaveLength(1);
    expect(result.canonical).toMatchObject({ odoo_state: 'posted', amount: '2220.00' });
    expect([count('account.move', 'create'), fake.rows('account.move')[0].state]).toEqual([1, 'posted']);
  });

  it('a lost response on the post: the retry adopts the posted invoice and posts nothing again', async () => {
    const { fake, attempt, count } = rig();
    fake.failAt('after-post');
    await expect(attempt()).rejects.toThrow();
    expect(fake.rows('account.move')[0].state).toBe('posted');
    const result = await attempt(command(), COMPOSITE);
    expect(result.canonical).toMatchObject({ odoo_state: 'posted', si_number: expect.stringMatching(/^INV\//) });
    expect([count('account.move', 'create'), count('account.move', 'action_post')]).toEqual([1, 1]);
  });

  it('a lost response on the create: the recovery sees an unanchored look-alike and HOLDS; it neither anchors nor posts it, and never creates a second', async () => {
    const { fake, attempt, count } = rig();
    fake.failAt('after-create');
    await expect(attempt()).rejects.toThrow();
    expect(fake.rows('account.move')).toHaveLength(1);
    await expect(attempt(command(), COMPOSITE)).rejects.toThrow('ambiguous-anchor');
    expect(fake.rows('account.move')).toHaveLength(1);
    expect([count('account.move', 'create'), count('account.move', 'action_post'), count('ir.model.data', 'create')]).toEqual([1, 0, 0]);
    expect(fake.rows('account.move')[0].state).toBe('draft');
  });

  it('a failure writing the anchor: the retry holds on the unanchored invoice (it may be someone else\'s); nothing is posted or created', async () => {
    const { fake, attempt, arm, count } = rig();
    arm('ir.model.data', 'create', 'transport');
    await expect(attempt()).rejects.toThrow();
    await expect(attempt(command(), COMPOSITE)).rejects.toThrow('ambiguous-anchor');
    expect([fake.rows('account.move').length, count('account.move', 'create'), count('account.move', 'action_post')]).toEqual([1, 1, 0]);
  });

  it('the same command twice is one invoice, one create, one post', async () => {
    const { fake, attempt, count } = rig();
    const first = await attempt();
    const second = await attempt(command(), COMPOSITE);
    expect(second.externalRecordId).toBe(first.externalRecordId);
    expect([fake.rows('account.move').length, count('account.move', 'create'), count('account.move', 'action_post')]).toEqual([1, 1, 1]);
  });

  it('doubt holds, never reissues: another unanchored invoice of the client in the window beside our lost create is ambiguous', async () => {
    const { fake, attempt, call } = rig();
    await call('account.move', 'create', { vals_list: [{ move_type: 'out_invoice', partner_id: 41, invoice_date: '2026-11-03', invoice_line_ids: [] }] });   // an accountant's own
    fake.failAt('after-create');
    await expect(attempt()).rejects.toThrow();
    await expect(attempt(command(), COMPOSITE)).rejects.toThrow('ambiguous-anchor');
    expect(fake.rows('account.move')).toHaveLength(2);
  });

  it('a found document that is cancelled, or is not a customer invoice, is refused: nothing is posted or created', async () => {
    const { fake, attempt, call } = rig();
    await attempt();
    fake.rows('account.move')[0].state = 'cancel';
    await expect(attempt(command(), COMPOSITE)).rejects.toThrow('invoice-cancel');
    fake.rows('account.move')[0].state = 'draft';
    fake.rows('account.move')[0].move_type = 'in_invoice';
    await expect(attempt(command(), COMPOSITE)).rejects.toThrow('invoice-not-a-customer-invoice');
    expect(fake.rows('account.move')).toHaveLength(1);
    expect(call).toBeTypeOf('function');
  });

  it('a retry of the same intent after the invoice was paid in Odoo still adopts it (a posted invoice is adopted whatever its residual)', async () => {
    const { fake, attempt } = rig();
    await attempt();
    fake.rows('account.move')[0].amount_residual = 0;
    fake.rows('account.move')[0].payment_state = 'paid';
    const r = await attempt(command(), COMPOSITE);
    expect(r.canonical).toMatchObject({ erp_outstanding_amount: '0.00', odoo_state: 'posted' });
  });
});

describe('AC-OCI-012 a command that cannot be built writes nothing', () => {
  const refused = async (over: Partial<InvoiceMaps>, input = INPUT) => {
    const { fake, adapter } = rig({ maps: { ...MAPS, ...over }, input });
    await expect(adapter.commit(command())).rejects.toThrow(/config-rejected/);
    expect(fake.calls).toEqual([]);   // not one Odoo call: reads included
  };
  it('an unmapped client, item, unit or income account refuses naming the thing, with zero Odoo calls', async () => {
    await refused({ partners: {} });
    await refused({ items: {} });
    await refused({ units: {} });
    await refused({ items: { 'item-a': { productId: 71, incomeAccountId: null } } });
  });
  it('an ordinary line carries no unit: the product\'s own unit stands and none is sent', async () => {
    const lines = INPUT.lines.map(({ unit: _unit, ...rest }) => rest);
    const { fake, attempt } = rig({ input: { ...INPUT, lines } });
    await attempt();
    expect(fake.rows('account.move.line').filter((l) => l.display_type === 'product')).toHaveLength(2);
  });
  it('names the unmapped thing in the refusal', async () => {
    const { adapter } = rig({ maps: { ...MAPS, units: {} } });
    await expect(adapter.commit(command())).rejects.toThrow('config-rejected: unit: km');
  });
  it('a net-negative invoice, a foreign currency and an invoice with no lines refuse before any write', async () => {
    await refused({}, { ...INPUT, lines: [{ ...INPUT.lines[0], unitPrice: -100 }] });
    await refused({}, { ...INPUT, currency: 'USD' });
    await refused({}, { ...INPUT, lines: [] });
  });
});

describe('AC-OCI-013 / AC-OCI-030 what Odoo computed is flagged, never overwritten', () => {
  it('Odoo answers a different total than PMO sent (its tax rate differs): needs attention, Odoo\'s money mirrored, the sent figure beside it', async () => {
    const { attempt } = rig({ odooTaxRate: 12 });
    const r = await attempt();
    expect(r.canonical).toMatchObject({ amount: '2240.00', tax_amount: '240.00', odoo_attention: 'total-mismatch', odoo_sent_total: '2220.00' });
  });

  it('a posted line without the project\'s cost account: needs attention "cost account missing"', async () => {
    const { attempt } = rig({ stripDistribution: true });
    const r = await attempt();
    expect(r.canonical).toMatchObject({ odoo_attention: 'cost-account-missing', odoo_state: 'posted' });
  });
});

describe('the adapter refuses what C3 does not push', () => {
  it('owns revenue, refuses delete, other kinds and other domains, and has no reads yet', async () => {
    const { adapter } = rig();
    expect([...adapter.capabilityMap]).toEqual(['revenue']);
    await expect(adapter.commit({ ...command(), domain: 'procurement' })).rejects.toThrow('unsupported domain');
    await expect(adapter.commit(command({ erp_doc_kind: 'incoming-payment' }))).rejects.toThrow('not available yet');
    await expect(adapter.commit({ ...command(), operation: 'delete' })).rejects.toThrow('not available yet');
    await expect(adapter.commit({ ...command(), operation: 'create' })).rejects.toThrow('not available yet');   // a create is the PMO draft: it never reaches Odoo
    await expect(adapter.commit(command({ verb: 'cancel' }))).rejects.toThrow('not available yet');
    await expect(adapter.getByExternalId('revenue', 'account.move:1')).rejects.toThrow('not available yet');
  });

  it('the anchor key follows the PMO invoice, never the per-click idempotency key', () => {
    expect(invoiceKey(command().record)).toBe(`si:${INV_ID}`);
  });
});
