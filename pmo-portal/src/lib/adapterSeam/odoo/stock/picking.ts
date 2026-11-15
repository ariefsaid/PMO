/**
 * The one writer of Odoo stock pickings (AC-OSP-002, AC-OSP-004, #1508). `sendStockPicking` creates the anchored
 * picking with every move in one `load`; `completeStockPicking` enters the quantities and validates it. An answer
 * from Odoo that refuses the call (a 4xx, `ids:false`) means nothing was written or the picking is unusable; a
 * thrown transport error or a 5xx means the call may have committed, so it is `unknown`. Nothing here returns a
 * definitive failure once `load` has answered with ids. Never creates an `account.move` or an
 * `account.analytic.line`: Odoo valuation books the cost on validation.
 */
import { OdooError, type OdooCall } from '../client.ts';
import { stockExternalIdentifier } from './anchors.ts';
import type { HoldCause } from './holdReason.ts';

export interface StockPickingLine {
  productId: number;
  quantity: number;
}

export interface SendStockPickingParams {
  /** The stock document's anchor key: `stock:<uuid>` (or the bare uuid). */
  anchorKey: string;
  companyId: number;
  pickingTypeId: number;
  projectId?: number;
  lines: StockPickingLine[];
  /** Source and destination location ids, shared by the picking and every move. */
  src: number;
  dest: number;
  origin?: string;
  /** Epoch ms after which no further Odoo write may start. */
  deadlineAtMs?: number;
}

export type SendStockPickingResult =
  | { outcome: 'sent'; pickingId: number }
  | { outcome: 'rejected'; message: string }
  | { outcome: 'unknown'; message: string };

export type CompleteStockPickingResult =
  | { outcome: 'validated' }
  | { outcome: 'held'; message: string; cause: HoldCause; wizard?: string }
  | { outcome: 'unknown'; message: string };

interface LoadResult {
  ids: number[] | false;
  messages?: Array<{ type?: string; message: string }>;
}

/** Odoo answered and refused: a 4xx (not a timeout), so the call changed nothing it was refused for. */
const isRefusal = (err: unknown): boolean =>
  err instanceof OdooError && err.status !== undefined && err.status >= 400 && err.status < 500 && err.status !== 408;

const reason = (err: unknown): string => (err instanceof Error ? err.message : String(err));

const expired = (deadlineAtMs?: number): boolean => deadlineAtMs !== undefined && Date.now() >= deadlineAtMs;

const idOf = (v: unknown): unknown => (Array.isArray(v) ? v[0] : v);

export async function sendStockPicking(call: OdooCall, p: SendStockPickingParams): Promise<SendStockPickingResult> {
  if (expired(p.deadlineAtMs)) return { outcome: 'unknown', message: 'The commit deadline passed before the stock picking was sent.' };

  const { xmlId } = stockExternalIdentifier(p.anchorKey);
  const header = [
    'id', 'picking_type_id/.id', 'location_id/.id', 'location_dest_id/.id', 'company_id/.id',
    ...(p.projectId === undefined ? [] : ['project_id/.id']),
    'origin',
  ];
  const moveFields = ['move_ids/product_id/.id', 'move_ids/product_uom_qty', 'move_ids/location_id/.id', 'move_ids/location_dest_id/.id', 'move_ids/company_id/.id'];
  const headerCells = [
    xmlId, p.pickingTypeId, p.src, p.dest, p.companyId,
    ...(p.projectId === undefined ? [] : [p.projectId]),
    p.origin ?? p.anchorKey,
  ];
  // One header row carries the first move; each further move is a continuation row with empty header cells.
  const data = p.lines.map((line, i) => [
    ...(i === 0 ? headerCells : headerCells.map(() => '')),
    line.productId, line.quantity, p.src, p.dest, p.companyId,
  ]);

  try {
    const res = await call<LoadResult>('stock.picking', 'load', { fields: [...header, ...moveFields], data });
    if (!res || res.ids === false || !Array.isArray(res.ids) || res.ids.length === 0) {
      const msgs = Array.isArray(res?.messages) ? res.messages.map((m) => m.message).join('; ') : 'unknown';
      return { outcome: 'rejected', message: `Odoo stock.picking load failed: ${msgs}` };
    }
    return { outcome: 'sent', pickingId: res.ids[0] };
  } catch (err) {
    return isRefusal(err)
      ? { outcome: 'rejected', message: `Odoo refused the stock picking load: ${reason(err)}` }
      : { outcome: 'unknown', message: `The stock picking load did not answer: ${reason(err)}` };
  }
}

/** Enter the quantities on every move and validate. The picking exists: a refusal here is `held`, never failed. */
export async function completeStockPicking(
  call: OdooCall,
  pickingId: number,
  lines: StockPickingLine[],
  deadlineAtMs?: number,
): Promise<CompleteStockPickingResult> {
  const stopped = (): CompleteStockPickingResult => ({ outcome: 'unknown', message: 'The commit deadline passed before the next Odoo write.' });
  const classify = (what: string, err: unknown): CompleteStockPickingResult => isRefusal(err)
    ? { outcome: 'held', cause: 'odoo-refused', message: `Odoo refused ${what} on stock picking ${pickingId}: ${reason(err)}` }
    : { outcome: 'unknown', message: `${what} on stock picking ${pickingId} did not answer: ${reason(err)}` };

  let moves: Array<{ id: number; product_id: unknown; product_uom_qty?: unknown }>;
  try {
    moves = await call<Array<{ id: number; product_id: unknown; product_uom_qty?: unknown }>>('stock.move', 'search_read', {
      domain: [['picking_id', '=', pickingId]],
      fields: ['id', 'product_id', 'product_uom_qty'],
      order: 'id asc',
    });
  } catch (err) {
    return classify('the move lookup', err);
  }
  if (!Array.isArray(moves) || moves.length !== lines.length || moves.some((m, i) => idOf(m.product_id) !== lines[i].productId || Number(m.product_uom_qty) !== lines[i].quantity)) {
    return { outcome: 'held', cause: 'moves-differ', message: `The moves of stock picking ${pickingId} do not match the document's lines (product or demanded quantity).` };
  }

  for (let i = 0; i < moves.length; i++) {
    if (expired(deadlineAtMs)) return stopped();
    try {
      await call<boolean>('stock.move', 'write', { ids: [moves[i].id], vals: { quantity: lines[i].quantity, picked: true } });
    } catch (err) {
      return classify('the quantity write', err);
    }
  }

  if (expired(deadlineAtMs)) return stopped();
  let res: unknown;
  try {
    res = await call<unknown>('stock.picking', 'button_validate', { ids: [pickingId] });
  } catch (err) {
    return classify('the validation', err);
  }
  if (typeof res === 'object' && res !== null && 'res_model' in res) {
    const wizard = String((res as { res_model: unknown }).res_model);
    const cause: HoldCause = wizard === 'stock.backorder.confirmation' ? 'wizard-partial' : wizard === 'stock.immediate.transfer' ? 'wizard-immediate' : 'wizard-other';
    return { outcome: 'held', cause, wizard, message: `Validation of stock picking ${pickingId} needs the wizard "${wizard}". Manual intervention required in Odoo.` };
  }
  return { outcome: 'validated' };
}
