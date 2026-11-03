/**
 * The Odoo `Adapter` (contract.ts) for domain `procurement` (PD-2, DD-OPP-1..3). P3 pushes the purchase order and its revision, P4 the
 * goods receipt, P5 the vendor bill and P6 the vendor payment (created, posted and reconciled to its bill). A command is a state machine over Odoo's state, not
 * a script (PD-3): find the document by its anchor, let `nextStep` pick the one missing call, perform it, read it back.
 *
 * P4 adds the goods receipt: Odoo itself opens the incoming transfer when the order is confirmed, so PMO mints no document; it
 * books quantities onto that transfer and validates it. The receipt's plan (what Odoo had received, what this receipt adds) is
 * fixed by dispatch before the first attempt and persisted with the outbox row, so a retry judges against the same numbers. The
 * transfer is anchored (stock external identifier) BEFORE the validate: a retry then finds the anchored transfer done and adopts
 * it. With no anchor, anything but "nothing of this receipt booked yet" is doubt and holds; a validate is never repeated blindly.
 *
 * The order is created, anchored (a stock external identifier written right after the create) and confirmed: three calls and
 * not one transaction. A crash between any two leaves a document the next attempt finds (by identifier, or by the composite
 * of vendor, untaxed amount, line count and window when the identifier was never written) and finishes. `recoverOrder` is that
 * finder-and-finisher; adapter-dispatch runs it as the outbox recovery probe on every claim, so the adapter itself only
 * creates when nothing exists. Odoo's own approval wait ("to approve") is reported, never approved around (OQ-OPP-5).
 */
import { AdapterError, type Adapter, type AdapterCommand, type CommandResult, type PmoRecord } from '../contract.ts';
import { mirrorMoney } from '../erpnext/moneyShape.ts';
import type { OdooCall } from './client.ts';
import { ODOO_TIER, toAdapterError } from './connectAdapter.ts';
import { externalIdentifier, odooExternalRef, parseOdooExternalRef } from './purchase/anchors.ts';
import { nextStep } from './purchase/nextStep.ts';
import { poReviseRecoveryDecision, purchaseOrderReviseKey } from '../purchaseOrderRevise.ts';
import { buildBillBody, expectedBillTotal, type BillCtx, type BillInput } from './purchase/billBody.ts';
import { readBackBill, type BillExpect } from './purchase/billReadBack.ts';
import { buildOrderBody, plannedAt, type OrderCtx, type OrderInput } from './purchase/orderBody.ts';
import { planRevise, type CurrentLine, type ReviseLine } from './purchase/orderRevise.ts';
import { probeOdooByAnchor, type BillComposite, type OrderComposite, type PaymentComposite } from './purchase/recoveryProbe.ts';
import { buildPaymentBody, type PaymentCtx } from './purchase/paymentBody.ts';
import { observeReceipt, parseReceiptPlan, receivedStatus, type OrderLineQty, type ReceiptPlan } from './purchase/receiptBody.ts';

export const PROCUREMENT_DOMAIN = 'procurement';
const ORDER_MODEL = 'purchase.order';
const PICKING_MODEL = 'stock.picking';

export interface OdooProcurementDeps {
  call: OdooCall;
  /** The command's PMO-side facts (vendor, lines, project's cost account), resolved before any write. */
  resolveOrder(command: AdapterCommand): Promise<{ input: OrderInput; ctx: OrderCtx }>;
  /** A revision's target: the Odoo order the PMO order maps to and the revision's effective line set. */
  resolveRevise(command: AdapterCommand): Promise<{ orderId: number; lines: readonly ReviseLine[]; ctx: OrderCtx }>;
  /** A bill's PMO-side facts: vendor, lines (with the order-line link when the bill names an order), project's cost account and the validated taxes. */
  resolveBill(command: AdapterCommand): Promise<{ input: BillInput; ctx: BillCtx }>;
  /** A payment's PMO-side facts (the bill's Odoo reference, amount, vendor, journal), resolved before any write; absent where payments are not wired. */
  resolvePayment?(command: AdapterCommand): Promise<PaymentFacts>;
}

const refuse = (reason: string): never => { throw new AdapterError('commit-rejected', reason); };

/** Odoo failures become contract errors (transient vs rejected); the message is the class, never Odoo's text. */
const guarded = (call: OdooCall): OdooCall => async (model, method, body) => {
  try { return await call(model, method, body); } catch (err) { return toAdapterError(err); }
};

export const orderKey = (record: PmoRecord): string => `po:${record.id}`;

interface OrderRow { name: string; state: string; amount_total: number | string; write_date: string }
const ORDER_FIELDS = ['name', 'state', 'amount_total', 'write_date'];

/** The PMO `purchase_orders` mirror derives its status from a docstatus-shaped number: 1 issued, 2 closed, anything else not yet. */
const docstatusOf = (state: string): number => (state === 'purchase' || state === 'done' ? 1 : state === 'cancel' ? 2 : 0);

function orderCanonical(order: OrderRow, record: PmoRecord, pmoId: string): PmoRecord {
  return {
    id: pmoId,
    po_number: order.name,
    amount: mirrorMoney(order.amount_total),   // Odoo's figure is the oracle (ADR-0048) ...
    pmo_amount: record.amount == null ? null : mirrorMoney(record.amount as string | number),   // ... and the entered one stays beside it
    erp_docstatus: docstatusOf(order.state),
    erp_modified: order.write_date,
    erp_amended_from: null,
    ...(order.state === 'to approve' ? { odoo_outcome: 'pushed-not-approved' } : {}),
  };
}

const readOrder = async (call: OdooCall, id: number): Promise<OrderRow> =>
  (await call<OrderRow[]>('purchase.order', 'read', { ids: [id], fields: ORDER_FIELDS }))[0] ?? refuse('order-missing');

/** Confirm a draft, adopt a confirmed or waiting one, reject anything else; then read the order back. */
async function settleOrder(call: OdooCall, id: number, record: PmoRecord): Promise<CommandResult> {
  let order = await readOrder(call, id);
  let step = nextStep('order', { state: order.state, anchor: 'ours' });
  if (step === 'confirm') {
    await call('purchase.order', 'button_confirm', { ids: [id] });
    order = await readOrder(call, id);
    step = nextStep('order', { state: order.state, anchor: 'ours' });
  }
  if (step !== 'adopt') return refuse(`order-${order.state}`);
  return { externalRecordId: odooExternalRef(ORDER_MODEL, id), canonical: orderCanonical(order, record, String(record.id)) };
}

const ANCHORED_MODEL = { order: 'purchase.order', bill: 'account.move' } as const;

/** Write the stock external identifier that anchors the document; one already there for this document is left alone. */
async function anchorDocument(call: OdooCall, kind: keyof typeof ANCHORED_MODEL, key: string, id: number): Promise<void> {
  const hit = await probeOdooByAnchor(call, kind, key);
  if (hit) { if (hit.externalRecordId !== odooExternalRef(ANCHORED_MODEL[kind], id)) refuse('ambiguous-anchor'); return; }
  const { module, name } = externalIdentifier(key);
  await call('ir.model.data', 'create', { vals_list: [{ module, name, model: ANCHORED_MODEL[kind], res_id: id }] });
}
const anchorOrder = (call: OdooCall, key: string, id: number) => anchorDocument(call, 'order', key, id);

/**
 * The recovery probe for an order (FR-OPP-072): the order this command already created, anchored if need be and brought to its
 * settled state, or null when nothing was created. Throws (the row is held) when the composite finds doubt.
 */
export async function recoverOrder(rawCall: OdooCall, record: PmoRecord, composite?: OrderComposite): Promise<CommandResult | null> {
  const call = guarded(rawCall);
  const key = orderKey(record);
  const hit = await probeOdooByAnchor(call, 'order', key, composite);
  if (!hit) return null;
  const id = parseOdooExternalRef(ORDER_MODEL, hit.externalRecordId) ?? refuse('ambiguous-anchor');
  await anchorOrder(call, key, id);
  return settleOrder(call, id, record);
}

/** `porev:<po id>:<revision>`: the identifier that marks a revision as applied to the Odoo order. */
function reviseKey(record: PmoRecord): string {
  try { return purchaseOrderReviseKey(String(record.poId), Number(record.revision)); } catch { return refuse('revise-key-invalid'); }
}

/** The highest revision of this PMO order already marked as applied on its Odoo order, or 0. */
async function highestAppliedRevision(call: OdooCall, poId: string): Promise<{ revision: number; key: string }> {
  const prefix = `porev_${poId.replaceAll('-', '_')}_`;
  // ilike over-matches (`_` is a wildcard); the exact shape is checked here.
  const rows = await call<Array<{ name: string }>>('ir.model.data', 'search_read', {
    domain: [['module', '=', 'pmo'], ['model', '=', 'purchase.order'], ['name', 'ilike', prefix]], fields: ['name'], limit: 200,
  });
  let top = { revision: 0, key: '' };
  for (const { name } of rows) {
    const rest = typeof name === 'string' && name.startsWith(prefix) ? name.slice(prefix.length) : '';
    if (/^[1-9][0-9]{0,5}$/.test(rest) && Number(rest) > top.revision) top = { revision: Number(rest), key: `porev:${poId}:${rest}` };
  }
  return top;
}

/**
 * The recovery probe for a revision: an applied revision (its identifier exists) is adopted with the order read back. When it is
 * not applied but a NEWER revision of the same order is, repeating it would roll the lines back: the shipped seam's decision
 * (found another key -> held, AC-SCA-011) refuses it. Otherwise null.
 */
export async function recoverRevise(rawCall: OdooCall, record: PmoRecord): Promise<CommandResult | null> {
  const call = guarded(rawCall);
  const key = reviseKey(record);
  const hit = await probeOdooByAnchor(call, 'order', key);
  if (!hit) {
    const newer = await highestAppliedRevision(call, String(record.poId));
    if (newer.revision > Number(record.revision) && poReviseRecoveryDecision({ probe: 'found', key: newer.key, expectedKey: key }) !== 'adopt') refuse('revision-superseded');
    return null;
  }
  return { externalRecordId: hit.externalRecordId, canonical: orderCanonical(await readOrder(call, parseOdooExternalRef(ORDER_MODEL, hit.externalRecordId) ?? refuse('ambiguous-anchor')), record, String(record.poId)) };
}

async function reviseOrder(deps: OdooProcurementDeps, command: AdapterCommand): Promise<CommandResult> {
  const call = guarded(deps.call);
  const key = reviseKey(command.record);
  const { orderId, lines, ctx } = await deps.resolveRevise(command);
  const applied = await recoverRevise(call, command.record);
  if (applied) return applied.externalRecordId === odooExternalRef(ORDER_MODEL, orderId) ? applied : refuse('ambiguous-anchor');
  const order = await readOrder(call, orderId);
  const current = await call<CurrentLine[]>('purchase.order.line', 'search_read', {
    domain: [['order_id', '=', orderId]], fields: ['product_id', 'product_qty', 'price_unit', 'qty_received', 'qty_invoiced'],
  });
  const { commands } = planRevise(order, current, lines, ctx, plannedAt(null));   // refuses before any write
  if (commands.length) await call('purchase.order', 'write', { ids: [orderId], vals: { order_line: commands } });
  const { module, name } = externalIdentifier(key);
  await call('ir.model.data', 'create', { vals_list: [{ module, name, model: 'purchase.order', res_id: orderId }] });
  return { externalRecordId: odooExternalRef(ORDER_MODEL, orderId), canonical: orderCanonical(await readOrder(call, orderId), command.record, String(command.record.poId)) };
}

async function pushOrder(deps: OdooProcurementDeps, command: AdapterCommand): Promise<CommandResult> {
  const call = guarded(deps.call);
  const { input, ctx } = await deps.resolveOrder(command);
  const body = buildOrderBody(input, ctx);   // refuses before the first Odoo call
  const found = await recoverOrder(call, command.record);
  if (found) return found;
  if (nextStep('order', { absent: true, probe: 'conclusive' }) !== 'create') return refuse('order-held');
  const [id] = await call<number[]>('purchase.order', 'create', { vals_list: [body] });
  await anchorOrder(call, orderKey(command.record), id);
  return settleOrder(call, id, command.record);
}

// ── Goods receipt (P4) ─────────────────────────────────────────────────────────────────────────────────────────────────────

interface PickingRow { id?: number; name: string; state: string; move_ids: number[]; write_date: string }
interface MoveRow { id: number; state: string; product_id: unknown; purchase_line_id: unknown; product_uom_qty: number; quantity: number }
const idOf = (v: unknown): number => Number(Array.isArray(v) ? v[0] : v);
const q4 = (v: number) => Math.round(v * 1e4);
const BACKORDER_WIZARD = 'stock.backorder.confirmation';

/** The plan dispatch persisted, checked before it is trusted: shape, digest against its own lines, and a receipt key Odoo can anchor. */
async function receiptTarget(record: PmoRecord): Promise<{ plan: ReceiptPlan; key: string }> {
  const plan = await parseReceiptPlan(record.odooReceipt);
  if (!plan || record.receiptDigest !== plan.digest) return refuse('receipt-plan-invalid');
  const key = `gr:${String(record.id)}:${plan.digest}`;
  try { externalIdentifier(key); } catch { return refuse('receipt-plan-invalid'); }
  return { plan, key };
}

export async function readOrderLines(call: OdooCall, orderId: number): Promise<OrderLineQty[]> {
  const rows = await call<Array<{ id: number; product_id: unknown; product_qty: number; qty_received: number }>>('purchase.order.line', 'search_read', {
    domain: [['order_id', '=', orderId]], fields: ['product_id', 'product_qty', 'qty_received'], order: 'id asc',
  });
  return rows.filter((l) => l.product_id).map((l) => ({ id: l.id, productId: idOf(l.product_id), ordered: Number(l.product_qty), received: Number(l.qty_received ?? 0) }));
}

const readPicking = async (call: OdooCall, id: number): Promise<PickingRow> =>
  (await call<PickingRow[]>('stock.picking', 'read', { ids: [id], fields: ['name', 'state', 'move_ids', 'write_date'] }))[0] ?? refuse('receipt-transfer-missing');

const readMoves = (call: OdooCall, ids: number[]) =>
  ids.length ? call<MoveRow[]>('stock.move', 'read', { ids, fields: ['state', 'product_id', 'purchase_line_id', 'product_uom_qty', 'quantity'] }) : Promise.resolve([]);

/** The transfer as Odoo booked it, read back; the receipt is only adopted when it booked exactly what this receipt entered. */
async function receiptResult(call: OdooCall, picking: PickingRow, plan: ReceiptPlan, record: PmoRecord): Promise<CommandResult> {
  const moves = (await readMoves(call, picking.move_ids)).filter((m) => m.state === 'done');
  const booked = new Map<number, { productId: number; quantity: number }>();
  for (const m of moves) {
    const lineId = idOf(m.purchase_line_id);
    const prior = booked.get(lineId);
    booked.set(lineId, { productId: idOf(m.product_id), quantity: (prior?.quantity ?? 0) + Number(m.quantity) });
  }
  const entered = plan.lines.filter((l) => l.quantity > 0).map((l) => ({ lineId: l.lineId, productId: l.productId, quantity: l.quantity }));
  const bookedLines = [...booked].map(([lineId, b]) => ({ lineId, productId: b.productId, quantity: b.quantity })).sort((a, b) => a.lineId - b.lineId);
  const same = bookedLines.length === entered.length && entered.every((e, i) => bookedLines[i].lineId === e.lineId && q4(bookedLines[i].quantity) === q4(e.quantity));
  if (!same) return refuse('receipt-held');   // done, but not with this receipt's quantities: not ours to adopt
  return {
    externalRecordId: odooExternalRef(PICKING_MODEL, picking.id ?? 0),
    canonical: {
      id: String(record.id),
      gr_number: picking.name,
      po_id: odooExternalRef(ORDER_MODEL, plan.orderId),   // the ref the order was mapped under: the mirror resolves the PMO order by it
      erp_docstatus: 1,
      erp_modified: picking.write_date,
      odoo_receipt_status: receivedStatus(await readOrderLines(call, plan.orderId)),   // read from Odoo's quantities, never typed (FR-OPP-034)
      odoo_booked: bookedLines,
      odoo_entered: entered,
    },
  };
}

/** Another receipt's identifier on this transfer: a transfer belongs to the first receipt that anchored it (PMO writes no other identifier on a transfer). */
async function carriesOtherReceipt(call: OdooCall, key: string, id: number): Promise<boolean> {
  const own = externalIdentifier(key).name;
  const rows = await call<Array<{ name: string }>>('ir.model.data', 'search_read', {
    domain: [['module', '=', 'pmo'], ['model', '=', PICKING_MODEL], ['res_id', '=', id]], fields: ['name'], limit: 5,
  });
  return rows.some((r) => r.name !== own);
}

/**
 * Write the stock external identifier that anchors the transfer to this receipt; one already there for it is left alone. A
 * transfer another receipt anchored is held, never shared: a second receipt booking onto it would be adopted by the first.
 * ponytail: checked again after the write so two receipts racing for one open transfer both see each other and both hold.
 */
async function anchorTransfer(call: OdooCall, key: string, id: number): Promise<void> {
  if (await carriesOtherReceipt(call, key, id)) refuse('receipt-held');
  const hit = await probeOdooByAnchor(call, 'receipt', key);
  if (hit) { if (hit.externalRecordId !== odooExternalRef(PICKING_MODEL, id)) refuse('ambiguous-anchor'); return; }
  const { module, name } = externalIdentifier(key);
  await call('ir.model.data', 'create', { vals_list: [{ module, name, model: PICKING_MODEL, res_id: id }] });
  if (await carriesOtherReceipt(call, key, id)) refuse('receipt-held');
}

/**
 * The recovery probe for a receipt (FR-OPP-033, FR-OPP-072): the transfer this receipt already validated (adopted, read back),
 * an anchored transfer not yet validated or nothing booked yet (null: the adapter does the work), or doubt, which throws so the row
 * is held. Doubt is any other state of the order's received quantities: another receipt, a half-booked one, or the quantities of
 * this one with no anchor to say they are ours.
 */
export async function recoverReceipt(rawCall: OdooCall, record: PmoRecord): Promise<CommandResult | null> {
  const call = guarded(rawCall);
  const { plan, key } = await receiptTarget(record);
  const hit = await probeOdooByAnchor(call, 'receipt', key);
  if (hit) {
    const pickingId = parseOdooExternalRef(PICKING_MODEL, hit.externalRecordId) ?? refuse('ambiguous-anchor');
    if (await carriesOtherReceipt(call, key, pickingId)) return refuse('receipt-held');   // not ours alone: never adopted, never validated
    const picking = await readPicking(call, pickingId);
    picking.id = pickingId;
    const step = nextStep('receipt', { state: picking.state, anchor: 'ours' });
    if (step === 'adopt') return receiptResult(call, picking, plan, record);
    return step === 'validate' ? null : refuse('receipt-held');
  }
  return observeReceipt(plan, await readOrderLines(call, plan.orderId)) === 'absent' ? null : refuse('receipt-held');
}

/** Complete the stock wizard stock calls can complete (create the backorder); anything else is unavailable, never worked around. */
async function validateTransfer(call: OdooCall, id: number): Promise<void> {
  const result = await call<unknown>('stock.picking', 'button_validate', { ids: [id] });
  if (result === null || typeof result !== 'object') return;
  const { res_model: model, context } = result as { res_model?: unknown; context?: Record<string, unknown> };
  if (model !== BACKORDER_WIZARD) return refuse('receipt-unavailable');
  const [wizard] = await call<number[]>(BACKORDER_WIZARD, 'create', { vals_list: [{}], context });
  await call(BACKORDER_WIZARD, 'process', { ids: [wizard], context });
}

/** The done quantity per move this receipt sets: its quantity on a planned line, zero on any other (which stays open). */
function moveWrites(plan: ReceiptPlan, moves: readonly MoveRow[]): Array<{ moveId: number; quantity: number }> {
  const live = moves.filter((m) => m.state !== 'done' && m.state !== 'cancel');
  const byLine = new Map<number, MoveRow>();
  for (const m of live) {
    const lineId = idOf(m.purchase_line_id);
    if (!lineId || byLine.has(lineId)) refuse('receipt-ambiguous-transfer');
    byLine.set(lineId, m);
  }
  for (const l of plan.lines) {
    if (l.quantity <= 0) continue;
    const move = byLine.get(l.lineId) ?? refuse('receipt-line-not-in-transfer');
    if (q4(l.quantity) > q4(Number(move.product_uom_qty))) refuse('over-receipt: transfer');
  }
  return live.map((m) => ({ moveId: m.id, quantity: plan.lines.find((l) => l.lineId === idOf(m.purchase_line_id))?.quantity ?? 0 }));
}

async function pushReceipt(deps: OdooProcurementDeps, command: AdapterCommand): Promise<CommandResult> {
  const call = guarded(deps.call);
  const { plan, key } = await receiptTarget(command.record);
  const found = await recoverReceipt(call, command.record);
  if (found) return found;
  const open = await call<PickingRow[]>('stock.picking', 'search_read', {
    domain: [['purchase_id', '=', plan.orderId], ['picking_type_code', '=', 'incoming'], ['state', 'in', ['assigned', 'confirmed']]],
    fields: ['name', 'state', 'move_ids', 'write_date'], limit: 3,
  });
  if (open.length > 1) refuse('receipt-ambiguous-transfer');
  const picking = open[0] ?? refuse('receipt-no-open-transfer');
  const writes = moveWrites(plan, await readMoves(call, picking.move_ids));   // every refusal above is before the first write
  await anchorTransfer(call, key, picking.id!);
  for (const w of writes) await call('stock.move', 'write', { ids: [w.moveId], vals: { quantity: w.quantity } });
  // Another writer on the same open transfer (a second receipt, a clerk in Odoo) must not be validated with our number.
  const written = new Map((await readMoves(call, picking.move_ids)).map((m) => [m.id, q4(Number(m.quantity))]));
  if (writes.some((w) => written.get(w.moveId) !== q4(w.quantity))) refuse('receipt-conflict');
  await validateTransfer(call, picking.id!);
  const after = await readPicking(call, picking.id!);
  if (nextStep('receipt', { state: after.state, anchor: 'ours' }) !== 'adopt') return refuse(`receipt-${after.state}`);
  return receiptResult(call, { ...after, id: picking.id }, plan, command.record);
}

export const billKey = (record: PmoRecord): string => `bill:${record.id}`;

interface BillRow { name: string; state: string; move_type: string; amount_total?: number | string; amount_residual?: number | string; ref?: unknown; invoice_date?: unknown; currency_id?: unknown; write_date: string }
const BILL_FIELDS = ['name', 'state', 'move_type', 'amount_total', 'amount_residual', 'ref', 'invoice_date', 'currency_id', 'write_date'];

const readBill = async (call: OdooCall, id: number): Promise<BillRow> =>
  (await call<BillRow[]>('account.move', 'read', { ids: [id], fields: BILL_FIELDS }))[0] ?? refuse('bill-missing');

/** Post a draft, adopt a posted one, reject anything else; then read the bill's money and lines back (FR-OPP-041/043). */
async function settleBill(call: OdooCall, id: number, record: PmoRecord, expect: BillExpect): Promise<CommandResult> {
  let move = await readBill(call, id);
  if (move.move_type !== 'in_invoice') return refuse('bill-not-a-vendor-bill');
  let step = nextStep('bill', { state: move.state, anchor: 'ours' });
  if (step === 'post') {
    await call('account.move', 'action_post', { ids: [id] });
    move = await readBill(call, id);
    step = nextStep('bill', { state: move.state, anchor: 'ours' });
  }
  if (step !== 'adopt') return refuse(`bill-${move.state}`);
  const taxLines = await call<Array<{ balance?: number | string }>>('account.move.line', 'search_read', { domain: [['move_id', '=', id], ['tax_line_id', '!=', false]], fields: ['balance'] });
  const productLines = await call<Array<{ analytic_distribution?: unknown }>>('account.move.line', 'search_read', { domain: [['move_id', '=', id], ['display_type', '=', 'product']], fields: ['analytic_distribution'] });
  return { externalRecordId: odooExternalRef(ANCHORED_MODEL.bill, id), canonical: readBackBill(String(record.id), { move, taxLines, productLines }, expect) };
}

/**
 * The recovery probe for a vendor bill (FR-OPP-072, OQ-OPP-10): the bill this command already created, anchored if need be and
 * posted if still a draft, or null when nothing was created. Throws (the row is held) when the composite finds doubt. A bill is
 * never reissued on doubt: the outbox holds it (`odooReissueOnInconclusiveAbsence`).
 */
export async function recoverBill(rawCall: OdooCall, record: PmoRecord, composite: BillComposite | undefined, expect: BillExpect): Promise<CommandResult | null> {
  const call = guarded(rawCall);
  const key = billKey(record);
  const hit = await probeOdooByAnchor(call, 'bill', key, composite);
  if (!hit) return null;
  const id = parseOdooExternalRef(ANCHORED_MODEL.bill, hit.externalRecordId) ?? refuse('ambiguous-anchor');
  await anchorDocument(call, 'bill', key, id);
  return settleBill(call, id, record, expect);
}

async function pushBill(deps: OdooProcurementDeps, command: AdapterCommand): Promise<CommandResult> {
  const call = guarded(deps.call);
  const { input, ctx } = await deps.resolveBill(command);
  const body = buildBillBody(input, ctx);   // refuses before the first Odoo call
  const expect: BillExpect = { total: expectedBillTotal(input, ctx.taxes), costAccountId: ctx.costAccountId };
  const found = await recoverBill(call, command.record, undefined, expect);
  if (found) return found;
  if (nextStep('bill', { absent: true, probe: 'conclusive' }) !== 'create') return refuse('bill-held');
  const [id] = await call<number[]>('account.move', 'create', { vals_list: [body] });
  await anchorDocument(call, 'bill', billKey(command.record), id);
  return settleBill(call, id, command.record, expect);
}

// ── Vendor payment (P6) ────────────────────────────────────────────────────────────────────────────────────────────────────

const PAYMENT_MODEL = 'account.payment';
const PAID_STATES = new Set(['in_process', 'paid', 'reconciled', 'posted']);   // Odoo 20 says in_process or paid once a payment is posted, and reconciled once its bill is settled (bed, P6)

export const paymentKey = (record: PmoRecord): string => `pay:${record.id}`;

/** The PMO-side facts of a payment, resolved before any write: the bill's Odoo reference, what to pay, the vendor and the chosen journal. */
export interface PaymentFacts {
  billRef: string | null;
  amount: number | string;
  date?: string | null;
  vendorPartnerId?: number | null;
  journalId: number | null;
  companyCurrencyId: number;
}

interface PaymentRow { name: string; state: string; payment_type: string; partner_type: string; amount: number | string; move_id: unknown; reconciled_bill_ids?: unknown; write_date: string }
const PAYMENT_FIELDS = ['name', 'state', 'payment_type', 'partner_type', 'amount', 'move_id', 'reconciled_bill_ids', 'write_date'];

const readPayment = async (call: OdooCall, id: number): Promise<PaymentRow> =>
  (await call<PaymentRow[]>(PAYMENT_MODEL, 'read', { ids: [id], fields: PAYMENT_FIELDS }))[0] ?? refuse('payment-missing');

const cents = (v: unknown): number => Math.round(Number(v) * 100);
const reconciledBills = (p: PaymentRow): number[] => (Array.isArray(p.reconciled_bill_ids) ? p.reconciled_bill_ids.map(idOf) : []);

/** The bill and journal as Odoo has them now (read only): what `buildPaymentBody` judges the payment against. */
export async function readPaymentCtx(call: OdooCall, facts: PaymentFacts): Promise<PaymentCtx> {
  const billId = parseOdooExternalRef(ANCHORED_MODEL.bill, facts.billRef);
  const [row] = billId === null ? [] : await call<Array<{ state: string; move_type: string; amount_residual: number | string; currency_id: unknown; partner_id: unknown }>>(
    'account.move', 'read', { ids: [billId], fields: ['state', 'move_type', 'amount_residual', 'currency_id', 'partner_id'] });
  const bill = billId !== null && row
    ? { id: billId, state: row.state, moveType: row.move_type, residual: row.amount_residual, currencyId: row.currency_id ? idOf(row.currency_id) : null, partnerId: row.partner_id ? idOf(row.partner_id) : null }
    : null;
  let journal: PaymentCtx['journal'] = null;
  if (facts.journalId != null) {
    const [j] = await call<Array<{ type: string; active?: boolean; outbound_payment_method_line_ids?: unknown }>>('account.journal', 'read', { ids: [facts.journalId], fields: ['type', 'active', 'outbound_payment_method_line_ids'] });
    if (j) {
      if (!['bank', 'cash'].includes(j.type) || j.active === false) refuse('journal-invalid');
      const lines = Array.isArray(j.outbound_payment_method_line_ids) ? j.outbound_payment_method_line_ids : [];
      journal = { id: facts.journalId, methodLineId: lines.length ? idOf(lines[0]) : null };
    }
  }
  return { companyCurrencyId: facts.companyCurrencyId, journal, bill };
}

/** Reconcile the payment's payable line with the bill's (V-OPP7): one line on the payment, at least one open on the bill, or it is not ours to guess. */
async function reconcilePayment(call: OdooCall, payment: PaymentRow, billId: number): Promise<void> {
  const moveId = idOf(payment.move_id);
  const lines = await call<Array<{ id: number; move_id: unknown }>>('account.move.line', 'search_read', {
    domain: [['move_id', 'in', [billId, moveId]], ['account_type', '=', 'liability_payable'], ['reconciled', '=', false]], fields: ['move_id'],
  });
  const own = lines.filter((l) => idOf(l.move_id) === moveId);
  const bill = lines.filter((l) => idOf(l.move_id) === billId);
  if (own.length !== 1 || bill.length < 1) refuse('payment-reconcile-ambiguous');
  await call('account.move.line', 'reconcile', { ids: lines.map((l) => l.id) });
}

/** draft / posted, and whether Odoo shows it reconciled to THIS bill: the observation `nextStep('payment', …)` decides on. */
const paymentObserved = (p: PaymentRow, billId: number): string =>
  p.state === 'draft' ? 'draft' : PAID_STATES.has(p.state) ? (reconciledBills(p).includes(billId) ? 'reconciled' : 'posted-unreconciled') : p.state;

/**
 * Complete the payment Odoo already holds: post a draft, reconcile a posted one, adopt a reconciled one, hold anything else; then
 * read it and its bill back. Never creates. A payment that is not an outbound supplier payment of the entered amount is not ours to
 * adopt (the anchor is a memo anyone can edit), so it is refused before it is touched.
 */
async function settlePayment(call: OdooCall, id: number, record: PmoRecord, billRef: string): Promise<CommandResult> {
  const billId = parseOdooExternalRef(ANCHORED_MODEL.bill, billRef) ?? refuse('payment-bill-required');
  let payment = await readPayment(call, id);
  if (payment.payment_type !== 'outbound' || payment.partner_type !== 'supplier') refuse('payment-not-outbound');
  if (cents(payment.amount) !== cents(record.paid_amount)) refuse('payment-amount-differs');
  for (let transitions = 0; transitions < 3; transitions++) {
    const step = nextStep('payment', { state: paymentObserved(payment, billId), anchor: 'ours' });
    if (step === 'adopt') {
      const [bill] = await call<Array<{ amount_residual: number | string }>>('account.move', 'read', { ids: [billId], fields: ['amount_residual'] });
      return {
        externalRecordId: odooExternalRef(PAYMENT_MODEL, id),
        canonical: {
          id: String(record.id), pay_number: payment.name, reference_number: null, amount: mirrorMoney(payment.amount),
          erp_docstatus: 1, erp_modified: payment.write_date, erp_amended_from: null,
          odoo_bill_residual: bill ? mirrorMoney(bill.amount_residual) : null,   // Odoo's, for the sweep and the screens; the bill mirror is the feed's (P7)
        },
      };
    }
    if (step === 'post') await call(PAYMENT_MODEL, 'action_post', { ids: [id] });
    else if (step === 'reconcile') await reconcilePayment(call, payment, billId);
    else return refuse(`payment-${payment.state}`);
    payment = await readPayment(call, id);
  }
  return refuse('payment-not-settled');
}

/** What an operator decided about a held payment, as stored in its outbox payload (0508). */
export interface PaymentResolution { adoptedRef?: string; absentConfirmed?: boolean }

/**
 * The recovery probe for a vendor payment (FR-OPP-051/052, OQ-OPP-10): the payment this command already created, found by its memo
 * (or, only in a RECOVERY and only as a unique conjunction with the bill, by the composite) and brought to its settled state, or
 * null when nothing was created. Throws (the row is held) on any doubt. A payment is never reissued on doubt: the outbox holds it.
 */
export async function recoverPayment(
  rawCall: OdooCall, record: PmoRecord, composite: PaymentComposite | undefined, billRef: string, resolution?: PaymentResolution,
): Promise<CommandResult | null> {
  const call = guarded(rawCall);
  if (resolution?.adoptedRef) {
    // A person named the payment (resolve_held_outbox_command): trusted no further than "Odoo shows it reconciled to this bill".
    const id = parseOdooExternalRef(PAYMENT_MODEL, resolution.adoptedRef) ?? refuse('ambiguous-anchor');
    const billId = parseOdooExternalRef(ANCHORED_MODEL.bill, billRef) ?? refuse('payment-bill-required');
    if (!reconciledBills(await readPayment(call, id)).includes(billId)) refuse('adopted-payment-not-reconciled');
    return settlePayment(call, id, record, billRef);
  }
  // A person confirmed nothing exists in Odoo: look for our exact memo only, never a look-alike.
  const hit = await probeOdooByAnchor(call, 'payment', paymentKey(record), resolution?.absentConfirmed ? undefined : composite);
  if (!hit) return null;
  const id = parseOdooExternalRef(PAYMENT_MODEL, hit.externalRecordId) ?? refuse('ambiguous-anchor');
  return settlePayment(call, id, record, billRef);
}

/**
 * Create, post and reconcile. Reached only when dispatch ruled the absence acceptable (a first attempt, or a definite failure): a
 * recovery that found nothing is held by the outbox before this runs (`odooReissueOnInconclusiveAbsence`), so this never mints on doubt.
 */
async function pushPayment(deps: OdooProcurementDeps, command: AdapterCommand): Promise<CommandResult> {
  const call = guarded(deps.call);
  const facts = await (deps.resolvePayment ?? (() => refuse('odoo payment is not available')))(command);
  const found = await recoverPayment(call, command.record, undefined, facts.billRef ?? '');   // before the residual check: a retry's own payment has already reduced it
  if (found) return found;
  const body = buildPaymentBody({ billRef: facts.billRef, amount: facts.amount, date: facts.date, vendorPartnerId: facts.vendorPartnerId }, await readPaymentCtx(call, facts), paymentKey(command.record));   // refuses before the first write
  const [id] = await call<number[]>(PAYMENT_MODEL, 'create', { vals_list: [body] });
  return settlePayment(call, id, command.record, facts.billRef!);
}

export function createOdooProcurementAdapter(deps: OdooProcurementDeps): Adapter {
  return {
    tier: ODOO_TIER,
    capabilityMap: new Set([PROCUREMENT_DOMAIN]),

    async commit(command) {
      if (command.domain !== PROCUREMENT_DOMAIN) return refuse('unsupported domain');
      const kind = String(command.record.erp_doc_kind);
      if (kind === 'purchase-order' && command.operation === 'create') return pushOrder(deps, command);
      if (kind === 'purchase-order' && String(command.operation) === 'revise') return reviseOrder(deps, command);
      if (kind === 'purchase-invoice' && command.operation === 'create') return pushBill(deps, command);
      if (kind === 'goods-receipt' && command.operation === 'create') return pushReceipt(deps, command);
      if (kind === 'payment' && command.operation === 'create') return pushPayment(deps, command);
      return refuse(`odoo purchase ${kind} ${String(command.operation)} is not available yet`);
    },

    // The inbound feed for purchases arrives with P7.
    getByExternalId: () => Promise.reject(new AdapterError('commit-rejected', 'odoo purchase reads are not available yet')),
    listChangesSinceWatermark: () => Promise.reject(new AdapterError('commit-rejected', 'odoo purchase reads are not available yet')),
  };
}
