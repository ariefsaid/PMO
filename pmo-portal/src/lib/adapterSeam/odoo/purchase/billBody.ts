/**
 * The Odoo vendor-bill (`account.move`, `in_invoice`) create body (FR-OPP-040/021/023), pure. Like the order body, everything is
 * resolved before it is called and a thing that did not resolve refuses here, naming it, so no Odoo write is attempted. The anchor
 * is NOT in the body: bills anchor on a stock external identifier written right after the create (DD-OPP-4 amendment), so the
 * vendor reference keeps the vendor's own invoice number. Taxes are always explicit ids chosen from the directory (OQ-OPP-4): the
 * line carries `tax_ids` even when empty, so Odoo's per-product and per-partner defaults never decide a figure.
 */
import { AdapterError } from '../../contract.ts';
import { assertOrderResolved, odooId, productIdOf, vendorPartnerId, type OrderCtx, type OrderLineInput } from './orderBody.ts';
import { validateTaxes, type PurchaseTax } from './taxValidate.ts';

export interface BillLineInput extends OrderLineInput {
  /** The Odoo order line this bill line settles, when the bill names an order (OQ-OPP-3); free-standing otherwise. */
  purchaseLineId?: number | null;
}
export interface BillInput {
  /** The vendor's Odoo partner in the shared `Vendor:<id>` form. */
  vendor: string | null;
  /** The vendor's own invoice number: the bill's vendor-reference field, never the anchor. */
  reference: string | null;
  /** `YYYY-MM-DD`: the vendor's invoice date. */
  invoiceDate?: string | null;
  dueDate?: string | null;
  projectIds: readonly string[];
  lines: readonly BillLineInput[];
}
export interface BillTax extends PurchaseTax { id: number }
export type BillCtx = Omit<OrderCtx, 'taxIds'> & { taxes: readonly BillTax[] };

const refuse = (reason: string): never => { throw new AdapterError('commit-rejected', reason); };

/** A choice wins; no choice takes the company default; an empty choice is the explicit "no tax". */
export function chooseTaxIds(chosen: readonly number[] | null | undefined, defaults: readonly number[]): number[] {
  return [...(chosen ?? defaults)];
}

/** The chosen taxes, validated against the directory (FR-OPP-042). Refuses `config-rejected`, naming the tax, never the company or an account. */
export function selectBillTaxes(directory: readonly BillTax[], ids: readonly number[], companyId: number): BillTax[] {
  const chosen = ids.map((id) => directory.find((t) => t.id === id) ?? refuse(`config-rejected: tax-unknown ${id}`));
  const verdict = validateTaxes(chosen, companyId);
  if (verdict.outcome === 'refused') refuse(`${verdict.code}: ${verdict.tax}`);
  return chosen;
}

const sign = (n: number) => (n < 0 ? -1 : 1);
const roundHalfAway = (n: number) => sign(n) * Math.round(Math.abs(n));

/** The total Odoo should answer for these lines and taxes (net of withholding), rounded per line and per tax as Odoo does. */
export function expectedBillTotal(bill: Pick<BillInput, 'lines'>, taxes: readonly Pick<PurchaseTax, 'rate'>[]): string {
  let cents = 0;
  for (const line of bill.lines) {
    const base = Math.round(Number(line.quantity) * Number(line.rate) * 100);
    cents += base + taxes.reduce((sum, tax) => sum + roundHalfAway((base * tax.rate) / 100), 0);
  }
  return (cents / 100).toFixed(2);
}

function billLine(line: BillLineInput, ctx: BillCtx): Record<string, unknown> {
  const qty = Number(line.quantity), price = Number(line.rate);
  if (!(qty > 0) || !(price >= 0) || !Number.isFinite(price)) refuse(`line-invalid: ${line.name}`);
  const key = line.unit?.trim();   // the map's keys are trimmed texts (odoo_pmo_units)
  const unit = key ? (odooId(Object.hasOwn(ctx.unitMap, key) ? ctx.unitMap[key] : undefined) ?? refuse(`unit-unmapped: ${key}`)) : null;
  return {
    product_id: productIdOf(ctx, line.name),
    name: line.description || line.name,
    quantity: qty,
    price_unit: price,
    ...(unit === null ? {} : { product_uom_id: unit }),
    tax_ids: [[6, 0, ctx.taxes.map((t) => t.id)]],   // always explicit (OQ-OPP-4)
    ...(ctx.costAccountId === null ? {} : { analytic_distribution: { [ctx.costAccountId]: 100 } }),
    ...(line.purchaseLineId ? { purchase_line_id: line.purchaseLineId } : {}),
  };
}

export function buildBillBody(bill: BillInput, ctx: BillCtx, today = new Date().toISOString().slice(0, 10)): Record<string, unknown> {
  assertOrderResolved(bill, ctx);
  const verdict = validateTaxes(ctx.taxes, ctx.companyId);   // defence in depth: the resolver already validated the set
  if (verdict.outcome === 'refused') refuse(`${verdict.code}: ${verdict.tax}`);
  const partnerId = vendorPartnerId(bill.vendor);
  const date = (v: string | null | undefined) => (/^\d{4}-\d{2}-\d{2}$/.test(v ?? '') ? v : null);
  return {
    move_type: 'in_invoice',
    partner_id: partnerId,
    company_id: ctx.companyId,
    currency_id: ctx.currencyId,   // explicit: never the vendor's default currency (OQ-OPP-9)
    ...(bill.reference ? { ref: bill.reference } : {}),
    invoice_date: date(bill.invoiceDate) ?? today,   // Odoo will not post a vendor bill without one
    ...(date(bill.dueDate) ? { invoice_date_due: date(bill.dueDate) } : {}),
    invoice_line_ids: bill.lines.map((line) => [0, 0, billLine(line, ctx)]),
  };
}
