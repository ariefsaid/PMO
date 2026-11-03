/**
 * The Odoo `Adapter` (contract.ts) for domain `procurement` (PD-2, DD-OPP-1..3). P3 pushes the purchase order and its revision;
 * receipts, bills and payments arrive with P4..P6 and are refused until then. A command is a state machine over Odoo's state, not
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
import { externalIdentifier } from './purchase/anchors.ts';
import { nextStep } from './purchase/nextStep.ts';
import { poReviseRecoveryDecision, purchaseOrderReviseKey } from '../purchaseOrderRevise.ts';
import { buildOrderBody, plannedAt, type OrderCtx, type OrderInput } from './purchase/orderBody.ts';
import { planRevise, type CurrentLine, type ReviseLine } from './purchase/orderRevise.ts';
import { probeOdooByAnchor, type OrderComposite } from './purchase/recoveryProbe.ts';
import { observeReceipt, parseReceiptPlan, receivedStatus, type OrderLineQty, type ReceiptPlan } from './purchase/receiptBody.ts';

export const PROCUREMENT_DOMAIN = 'procurement';

export interface OdooProcurementDeps {
  call: OdooCall;
  /** The command's PMO-side facts (vendor, lines, project's cost account), resolved before any write. */
  resolveOrder(command: AdapterCommand): Promise<{ input: OrderInput; ctx: OrderCtx }>;
  /** A revision's target: the Odoo order the PMO order maps to and the revision's effective line set. */
  resolveRevise(command: AdapterCommand): Promise<{ orderId: number; lines: readonly ReviseLine[]; ctx: OrderCtx }>;
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
  return { externalRecordId: String(id), canonical: orderCanonical(order, record, String(record.id)) };
}

/** Write the stock external identifier that anchors the order; one already there for this order is left alone. */
async function anchorOrder(call: OdooCall, key: string, id: number): Promise<void> {
  const hit = await probeOdooByAnchor(call, 'order', key);
  if (hit) { if (hit.externalRecordId !== String(id)) refuse('ambiguous-anchor'); return; }
  const { module, name } = externalIdentifier(key);
  await call('ir.model.data', 'create', { vals_list: [{ module, name, model: 'purchase.order', res_id: id }] });
}

/**
 * The recovery probe for an order (FR-OPP-072): the order this command already created, anchored if need be and brought to its
 * settled state, or null when nothing was created. Throws (the row is held) when the composite finds doubt.
 */
export async function recoverOrder(rawCall: OdooCall, record: PmoRecord, composite?: OrderComposite): Promise<CommandResult | null> {
  const call = guarded(rawCall);
  const key = orderKey(record);
  const hit = await probeOdooByAnchor(call, 'order', key, composite);
  if (!hit) return null;
  const id = Number(hit.externalRecordId);
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
  return { externalRecordId: hit.externalRecordId, canonical: orderCanonical(await readOrder(call, Number(hit.externalRecordId)), record, String(record.poId)) };
}

async function reviseOrder(deps: OdooProcurementDeps, command: AdapterCommand): Promise<CommandResult> {
  const call = guarded(deps.call);
  const key = reviseKey(command.record);
  const { orderId, lines, ctx } = await deps.resolveRevise(command);
  const applied = await recoverRevise(call, command.record);
  if (applied) return applied.externalRecordId === String(orderId) ? applied : refuse('ambiguous-anchor');
  const order = await readOrder(call, orderId);
  const current = await call<CurrentLine[]>('purchase.order.line', 'search_read', {
    domain: [['order_id', '=', orderId]], fields: ['product_id', 'product_qty', 'price_unit', 'qty_received', 'qty_invoiced'],
  });
  const { commands } = planRevise(order, current, lines, ctx, plannedAt(null));   // refuses before any write
  if (commands.length) await call('purchase.order', 'write', { ids: [orderId], vals: { order_line: commands } });
  const { module, name } = externalIdentifier(key);
  await call('ir.model.data', 'create', { vals_list: [{ module, name, model: 'purchase.order', res_id: orderId }] });
  return { externalRecordId: String(orderId), canonical: orderCanonical(await readOrder(call, orderId), command.record, String(command.record.poId)) };
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
    externalRecordId: String(picking.id ?? ''),
    canonical: {
      id: String(record.id),
      gr_number: picking.name,
      po_id: String(plan.orderId),
      erp_docstatus: 1,
      erp_modified: picking.write_date,
      odoo_receipt_status: receivedStatus(await readOrderLines(call, plan.orderId)),   // read from Odoo's quantities, never typed (FR-OPP-034)
      odoo_booked: bookedLines,
      odoo_entered: entered,
    },
  };
}

/** Write the stock external identifier that anchors the transfer to this receipt; one already there for it is left alone. */
async function anchorTransfer(call: OdooCall, key: string, id: number): Promise<void> {
  const hit = await probeOdooByAnchor(call, 'receipt', key);
  if (hit) { if (hit.externalRecordId !== String(id)) refuse('ambiguous-anchor'); return; }
  const { module, name } = externalIdentifier(key);
  await call('ir.model.data', 'create', { vals_list: [{ module, name, model: 'stock.picking', res_id: id }] });
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
    const picking = await readPicking(call, Number(hit.externalRecordId));
    picking.id = Number(hit.externalRecordId);
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

export function createOdooProcurementAdapter(deps: OdooProcurementDeps): Adapter {
  return {
    tier: ODOO_TIER,
    capabilityMap: new Set([PROCUREMENT_DOMAIN]),

    async commit(command) {
      if (command.domain !== PROCUREMENT_DOMAIN) return refuse('unsupported domain');
      const kind = String(command.record.erp_doc_kind);
      if (kind === 'purchase-order' && command.operation === 'create') return pushOrder(deps, command);
      if (kind === 'purchase-order' && String(command.operation) === 'revise') return reviseOrder(deps, command);
      if (kind === 'goods-receipt' && command.operation === 'create') return pushReceipt(deps, command);
      return refuse(`odoo purchase ${kind} ${String(command.operation)} is not available yet`);
    },

    // The inbound feed for purchases arrives with P7.
    getByExternalId: () => Promise.reject(new AdapterError('commit-rejected', 'odoo purchase reads are not available yet')),
    listChangesSinceWatermark: () => Promise.reject(new AdapterError('commit-rejected', 'odoo purchase reads are not available yet')),
  };
}
