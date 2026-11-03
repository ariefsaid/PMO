import { describe, expect, it } from 'vitest';
import type { AdapterCommand, PmoRecord } from '../contract.ts';
import { bindCall } from './client.ts';
import { createFakeOdoo } from './fakeOdoo.ts';
import type { OrderCtx, OrderInput } from './purchase/orderBody.ts';
import { planReceipt, receiptDigest, type OrderLineQty, type ReceiptLineInput, type ReceiptPlan } from './purchase/receiptBody.ts';
import { createOdooProcurementAdapter, recoverOrder, recoverReceipt } from './procurementAdapter.ts';

const PO_ID = '123e4567-e89b-12d3-a456-426614174000';
const GR_ID = '223e4567-e89b-12d3-a456-426614174000';
const INPUT: OrderInput = {
  vendor: 'Vendor:9', caseNumber: 'PRC-001', vendorReference: 'PO-77', expectedDate: '2026-12-01', projectIds: ['p-1'],
  lines: [{ name: 'Cable', quantity: 10, rate: 10 }, { name: 'Bolt', quantity: 4, rate: 5 }],
};
const ITEMS = { Cable: '55', Bolt: '56' };
const CTX: OrderCtx = { companyId: 1, currencyId: 12, itemMap: ITEMS, unitMap: {}, costAccountId: '101', taxIds: [] };

type Armed = { model: string; method: string; fault: 'transport' | 'lost-response' };
/** A confirmed order for Cable 10 and Bolt 4 on a fake Odoo, plus a way to fail the next matching call. */
async function rig() {
  const fake = createFakeOdoo({ key: 'k' });
  let armed: Armed | null = null;
  let answer: { model: string; method: string; body: unknown } | null = null;
  let after: { model: string; method: string; run: () => void } | null = null;
  const fetchImpl = (async (url: string, init?: RequestInit) => {
    const [model, method] = String(url).split('/').slice(-2);
    if (after && after.model === model && after.method === method) { const hook = after; after = null; const res = await fake.fetch(url, init); hook.run(); return res; }
    if (answer && answer.model === model && answer.method === method) { fake.calls.push({ model, method }); return Response.json(answer.body); }
    if (armed && armed.model === model && armed.method === method) { fake.failNext(armed.fault); armed = null; }
    return fake.fetch(url, init);
  }) as typeof fetch;
  const call = bindCall({ baseUrl: 'https://odoo.example.test', apiKey: 'k', database: 'db1', fetchImpl });
  const adapter = createOdooProcurementAdapter({
    call, resolveOrder: async () => ({ input: INPUT, ctx: CTX }), resolveRevise: async () => { throw new Error('unused'); }, resolveBill: async () => { throw new Error('unused'); },
  });
  const order = await recoverOrder(call, { id: PO_ID }) ?? await adapter.commit({
    domain: 'procurement', operation: 'create', idempotencyKey: 'k-po',
    record: { id: PO_ID, erp_doc_kind: 'purchase-order', procurementId: 'case-1', amount: '90.00' },
  });
  const orderRef = order.externalRecordId;
  const orderId = Number(String(orderRef).split(':').pop());   // the Odoo id, whatever shape the ref has
  const orderLines = (): OrderLineQty[] => fake.rows('purchase.order.line').map((l) => ({ id: l.id, productId: Number(l.product_id), ordered: Number(l.product_qty), received: Number(l.qty_received ?? 0) }));
  const plan = (wanted?: ReceiptLineInput[]) => planReceipt(orderId, orderLines(), wanted, ITEMS);
  const receipt = (p: ReceiptPlan, over: Partial<PmoRecord> = {}): AdapterCommand => ({
    domain: 'procurement', operation: 'create', idempotencyKey: 'k-gr',
    record: { id: GR_ID, erp_doc_kind: 'goods-receipt', procurementId: 'case-1', receiptDate: '2026-12-02', odooReceipt: p, receiptDigest: p.digest, ...over },
  });
  /** What `dispatchMoneyWrite` does on every claim: the recovery probe first, the adapter only when it found nothing. */
  const attempt = async (cmd: AdapterCommand) => (await recoverReceipt(call, cmd.record)) ?? adapter.commit(cmd);
  const count = (model: string, method: string) => fake.calls.filter((c) => c.model === model && c.method === method).length;
  const onHand = (productId: number) => Number(fake.rows('stock.quant').find((q) => Number(q.product_id) === productId)?.quantity ?? 0);
  const done = () => fake.rows('stock.picking').filter((p) => p.state === 'done');
  return {
    fake, call, adapter, orderId, orderRef, plan, receipt, attempt, count, onHand, done, orderLines,
    arm: (model: string, method: string, fault: Armed['fault']) => { armed = { model, method, fault }; },
    answerWith: (model: string, method: string, body: unknown) => { answer = { model, method, body }; },
    afterNext: (model: string, method: string, run: () => void) => { after = { model, method, run }; },
  };
}

describe('AC-OPP-030 a receipt validates the order\'s transfer for the quantities entered and reads Odoo\'s booking back', () => {
  it('books 6 of 10 and 4 of 4: stock rose by 6 and 4, the canonical carries what Odoo booked beside what was entered', async () => {
    const r = await rig();
    const p = await r.plan([{ itemRef: 'Cable', quantity: 6 }, { itemRef: 'Bolt', quantity: 4 }]);
    const result = await r.attempt(r.receipt(p));
    expect(r.onHand(55)).toBe(6);
    expect(r.onHand(56)).toBe(4);
    const [picking] = r.done();
    expect(result.externalRecordId).toBe(`stock.picking:${picking.id}`);
    expect(result.canonical).toMatchObject({
      id: GR_ID, gr_number: picking.name, po_id: r.orderRef, erp_docstatus: 1, erp_modified: picking.write_date, odoo_receipt_status: 'Partial',
    });
    const lineOf = (product: number) => r.orderLines().find((l) => l.productId === product)!.id;
    expect(result.canonical.odoo_booked).toEqual([{ lineId: lineOf(55), productId: 55, quantity: 6 }, { lineId: lineOf(56), productId: 56, quantity: 4 }]);
    expect(result.canonical.odoo_entered).toEqual([{ lineId: lineOf(55), productId: 55, quantity: 6 }, { lineId: lineOf(56), productId: 56, quantity: 4 }]);
    expect(r.fake.rows('ir.model.data').filter((d) => d.model === 'stock.picking')).toEqual([expect.objectContaining({ module: 'pmo', res_id: picking.id })]);
  });
});

describe('AC-OPP-031 a partial receipt leaves the remainder on a backorder and a later one completes it', () => {
  it('6 of 10 then 4: the first is Partial with 4 open on a backorder, the second completes the order', async () => {
    const r = await rig();
    const first = await r.attempt(r.receipt(await r.plan([{ itemRef: 'Cable', quantity: 6 }, { itemRef: 'Bolt', quantity: 4 }])));
    expect(first.canonical).toMatchObject({ odoo_receipt_status: 'Partial' });
    const open = r.fake.rows('stock.picking').filter((p) => p.state !== 'done');
    expect(open).toHaveLength(1);
    expect(open[0]).toMatchObject({ backorder_id: Number(String(first.externalRecordId).split(':')[1]) });
    expect(r.count('stock.backorder.confirmation', 'process')).toBe(1);

    const GR2 = '323e4567-e89b-12d3-a456-426614174000';
    const second = await r.attempt(r.receipt(await r.plan([{ itemRef: 'Cable', quantity: 4 }]), { id: GR2 }));
    expect(r.onHand(55)).toBe(10);
    expect(r.onHand(56)).toBe(4);
    expect(second.canonical).toMatchObject({ odoo_receipt_status: 'Complete', id: GR2 });
    expect(r.fake.rows('stock.picking').filter((p) => p.state !== 'done')).toHaveLength(0);
  });

  it('a receipt with no lines entered receives everything open, with no wizard', async () => {
    const r = await rig();
    const result = await r.attempt(r.receipt(await r.plan()));
    expect(r.onHand(55)).toBe(10);
    expect(r.count('stock.backorder.confirmation', 'process')).toBe(0);
    expect(result.canonical).toMatchObject({ odoo_receipt_status: 'Complete' });
  });

  it('11 of 10 is refused before any write: Odoo is only read', async () => {
    const r = await rig();
    const before = r.fake.calls.length;
    await expect(r.plan([{ itemRef: 'Cable', quantity: 11 }])).rejects.toMatchObject({ code: 'commit-rejected', message: 'over-receipt: Cable' });
    expect(r.fake.calls.length).toBe(before);
    expect(r.onHand(55)).toBe(0);
  });

  it('a plan that asks for more than the transfer still holds open (stale plan) is refused with no write', async () => {
    const r = await rig();
    const p = await r.plan([{ itemRef: 'Cable', quantity: 6 }]);
    r.fake.rows('stock.move').find((m) => Number(m.product_id) === 55)!.product_uom_qty = 5;   // the demand shrank in Odoo after planning
    await expect(r.attempt(r.receipt(p))).rejects.toMatchObject({ code: 'commit-rejected', message: 'over-receipt: transfer' });
    expect(r.count('stock.picking', 'button_validate')).toBe(0);
    expect(r.onHand(55)).toBe(0);
  });
});

describe('AC-OPP-031b a wizard stock calls cannot complete makes the receipt unavailable, never worked around', () => {
  it('an unknown follow-up wizard is refused with the named reason and nothing is booked', async () => {
    const r = await rig();
    r.answerWith('stock.picking', 'button_validate', { type: 'ir.actions.act_window', res_model: 'stock.immediate.transfer', context: {} });
    await expect(r.attempt(r.receipt(await r.plan([{ itemRef: 'Cable', quantity: 6 }])))).rejects.toMatchObject({ code: 'commit-rejected', message: 'receipt-unavailable' });
    expect(r.onHand(55)).toBe(0);
    expect(r.count('stock.backorder.confirmation', 'create')).toBe(0);
  });
});

describe('AC-OPP-032 a retry after a lost response books nothing twice; different quantities hold', () => {
  const partial = [{ itemRef: 'Cable', quantity: 2 }];

  it('lost response on the wizard step: the retry adopts the done transfer and stock moved once', async () => {
    const r = await rig();
    const cmd = r.receipt(await r.plan(partial));
    r.arm('stock.backorder.confirmation', 'process', 'lost-response');
    await expect(r.attempt(cmd)).rejects.toMatchObject({ code: 'external-unreachable' });
    expect(r.onHand(55)).toBe(2);
    const result = await r.attempt(cmd);
    expect(r.onHand(55)).toBe(2);
    expect(r.done()).toHaveLength(1);
    expect(r.count('stock.picking', 'button_validate')).toBe(1);
    expect(result.externalRecordId).toBe(`stock.picking:${r.done()[0].id}`);
    expect(result.canonical).toMatchObject({ id: GR_ID, odoo_receipt_status: 'Partial' });
  });

  it('lost response on a full validate (no wizard): the retry adopts it', async () => {
    const r = await rig();
    const cmd = r.receipt(await r.plan());
    r.arm('stock.picking', 'button_validate', 'lost-response');
    await expect(r.attempt(cmd)).rejects.toMatchObject({ code: 'external-unreachable' });
    await r.attempt(cmd);
    expect(r.onHand(55)).toBe(10);
    expect(r.count('stock.picking', 'button_validate')).toBe(1);
  });

  it('a repeat of a finished command is a plain adoption', async () => {
    const r = await rig();
    const cmd = r.receipt(await r.plan(partial));
    const first = await r.attempt(cmd);
    const again = await r.attempt(cmd);
    expect(again.externalRecordId).toBe(first.externalRecordId);
    expect(r.onHand(55)).toBe(2);
    expect(r.count('stock.picking', 'button_validate')).toBe(1);
  });

  it('a failure before the validate books nothing; the retry finishes the same transfer once', async () => {
    const r = await rig();
    const cmd = r.receipt(await r.plan(partial));
    r.arm('stock.picking', 'button_validate', 'transport');
    await expect(r.attempt(cmd)).rejects.toMatchObject({ code: 'external-unreachable' });
    expect(r.onHand(55)).toBe(0);
    await r.attempt(cmd);
    expect(r.onHand(55)).toBe(2);
    expect(r.fake.rows('ir.model.data').filter((d) => d.model === 'stock.picking')).toHaveLength(1);
  });

  it('a failure writing the anchor books nothing; the retry anchors and books once', async () => {
    const r = await rig();
    const cmd = r.receipt(await r.plan(partial));
    r.arm('ir.model.data', 'create', 'lost-response');
    await expect(r.attempt(cmd)).rejects.toMatchObject({ code: 'external-unreachable' });
    expect(r.onHand(55)).toBe(0);
    await r.attempt(cmd);
    expect(r.onHand(55)).toBe(2);
    expect(r.fake.rows('ir.model.data').filter((d) => d.model === 'stock.picking')).toHaveLength(1);
  });

  it('different quantities after the validate hold: nothing is booked again and nothing is adopted', async () => {
    const r = await rig();
    const cmd = r.receipt(await r.plan(partial));
    r.arm('stock.backorder.confirmation', 'process', 'lost-response');
    await expect(r.attempt(cmd)).rejects.toMatchObject({ code: 'external-unreachable' });
    const lines = (cmd.record.odooReceipt as ReceiptPlan).lines.map((l) => ({ ...l, quantity: l.quantity ? 3 : 0 }));   // 3 where 2 was booked
    const digest = await receiptDigest(lines);
    const other = r.receipt({ ...(cmd.record.odooReceipt as ReceiptPlan), lines, digest }, { receiptDigest: digest });
    await expect(r.attempt(other)).rejects.toMatchObject({ code: 'commit-rejected', message: 'receipt-held' });
    expect(r.onHand(55)).toBe(2);
    expect(r.count('stock.picking', 'button_validate')).toBe(1);
  });

  it('Odoo received more behind our back: the command holds instead of booking on top', async () => {
    const r = await rig();
    const cmd = r.receipt(await r.plan(partial));
    r.fake.rows('purchase.order.line').find((l) => Number(l.product_id) === 55)!.qty_received = 1;   // a warehouse clerk validated 1 in Odoo
    await expect(r.attempt(cmd)).rejects.toMatchObject({ code: 'commit-rejected', message: 'receipt-held' });
    expect(r.count('stock.picking', 'button_validate')).toBe(0);
  });

  it('the cumulative quantities reached with no anchor to prove them ours also hold (never adopted blind)', async () => {
    const r = await rig();
    const cmd = r.receipt(await r.plan(partial));
    r.fake.rows('purchase.order.line').find((l) => Number(l.product_id) === 55)!.qty_received = 2;
    await expect(r.attempt(cmd)).rejects.toMatchObject({ code: 'commit-rejected', message: 'receipt-held' });
    expect(r.count('stock.picking', 'button_validate')).toBe(0);
  });

  it('a retry of an earlier receipt after a later one was validated still adopts its own transfer, books nothing', async () => {
    const r = await rig();
    const first = r.receipt(await r.plan(partial));
    const done = await r.attempt(first);
    const GR2 = '323e4567-e89b-12d3-a456-426614174000';
    await r.attempt(r.receipt(await r.plan([{ itemRef: 'Cable', quantity: 3 }]), { id: GR2 }));
    expect(r.onHand(55)).toBe(5);
    const again = await r.attempt(first);
    expect(again.externalRecordId).toBe(done.externalRecordId);
    expect(r.onHand(55)).toBe(5);
    expect(r.count('stock.picking', 'button_validate')).toBe(2);
  });

  it('another writer changing the quantity between our write and the validate is a conflict: nothing is validated', async () => {
    const r = await rig();
    const cmd = r.receipt(await r.plan(partial));
    r.afterNext('stock.move', 'write', () => { r.fake.rows('stock.move').find((m) => Number(m.product_id) === 55)!.quantity = 3; });
    await expect(r.attempt(cmd)).rejects.toMatchObject({ code: 'commit-rejected', message: 'receipt-conflict' });
    expect(r.count('stock.picking', 'button_validate')).toBe(0);
    expect(r.onHand(55)).toBe(0);
  });

  it('two open transfers on the order are ambiguous: refused with no write', async () => {
    const r = await rig();
    const cmd = r.receipt(await r.plan(partial));
    r.fake.seed('stock.picking', [{ id: 9000, state: 'assigned', purchase_id: r.orderId, picking_type_code: 'incoming', move_ids: [] }]);
    await expect(r.attempt(cmd)).rejects.toMatchObject({ code: 'commit-rejected', message: 'receipt-ambiguous-transfer' });
    expect(r.onHand(55)).toBe(0);
  });

  it('a fully received order has no open transfer: refused, nothing validated', async () => {
    const r = await rig();
    await r.attempt(r.receipt(await r.plan()));
    const GR2 = '323e4567-e89b-12d3-a456-426614174000';
    const stale = await planReceipt(r.orderId, r.orderLines().map((l) => ({ ...l, received: 0 })), undefined, ITEMS);
    await expect(r.attempt(r.receipt(stale, { id: GR2 }))).rejects.toMatchObject({ code: 'commit-rejected', message: 'receipt-held' });
    expect(r.onHand(55)).toBe(10);
  });
});

describe('the receipt command is checked before it is trusted', () => {
  it('refuses a command with no plan, a malformed plan or a bad receipt id, with no Odoo call', async () => {
    const r = await rig();
    const calls = r.fake.calls.length;
    const p = await r.plan();
    await expect(r.attempt(r.receipt(p, { odooReceipt: undefined }))).rejects.toMatchObject({ message: 'receipt-plan-invalid' });
    await expect(r.attempt(r.receipt(p, { odooReceipt: { ...p, digest: 'not hex' } }))).rejects.toMatchObject({ message: 'receipt-plan-invalid' });
    await expect(r.attempt(r.receipt(p, { id: 'not-a-uuid' }))).rejects.toMatchObject({ message: 'receipt-plan-invalid' });
    expect(r.fake.calls.length).toBe(calls);
  });

  it('refuses a receipt revise/update: only a create exists', async () => {
    const r = await rig();
    const cmd = { ...r.receipt(await r.plan()), operation: 'update' as const };
    await expect(r.adapter.commit(cmd)).rejects.toMatchObject({ code: 'commit-rejected' });
  });
});

describe('#1505 P4 review: ids are per Odoo model, and one transfer belongs to one receipt', () => {
  const partial = [{ itemRef: 'Cable', quantity: 2 }];
  const GR2 = '323e4567-e89b-12d3-a456-426614174000';
  const anchorsOn = (r: Awaited<ReturnType<typeof rig>>, pickingId: number) => r.fake.rows('ir.model.data').filter((d) => d.model === 'stock.picking' && d.res_id === pickingId);

  it('C1: an order and its transfer with the SAME Odoo id get distinct, model-qualified refs, so the unique external ref never collides', async () => {
    const r = await rig();
    const result = await r.attempt(r.receipt(await r.plan()));
    const [picking] = r.done();
    expect(picking.id).toBe(r.orderId);   // purchase.order 1 and stock.picking 1: what Odoo does, and what a shared id sequence hid
    expect(r.orderRef).toBe(`purchase.order:${r.orderId}`);
    expect(result.externalRecordId).toBe(`stock.picking:${picking.id}`);
    // external_refs is unique on (org, domain, external_record_id): both kinds are written under domain `procurement`
    const refs = new Set<string>();
    for (const ref of [r.orderRef, result.externalRecordId]) { expect(refs.has(ref)).toBe(false); refs.add(ref); }
    expect(result.canonical.po_id).toBe(r.orderRef);   // the mirror finds the PMO order by exactly the order's ref, never a transfer's
  });

  it('C1: the retry adopts the done transfer under the same qualified ref', async () => {
    const r = await rig();
    const cmd = r.receipt(await r.plan(partial));
    r.arm('stock.backorder.confirmation', 'process', 'lost-response');
    await expect(r.attempt(cmd)).rejects.toMatchObject({ code: 'external-unreachable' });
    const again = await r.attempt(cmd);
    expect(again.externalRecordId).toBe(`stock.picking:${r.done()[0].id}`);
  });

  it('C2: a second receipt does not take the transfer the first one anchored; the first then books its own goods once', async () => {
    const r = await rig();
    const first = r.receipt(await r.plan(partial));
    r.arm('stock.picking', 'button_validate', 'transport');
    await expect(r.attempt(first)).rejects.toMatchObject({ code: 'external-unreachable' });
    const [anchored] = r.fake.rows('stock.picking');
    // the user records the same delivery again (a real second one, or a re-entry after the error)
    await expect(r.attempt(r.receipt(await r.plan(partial), { id: GR2 }))).rejects.toMatchObject({ code: 'commit-rejected', message: 'receipt-held' });
    expect(anchorsOn(r, Number(anchored.id))).toHaveLength(1);   // no second receipt identifier on the transfer
    expect(r.onHand(55)).toBe(0);
    const result = await r.attempt(first);
    expect(r.onHand(55)).toBe(2);
    expect(r.done()).toHaveLength(1);
    expect(result.externalRecordId).toBe(`stock.picking:${anchored.id}`);
  });

  it('C2: another receipt anchoring the same transfer between our check and our write is seen: both hold, nothing is validated', async () => {
    const r = await rig();
    const cmd = r.receipt(await r.plan(partial));
    r.afterNext('ir.model.data', 'create', () => r.fake.seed('ir.model.data', [{ module: 'pmo', name: `gr_${GR2.replaceAll('-', '_')}_abc123`, model: 'stock.picking', res_id: r.fake.rows('stock.picking')[0].id }]));
    await expect(r.attempt(cmd)).rejects.toMatchObject({ code: 'commit-rejected', message: 'receipt-held' });
    expect(r.count('stock.picking', 'button_validate')).toBe(0);
    expect(r.onHand(55)).toBe(0);
  });

  it('C2: a done transfer that also carries another receipt\'s identifier is never adopted', async () => {
    const r = await rig();
    const cmd = r.receipt(await r.plan(partial));
    await r.attempt(cmd);
    const [done] = r.done();
    r.fake.seed('ir.model.data', [{ module: 'pmo', name: `gr_${GR2.replaceAll('-', '_')}_abc123`, model: 'stock.picking', res_id: done.id }]);
    await expect(r.attempt(cmd)).rejects.toMatchObject({ code: 'commit-rejected', message: 'receipt-held' });
  });

  it('I1: our anchored transfer validated with OTHER quantities is held, not adopted as ours', async () => {
    const r = await rig();
    const cmd = r.receipt(await r.plan(partial));
    r.arm('stock.picking', 'button_validate', 'transport');
    await expect(r.attempt(cmd)).rejects.toMatchObject({ code: 'external-unreachable' });
    const [picking] = r.fake.rows('stock.picking');
    // a clerk in Odoo books 3 (not 2) of Cable on that transfer and validates it, backorder wizard included
    const move = r.fake.rows('stock.move').find((m) => Number(m.product_id) === 55)!;
    await r.call('stock.move', 'write', { ids: [move.id], vals: { quantity: 3 } });
    const context = { button_validate_picking_ids: [picking.id], default_pick_ids: [[4, picking.id]] };
    const [wizard] = await r.call<number[]>('stock.backorder.confirmation', 'create', { vals_list: [{}], context });
    await r.call('stock.backorder.confirmation', 'process', { ids: [wizard], context });
    expect(r.onHand(55)).toBe(3);
    await expect(r.attempt(cmd)).rejects.toMatchObject({ code: 'commit-rejected', message: 'receipt-held' });
  });
});
