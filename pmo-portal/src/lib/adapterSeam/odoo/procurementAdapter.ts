/**
 * The Odoo `Adapter` (contract.ts) for domain `procurement` (PD-2, DD-OPP-1..3). P3 pushes the purchase order and its revision, P5
 * the vendor bill; receipts and payments arrive with P4 and P6 and are refused until then. A command is a state machine over Odoo's state, not
 * a script (PD-3): find the document by its anchor, let `nextStep` pick the one missing call, perform it, read it back.
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
import { buildBillBody, expectedBillTotal, type BillCtx, type BillInput } from './purchase/billBody.ts';
import { readBackBill, type BillExpect } from './purchase/billReadBack.ts';
import { buildOrderBody, plannedAt, type OrderCtx, type OrderInput } from './purchase/orderBody.ts';
import { planRevise, type CurrentLine, type ReviseLine } from './purchase/orderRevise.ts';
import { probeOdooByAnchor, type BillComposite, type OrderComposite } from './purchase/recoveryProbe.ts';

export const PROCUREMENT_DOMAIN = 'procurement';

export interface OdooProcurementDeps {
  call: OdooCall;
  /** The command's PMO-side facts (vendor, lines, project's cost account), resolved before any write. */
  resolveOrder(command: AdapterCommand): Promise<{ input: OrderInput; ctx: OrderCtx }>;
  /** A revision's target: the Odoo order the PMO order maps to and the revision's effective line set. */
  resolveRevise(command: AdapterCommand): Promise<{ orderId: number; lines: readonly ReviseLine[]; ctx: OrderCtx }>;
  /** A bill's PMO-side facts: vendor, lines (with the order-line link when the bill names an order), project's cost account and the validated taxes. */
  resolveBill(command: AdapterCommand): Promise<{ input: BillInput; ctx: BillCtx }>;
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

const ANCHORED_MODEL = { order: 'purchase.order', bill: 'account.move' } as const;

/** Write the stock external identifier that anchors the document; one already there for this document is left alone. */
async function anchorDocument(call: OdooCall, kind: keyof typeof ANCHORED_MODEL, key: string, id: number): Promise<void> {
  const hit = await probeOdooByAnchor(call, kind, key);
  if (hit) { if (hit.externalRecordId !== String(id)) refuse('ambiguous-anchor'); return; }
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
  return { externalRecordId: String(id), canonical: readBackBill(String(record.id), { move, taxLines, productLines }, expect) };
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
  const id = Number(hit.externalRecordId);
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
      return refuse(`odoo purchase ${kind} ${String(command.operation)} is not available yet`);
    },

    // The inbound feed for purchases arrives with P7.
    getByExternalId: () => Promise.reject(new AdapterError('commit-rejected', 'odoo purchase reads are not available yet')),
    listChangesSinceWatermark: () => Promise.reject(new AdapterError('commit-rejected', 'odoo purchase reads are not available yet')),
  };
}
