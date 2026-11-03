/**
 * The vendor-bill half of the test-only Odoo (fakeOdoo.ts): a bill created with `invoice_line_ids` gets product lines and one tax
 * line per tax (VAT positive, withholding negative, as the bed shows, V-OPP6), totals and a residual; posting assigns its number,
 * advances the linked order lines' billed quantity and a second post is a 422 (V-OPP5). A line that names no taxes takes the
 * product's own supplier taxes, which is exactly the hidden default the adapter must never rely on (OQ-OPP-4).
 */
import { addPayableLine } from './fakePayment.ts';

type Row = Record<string, unknown> & { id: number };
export class Rejected extends Error {}

interface Env { table(model: string): Map<number, Row>; nextId(model: string): number; stamp(): string }

const away = (n: number) => (n < 0 ? -1 : 1) * Math.round(Math.abs(n));
const ids = (v: unknown): number[] => (Array.isArray(v) ? v.filter((x): x is number => typeof x === 'number') : []);
const taxIdsOf = (line: Record<string, unknown>, product: Row | undefined): number[] => {
  const cmd = Array.isArray(line.tax_ids) ? (line.tax_ids as unknown[][]).find((c) => c[0] === 6) : undefined;
  return cmd ? ids(cmd[2]) : ids(product?.supplier_taxes_id);
};

/** Is this a bill the fake models (created with lines), as opposed to a bare stub row? */
export const isModelledBill = (vals: Record<string, unknown>) => Array.isArray(vals.invoice_line_ids);

export function createBill(env: Env, vals: Record<string, unknown>): number {
  const id = env.nextId('account.move');
  const { invoice_line_ids: commands, ...header } = vals;
  const lineIds: number[] = [];
  const taxTotals = new Map<number, { name: string; base: number; amount: number }>();
  let untaxed = 0;
  for (const [op, , lineVals] of commands as Array<[number, number, Record<string, unknown>]>) {
    if (op !== 0) continue;
    const lineId = env.nextId('account.move.line');
    const product = env.table('product.product').get(Number(lineVals.product_id));
    const base = Math.round(Number(lineVals.quantity) * Number(lineVals.price_unit) * 100);
    untaxed += base;
    for (const taxId of taxIdsOf(lineVals, product)) {
      const tax = env.table('account.tax').get(taxId);
      if (!tax) throw new Rejected(`Tax ${taxId} does not exist`);
      const t = taxTotals.get(taxId) ?? { name: String(tax.name), base: 0, amount: 0 };
      t.base += base;
      t.amount += away((base * Number(tax.amount)) / 100);
      taxTotals.set(taxId, t);
    }
    env.table('account.move.line').set(lineId, {
      analytic_distribution: false, purchase_line_id: false, ...lineVals,
      id: lineId, move_id: id, display_type: 'product', tax_line_id: false, balance: base / 100, write_date: env.stamp(),
    });
    lineIds.push(lineId);
  }
  let tax = 0;
  for (const [taxId, t] of taxTotals) {
    const taxLineId = env.nextId('account.move.line');
    tax += t.amount;
    env.table('account.move.line').set(taxLineId, {
      id: taxLineId, move_id: id, display_type: 'tax', tax_line_id: [taxId, t.name], tax_base_amount: t.base / 100, balance: t.amount / 100, write_date: env.stamp(),
    });
  }
  const stamp = env.stamp();
  env.table('account.move').set(id, {
    active: true, name: '/', state: 'draft', payment_state: 'not_paid', ref: false, invoice_date: false, ...header, id,
    invoice_line_ids: lineIds, amount_untaxed: untaxed / 100, amount_tax: tax / 100, amount_total: (untaxed + tax) / 100, amount_residual: (untaxed + tax) / 100,
    create_date: stamp, write_date: stamp,
  });
  addPayableLine(env, id, (untaxed + tax) / 100);
  return id;
}

/** `action_post` on a modelled bill: draft only, a vendor date required; the bill takes its number and bills its order lines. */
export function postBill(env: Env, bill: Row): void {
  if (bill.state !== 'draft') throw new Rejected('This journal entry is already posted');
  if (!bill.invoice_date) throw new Rejected('The Bill/Refund date is required to validate this document.');
  const number = env.table('account.move').size;
  Object.assign(bill, { state: 'posted', name: `BILL/2026/${String(number).padStart(5, '0')}`, write_date: env.stamp() });
  for (const lineId of ids(bill.invoice_line_ids)) {
    const line = env.table('account.move.line').get(lineId);
    const orderLine = line && typeof line.purchase_line_id === 'number' ? env.table('purchase.order.line').get(line.purchase_line_id) : undefined;
    if (orderLine) orderLine.qty_invoiced = Number(orderLine.qty_invoiced ?? 0) + Number(line!.quantity);
  }
}
