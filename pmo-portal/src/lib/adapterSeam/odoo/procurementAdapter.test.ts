import { describe, expect, it } from 'vitest';
import type { AdapterCommand } from '../contract.ts';
import { bindCall } from './client.ts';
import { createFakeOdoo } from './fakeOdoo.ts';
import type { OrderCtx, OrderInput } from './purchase/orderBody.ts';
import { createOdooProcurementAdapter, recoverOrder, recoverRevise } from './procurementAdapter.ts';
import type { ReviseLine } from './purchase/orderRevise.ts';
import type { OrderComposite } from './purchase/recoveryProbe.ts';

const PO_ID = '123e4567-e89b-12d3-a456-426614174000';
const INPUT: OrderInput = {
  vendor: 'Vendor:9', caseNumber: 'PRC-001', vendorReference: 'PO-77', expectedDate: '2026-12-01', projectIds: ['p-1'],
  lines: [{ name: 'Cable tray', quantity: 4, rate: 10 }, { name: 'Bolt', quantity: 2, rate: 5 }],
};
const CTX: OrderCtx = { companyId: 1, currencyId: 12, itemMap: { 'Cable tray': '55', Bolt: '56' }, unitMap: {}, costAccountId: '101', taxIds: [] };
const COMPOSITE: OrderComposite = { partnerId: 9, amount: '50.00', lineCount: 2, createdAfter: '2026-01-01 00:00:00' };
const create = (over: Partial<AdapterCommand['record']> = {}): AdapterCommand => ({
  domain: 'procurement', operation: 'create', idempotencyKey: 'k-1',
  record: { id: PO_ID, erp_doc_kind: 'purchase-order', procurementId: 'case-1', referenceNumber: 'PO-77', date: '2026-12-01', amount: '50.00', ...over },
});

/** A fake Odoo whose next matching call fails, the way the bed's network does: before the call, or with the response lost. */
function rig({ doubleValidation = false, input = INPUT, ctx = CTX } = {}) {
  const fake = createFakeOdoo({ key: 'k', doubleValidation });
  let armed: { model: string; method: string; fault: 'transport' | 'lost-response' } | null = null;
  const fetchImpl = ((url: string, init?: RequestInit) => {
    const [model, method] = String(url).split('/').slice(-2);
    if (armed && armed.model === model && armed.method === method) { fake.failNext(armed.fault); armed = null; }
    return fake.fetch(url, init);
  }) as typeof fetch;
  const call = bindCall({ baseUrl: 'https://odoo.example.test', apiKey: 'k', database: 'db1', fetchImpl });
  const state = { orderId: 0, lines: [] as ReviseLine[] };
  const adapter = createOdooProcurementAdapter({
    call, resolveOrder: async () => ({ input, ctx }),
    resolveRevise: async () => ({ orderId: state.orderId, lines: state.lines, ctx }),
  });
  /** What `dispatchMoneyWrite` does on every claim: the recovery probe first, the adapter only when it found nothing. */
  const attempt = async (cmd = create()) => (await recoverOrder(call, cmd.record, COMPOSITE)) ?? adapter.commit(cmd);
  const count = (model: string, method: string) => fake.calls.filter((c) => c.model === model && c.method === method).length;
  return { fake, call, adapter, attempt, count, state, arm: (model: string, method: string, fault: 'transport' | 'lost-response') => { armed = { model, method, fault }; } };
}

describe('AC-OPP-010 an approved order is created and confirmed once', () => {
  it('creates, anchors, confirms and reads back: vendor, lines, distribution, Odoo total in the canonical', async () => {
    const { fake, attempt, count } = rig();
    const result = await attempt();
    const [order] = fake.rows('purchase.order');
    expect(fake.rows('purchase.order')).toHaveLength(1);
    expect(order).toMatchObject({ state: 'purchase', partner_id: 9, partner_ref: 'PO-77', origin: 'PRC-001', amount_total: 50, currency_id: 12 });
    expect(fake.rows('purchase.order.line').map((l) => [l.product_id, l.product_qty, l.analytic_distribution])).toEqual([[55, 4, { '101': 100 }], [56, 2, { '101': 100 }]]);
    expect(fake.rows('ir.model.data')).toEqual([expect.objectContaining({ module: 'pmo', model: 'purchase.order', res_id: order.id })]);
    expect(result.externalRecordId).toBe(`purchase.order:${order.id}`);
    expect(result.canonical).toMatchObject({ id: PO_ID, po_number: order.name, amount: '50.00', pmo_amount: '50.00', erp_docstatus: 1, erp_modified: order.write_date });
    expect(count('purchase.order', 'button_confirm')).toBe(1);
  });

  it('AC-OPP-015 Odoo\'s total and the PMO-entered figure both travel, and differ when Odoo says so', async () => {
    const { attempt } = rig();
    const result = await attempt(create({ amount: '47.00' }));
    expect(result.canonical).toMatchObject({ amount: '50.00', pmo_amount: '47.00' });
  });
});

describe('AC-OPP-011 an interrupted command ends with one confirmed order and no second create', () => {
  const settled = (r: ReturnType<typeof rig>) => {
    expect(r.fake.rows('purchase.order')).toHaveLength(1);
    expect(r.fake.rows('purchase.order')[0].state).toBe('purchase');
    expect(r.fake.rows('ir.model.data')).toHaveLength(1);
    expect(r.count('purchase.order', 'create')).toBe(1);
  };

  it('a lost response on the create: the retry finds the order by the composite, anchors and confirms it', async () => {
    const r = rig();
    r.arm('purchase.order', 'create', 'lost-response');
    await expect(r.attempt()).rejects.toMatchObject({ code: 'external-unreachable' });
    expect(r.fake.rows('purchase.order')[0].state).toBe('draft');
    await r.attempt();
    settled(r);
  });

  it('a failure writing the anchor: the retry adopts the unanchored order through the composite', async () => {
    const r = rig();
    r.arm('ir.model.data', 'create', 'transport');
    await expect(r.attempt()).rejects.toMatchObject({ code: 'external-unreachable' });
    expect(r.fake.rows('ir.model.data')).toHaveLength(0);
    await r.attempt();
    settled(r);
  });

  it('a failure before the confirm: the retry finds the draft by its identifier and confirms it (never creates)', async () => {
    const r = rig();
    r.arm('purchase.order', 'button_confirm', 'transport');
    await expect(r.attempt()).rejects.toMatchObject({ code: 'external-unreachable' });
    expect(r.fake.rows('purchase.order')[0].state).toBe('draft');
    await r.attempt();
    settled(r);
    expect(r.count('purchase.order', 'button_confirm')).toBe(2);
  });

  it('a lost response on the confirm: the retry adopts the confirmed order and confirms nothing again', async () => {
    const r = rig();
    r.arm('purchase.order', 'button_confirm', 'lost-response');
    await expect(r.attempt()).rejects.toMatchObject({ code: 'external-unreachable' });
    expect(r.fake.rows('purchase.order')[0].state).toBe('purchase');
    const result = await r.attempt();
    settled(r);
    expect(r.count('purchase.order', 'button_confirm')).toBe(1);
    expect(result.canonical).toMatchObject({ erp_docstatus: 1 });
  });

  it('a repeat of a finished command is a plain adoption', async () => {
    const r = rig();
    const first = await r.attempt();
    const again = await r.attempt();
    settled(r);
    expect(again.externalRecordId).toBe(first.externalRecordId);
  });

  it('two look-alike unanchored orders are doubt: the probe throws (the row is held) and nothing is created', async () => {
    const r = rig();
    r.arm('purchase.order', 'create', 'lost-response');
    await expect(r.attempt()).rejects.toThrow();
    r.fake.seed('purchase.order', [{ ...r.fake.rows('purchase.order')[0], id: 4000 }]);
    const creates = r.count('purchase.order', 'create');
    await expect(r.attempt()).rejects.toThrow(/ambiguous/);
    expect(r.count('purchase.order', 'create')).toBe(creates);
  });

  it('I1 a lost create response whose order drifted from the composite (0.01 off) is held: nothing is created again', async () => {
    const r = rig();
    r.arm('purchase.order', 'create', 'lost-response');
    await expect(r.attempt()).rejects.toMatchObject({ code: 'external-unreachable' });
    r.fake.rows('purchase.order')[0].amount_untaxed = 50.01;   // Odoo's own figure differs from the edge's formula
    await expect(r.attempt()).rejects.toThrow(/ambiguous/);
    await expect(r.attempt()).rejects.toThrow(/ambiguous/);
    expect(r.count('purchase.order', 'create')).toBe(1);
    expect(r.fake.rows('purchase.order')).toHaveLength(1);
  });

  it('an order cancelled in Odoo is not revived or recreated: the command is rejected, naming the state', async () => {
    const r = rig();
    await r.attempt();
    r.fake.rows('purchase.order')[0].state = 'cancel';
    await expect(r.attempt()).rejects.toMatchObject({ code: 'commit-rejected', message: 'order-cancel' });
    expect(r.count('purchase.order', 'create')).toBe(1);
  });
});

describe('AC-OPP-012 an order that waits for approval inside Odoo', () => {
  it('is pushed-not-approved: the approve method is never called, the order is not issued, and a retry changes nothing', async () => {
    const r = rig({ doubleValidation: true });
    const first = await r.attempt();
    expect(first.canonical).toMatchObject({ erp_docstatus: 0, odoo_outcome: 'pushed-not-approved' });
    expect(r.fake.rows('purchase.order')[0].state).toBe('to approve');
    const again = await r.attempt();
    expect(again.canonical).toMatchObject({ erp_docstatus: 0, odoo_outcome: 'pushed-not-approved' });
    expect(r.count('purchase.order', 'button_approve')).toBe(0);
    expect(r.count('purchase.order', 'button_confirm')).toBe(1);
    expect(r.count('purchase.order', 'create')).toBe(1);
  });
});

describe('AC-OPP-013 / AC-OPP-014 a command that cannot be built writes nothing', () => {
  it.each([
    ['an unmapped item', { ...INPUT, lines: [{ name: 'Gasket', quantity: 1, rate: 1 }] }, CTX, 'item-unmapped: Gasket'],
    ['an unmapped vendor', { ...INPUT, vendor: null }, CTX, 'vendor-unmapped'],
    ['two projects', { ...INPUT, projectIds: ['p-1', 'p-2'] }, CTX, 'multiple-projects'],
    ['an unresolved cost account', INPUT, { ...CTX, costAccountId: null }, 'project-unlinked'],
  ] as const)('%s', async (_n, input, ctx, message) => {
    const r = rig({ input, ctx });
    await expect(r.adapter.commit(create())).rejects.toMatchObject({ code: 'commit-rejected', message });
    expect(r.fake.calls).toEqual([]);
  });
});

describe('the adapter refuses what P3 does not push', () => {
  it.each([['goods-receipt'], ['purchase-invoice'], ['payment'], ['rfq']])('%s create is not available yet', async (kind) => {
    const r = rig();
    await expect(r.adapter.commit(create({ erp_doc_kind: kind }))).rejects.toMatchObject({ code: 'commit-rejected' });
    expect(r.fake.calls).toEqual([]);
  });
  it('owns procurement, refuses delete and other domains, and has no reads yet', async () => {
    const r = rig();
    expect([...r.adapter.capabilityMap]).toEqual(['procurement']);
    expect(r.adapter.tier).toBe('odoo');
    await expect(r.adapter.commit({ ...create(), operation: 'delete' })).rejects.toMatchObject({ code: 'commit-rejected' });
    await expect(r.adapter.commit({ ...create(), domain: 'companies' })).rejects.toMatchObject({ code: 'commit-rejected' });
  });
});

describe('AC-OPP-016 / AC-OPP-017 revising a pushed order edits it in place, once', () => {
  const REV_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-000000000002';
  const revise = (revision: number): AdapterCommand => ({
    domain: 'procurement', operation: 'revise' as never, idempotencyKey: `k-rev-${revision}`,
    record: { id: `${REV_ID.slice(0, -1)}${revision}`, erp_doc_kind: 'purchase-order', poId: PO_ID, revision },
  });
  const target = (a: string, b: string): ReviseLine[] => [{ itemRef: 'Cable tray', quantity: a, rate: '10.00', unit: '' }, { itemRef: 'Bolt', quantity: b, rate: '5.00', unit: '' }];
  const pushed = async () => {
    const r = rig();
    await r.attempt();
    r.state.orderId = r.fake.rows('purchase.order')[0].id;
    return r;
  };
  const writes = (r: ReturnType<typeof rig>) => r.count('purchase.order', 'write');

  it('raises one line and lowers another: applied once, Odoo total read back, the PMO order id is the canonical id', async () => {
    const r = await pushed();
    r.state.lines = target('6.000', '1.000');
    const result = await r.adapter.commit(revise(2));
    expect(r.fake.rows('purchase.order.line').map((l) => l.product_qty)).toEqual([6, 1]);
    expect(r.fake.rows('purchase.order')).toHaveLength(1);
    expect(r.fake.rows('purchase.order')[0].state).toBe('purchase');
    expect(result.canonical).toMatchObject({ id: PO_ID, amount: '65.00', erp_docstatus: 1 });
    expect(result.externalRecordId).toBe(`purchase.order:${r.state.orderId}`);
    expect(r.fake.rows('ir.model.data').map((d) => d.name)).toContain(`porev_${PO_ID.replaceAll('-', '_')}_2`);
  });

  it('a replay of the same revision writes nothing', async () => {
    const r = await pushed();
    r.state.lines = target('6.000', '1.000');
    await r.adapter.commit(revise(2));
    const before = writes(r);
    const again = await r.adapter.commit(revise(2));
    expect(writes(r)).toBe(before);
    expect(again.canonical).toMatchObject({ amount: '65.00' });
  });

  it('a recovery probe finds an applied revision and adopts it with the read-back', async () => {
    const r = await pushed();
    r.state.lines = target('6.000', '1.000');
    await r.adapter.commit(revise(2));
    expect(await recoverRevise(r.call, revise(2).record)).toMatchObject({ canonical: { id: PO_ID, amount: '65.00' } });
    expect(await recoverRevise(r.call, revise(3).record)).toBeNull();
  });

  it('a failure after the write and before the identifier: the retry writes nothing again and anchors', async () => {
    const r = await pushed();
    r.state.lines = target('6.000', '1.000');
    r.arm('ir.model.data', 'create', 'transport');
    await expect(r.adapter.commit(revise(2))).rejects.toMatchObject({ code: 'external-unreachable' });
    expect(writes(r)).toBe(1);
    await r.adapter.commit(revise(2));
    expect(writes(r)).toBe(1);
    expect(r.fake.rows('ir.model.data')).toHaveLength(2);
  });

  it('I2 an older revision replayed after a newer one applied is held and rolls no line back', async () => {
    const r = await pushed();
    r.state.lines = target('9.000', '3.000');
    await r.adapter.commit(revise(3));   // revision 2's write was lost; revision 3 applied
    const linesAt3 = r.fake.rows('purchase.order.line').map((l) => [l.product_qty, l.price_unit]);
    const before = writes(r);
    r.state.lines = target('6.000', '1.000');
    await expect(r.adapter.commit(revise(2))).rejects.toMatchObject({ code: 'commit-rejected', message: 'revision-superseded' });
    await expect(recoverRevise(r.call, revise(2).record)).rejects.toMatchObject({ message: 'revision-superseded' });
    expect(writes(r)).toBe(before);
    expect(r.fake.rows('purchase.order.line').map((l) => [l.product_qty, l.price_unit])).toEqual(linesAt3);
    expect(r.fake.rows('ir.model.data').map((d) => d.name)).not.toContain(`porev_${PO_ID.replaceAll('-', '_')}_2`);
  });

  it('I2 a newer revision still applies after an older one (the guard only looks upward)', async () => {
    const r = await pushed();
    r.state.lines = target('6.000', '1.000');
    await r.adapter.commit(revise(2));
    r.state.lines = target('7.000', '1.000');
    await r.adapter.commit(revise(3));
    expect(r.fake.rows('purchase.order.line').map((l) => l.product_qty)).toEqual([7, 1]);
  });

  it('refuses a quantity below what was received with no write; a lower revision above it applies', async () => {
    const r = await pushed();
    r.fake.rows('purchase.order.line')[0].qty_received = 2;
    r.state.lines = target('1.000', '2.000');
    await expect(r.adapter.commit(revise(3))).rejects.toMatchObject({ code: 'commit-rejected', message: 'below-received: Cable tray' });
    expect(writes(r)).toBe(0);
    r.state.lines = target('2.000', '2.000');
    await r.adapter.commit(revise(4));
    expect(writes(r)).toBe(1);
  });

  it('refuses a cancelled or done order with no write, and never cancels anything even when billed', async () => {
    const r = await pushed();
    r.fake.rows('purchase.order.line')[0].qty_invoiced = 4;
    r.state.lines = target('5.000', '2.000');
    await r.adapter.commit(revise(2));
    for (const state of ['cancel', 'done']) {
      r.fake.rows('purchase.order')[0].state = state;
      r.state.lines = target('7.000', '2.000');
      await expect(r.adapter.commit(revise(5))).rejects.toMatchObject({ code: 'commit-rejected', message: `order-${state}` });
    }
    expect(writes(r)).toBe(1);
    expect(r.fake.calls.filter((c) => /cancel|unlink/.test(c.method))).toEqual([]);
  });
});
