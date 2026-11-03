/**
 * Revising a confirmed order in place (FR-OPP-016, DD-OPP-9), pure: the line commands that take the order's current lines to
 * the revision's effective line set, or a refusal naming why. Odoo itself lets a quantity go below what was received or billed
 * (bed V-OPP9), so this is the guard: nothing below received or billed, nothing on an order that is not simply confirmed, and
 * nothing is ever cancelled. Odoo refuses to delete a confirmed line, so a dropped line is set to zero.
 */
import { AdapterError } from '../../contract.ts';
import { lineVals, productIdOf, type OrderCtx } from './orderBody.ts';

/** One effective line of a revision (`PurchaseOrderRevise.lines`): 3-dp quantity and 2-dp rate strings. */
export interface ReviseLine { itemRef: string; quantity: string; rate: string; unit: string }
/** A `purchase.order.line` as read back. */
export interface CurrentLine {
  id: number;
  product_id: number | [number, string];
  product_qty: number | string;
  price_unit: number | string;
  qty_received: number | string;
  qty_invoiced: number | string;
}

const refuse = (reason: string): never => { throw new AdapterError('commit-rejected', reason); };
const productOf = (line: CurrentLine): number => (Array.isArray(line.product_id) ? line.product_id[0] : line.product_id);
const same = (a: number | string, b: number | string) => Math.abs(Number(a) - Number(b)) < 1e-9;

export function planRevise(
  order: { state: string },
  current: readonly CurrentLine[],
  target: readonly ReviseLine[],
  ctx: OrderCtx,
  plannedAt: string,
): { commands: unknown[][] } {
  if (order.state !== 'purchase') refuse(`order-${order.state}`);
  const byProduct = new Map<number, CurrentLine>();
  for (const line of current) {
    if (byProduct.has(productOf(line))) refuse(`ambiguous-line: product ${productOf(line)}`);
    byProduct.set(productOf(line), line);
  }
  const commands: unknown[][] = [];
  const seen = new Set<number>();
  for (const line of target) {
    const product = productIdOf(ctx, line.itemRef);
    if (seen.has(product)) refuse(`ambiguous-line: ${line.itemRef}`);
    seen.add(product);
    const existing = byProduct.get(product);
    if (!existing) { commands.push([0, 0, lineVals({ name: line.itemRef, quantity: line.quantity, rate: line.rate, unit: line.unit }, ctx, plannedAt)]); continue; }
    const qty = Number(line.quantity);
    if (qty < Math.max(Number(existing.qty_received), Number(existing.qty_invoiced))) refuse(`below-received: ${line.itemRef}`);
    const vals: Record<string, number> = {
      ...(same(existing.product_qty, qty) ? {} : { product_qty: qty }),
      ...(same(existing.price_unit, line.rate) ? {} : { price_unit: Number(line.rate) }),
    };
    if (Object.keys(vals).length) commands.push([1, existing.id, vals]);
  }
  for (const [product, line] of byProduct) {
    if (seen.has(product) || same(line.product_qty, 0)) continue;
    if (Number(line.qty_received) > 0 || Number(line.qty_invoiced) > 0) refuse(`below-received: product ${product}`);
    commands.push([1, line.id, { product_qty: 0 }]);
  }
  return { commands };
}
