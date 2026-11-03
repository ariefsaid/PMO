/**
 * The goods-receipt plan (FR-OPP-030/031/033, PD-4), pure. A receipt names a quantity per order line; the plan fixes, ONCE and
 * before any write, what Odoo had already received (`base`) and what this receipt adds, so a retry after a lost response judges
 * against the same numbers and never against a state this receipt itself changed. The plan is persisted with the outbox row and
 * its digest is part of the receipt key (`gr:<receipt id>:<digest>`). A quantity above the open quantity of its line is refused
 * here, before any Odoo call (AC-OPP-031). Quantities are compared at four decimals, never as floats.
 */
import { AdapterError } from '../../contract.ts';
import { productIdOf } from './orderBody.ts';

/** An Odoo order line's quantities as read (`product_qty`, `qty_received`). */
export interface OrderLineQty { id: number; productId: number; ordered: number; received: number }
/** One entered receipt line: the PMO line identity (the order body's `name`) and the quantity received. */
export interface ReceiptLineInput { itemRef: string; quantity: number | string }
export interface ReceiptPlanLine { lineId: number; productId: number; base: number; quantity: number }
export interface ReceiptPlan { orderId: number; lines: ReceiptPlanLine[]; digest: string }

const refuse = (reason: string): never => { throw new AdapterError('commit-rejected', reason); };
const q4 = (v: number | string): number => Math.round(Number(v) * 1e4);
const n4 = (units: number): number => units / 1e4;

/** Hex digest of the cumulative quantity per line (base plus this receipt): the receipt key's third part. */
export async function receiptDigest(lines: readonly ReceiptPlanLine[]): Promise<string> {
  const canonical = [...lines].sort((a, b) => a.lineId - b.lineId).map((l) => `${l.lineId}=${q4(l.base) + q4(l.quantity)}`).join(';');
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical));
  return [...new Uint8Array(bytes)].slice(0, 16).map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** `wanted` undefined: every line's open quantity in full. Otherwise exactly the named lines, the rest carried at zero. */
export async function planReceipt(orderId: number, lines: readonly OrderLineQty[], wanted: readonly ReceiptLineInput[] | undefined, itemMap: Readonly<Record<string, string>>): Promise<ReceiptPlan> {
  if (lines.length === 0) refuse('receipt-no-lines');
  const open = (l: OrderLineQty) => q4(l.ordered) - q4(l.received);
  const qty = new Map<number, number>();
  if (wanted === undefined) {
    for (const l of lines) if (open(l) > 0) qty.set(l.id, open(l));
    if (qty.size === 0) refuse('receipt-nothing-open');
  } else {
    if (wanted.length === 0) refuse('receipt-empty');
    const seen = new Set<string>();
    for (const w of wanted) {
      if (seen.has(w.itemRef)) refuse(`receipt-duplicate-item: ${w.itemRef}`);
      seen.add(w.itemRef);
      const q = q4(w.quantity);
      if (!(typeof w.quantity === 'number' || /^\s*\d+(\.\d+)?\s*$/.test(w.quantity)) || !Number.isFinite(q) || q <= 0) refuse(`receipt-quantity-invalid: ${w.itemRef}`);
      const productId = productIdOf({ itemMap }, w.itemRef);
      const matches = lines.filter((l) => l.productId === productId);
      if (matches.length === 0) refuse(`receipt-line-missing: ${w.itemRef}`);
      if (matches.length > 1) refuse(`receipt-line-ambiguous: ${w.itemRef}`);
      if (q > open(matches[0])) refuse(`over-receipt: ${w.itemRef}`);
      qty.set(matches[0].id, q);
    }
  }
  const planLines = lines.map((l) => ({ lineId: l.id, productId: l.productId, base: n4(q4(l.received)), quantity: n4(qty.get(l.id) ?? 0) }));
  return { orderId, lines: planLines, digest: await receiptDigest(planLines) };
}

/**
 * Where Odoo stands against a plan (FR-OPP-033): every planned line still at its base -> `absent` (nothing of this receipt is
 * booked); every one at base plus the receipt -> `done`; anything else -> `differs`, which the caller holds on.
 */
export function observeReceipt(plan: Pick<ReceiptPlan, 'lines'>, current: readonly OrderLineQty[]): 'absent' | 'done' | 'differs' {
  const byId = new Map(current.map((l) => [l.id, q4(l.received)]));
  let absent = true, done = true;
  for (const p of plan.lines) {
    const got = byId.get(p.lineId);
    if (got === undefined) return 'differs';
    if (got !== q4(p.base)) absent = false;
    if (got !== q4(p.base) + q4(p.quantity)) done = false;
  }
  return absent ? 'absent' : done ? 'done' : 'differs';
}

/** The order's received status, read from Odoo's quantities and never typed (FR-OPP-034). */
export function receivedStatus(lines: readonly OrderLineQty[]): 'Complete' | 'Partial' {
  return lines.length > 0 && lines.every((l) => q4(l.received) >= q4(l.ordered)) ? 'Complete' : 'Partial';
}

/** A plan read from a persisted payload or a command, trusted only if its shape holds and its digest matches its own lines. */
export async function parseReceiptPlan(raw: unknown): Promise<ReceiptPlan | null> {
  const plan = raw as ReceiptPlan | null | undefined;
  const whole = (n: unknown) => Number.isInteger(n) && (n as number) > 0;
  const qty = (n: unknown) => typeof n === 'number' && Number.isFinite(n) && n >= 0;
  if (!plan || typeof plan !== 'object' || !whole(plan.orderId) || !Array.isArray(plan.lines) || plan.lines.length === 0 || typeof plan.digest !== 'string' || !/^[a-f0-9]{32}$/.test(plan.digest)) return null;
  if (!plan.lines.every((l) => l && whole(l.lineId) && whole(l.productId) && qty(l.base) && qty(l.quantity)) || !plan.lines.some((l) => l.quantity > 0)) return null;
  if (await receiptDigest(plan.lines) !== plan.digest) return null;
  return { orderId: plan.orderId, lines: plan.lines.map((l) => ({ lineId: l.lineId, productId: l.productId, base: l.base, quantity: l.quantity })), digest: plan.digest };
}
