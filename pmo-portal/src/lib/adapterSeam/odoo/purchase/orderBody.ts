/**
 * The Odoo `purchase.order` create body (FR-OPP-010/014/021), pure. Everything it needs is resolved before it is called
 * (vendor, item and unit mappings, the project's cost account); a thing that did not resolve refuses here, naming it, so no
 * Odoo write is attempted (AC-OPP-013). The anchor is NOT in the body: orders anchor on a stock external identifier written
 * right after the create (DD-OPP-4 amendment), so the user-visible Source and vendor-reference fields keep business content.
 */
import { AdapterError } from '../../contract.ts';

export interface OrderLineInput { name: string; quantity: number | string; rate: number | string; description?: string | null; unit?: string | null }
export interface OrderInput {
  /** The vendor's Odoo partner id in the shared `Vendor:<id>` form (the companies external reference). */
  vendor: string | null;
  caseNumber: string | null;
  vendorReference?: string | null;
  /** `YYYY-MM-DD`. */
  expectedDate?: string | null;
  /** The distinct PMO projects the case names; O2 does not split lines across projects. */
  projectIds: readonly string[];
  lines: readonly OrderLineInput[];
}
export interface OrderCtx {
  companyId: number;
  /** The Odoo currency (`res.currency` id) the order is placed in: the company's, which dispatch checked equals PMO's (OQ-OPP-9). */
  currencyId: number;
  /** PMO line name -> Odoo product id. */
  itemMap: Readonly<Record<string, string>>;
  /** PMO unit -> Odoo `uom.uom` id. */
  unitMap: Readonly<Record<string, string>>;
  /** The project's resolved cost account (analytic account id); null when the project did not resolve. */
  costAccountId: string | null;
  taxIds: readonly number[];
}

const refuse = (reason: string): never => { throw new AdapterError('commit-rejected', reason); };
const ODOO_ID = /^[0-9]{1,9}$/;
const odooId = (value: string | undefined): number | null => (value !== undefined && ODOO_ID.test(value) ? Number(value) : null);

export function productIdOf(ctx: Pick<OrderCtx, 'itemMap'>, name: string): number {
  return odooId(Object.hasOwn(ctx.itemMap, name) ? ctx.itemMap[name] : undefined) ?? refuse(`item-unmapped: ${name}`);
}

export function vendorPartnerId(vendor: string | null): number {
  return odooId(/^Vendor:(\d+)$/.exec(vendor ?? '')?.[1]) ?? refuse('vendor-unmapped');
}

/** The line fields a new line and a revision's added line share. */
export function lineVals(line: OrderLineInput, ctx: OrderCtx, plannedAt: string): Record<string, unknown> {
  const qty = Number(line.quantity), price = Number(line.rate);
  if (!(qty > 0) || !(price >= 0) || !Number.isFinite(price)) refuse(`line-invalid: ${line.name}`);
  const unit = line.unit ? (odooId(Object.hasOwn(ctx.unitMap, line.unit) ? ctx.unitMap[line.unit] : undefined) ?? refuse(`unit-unmapped: ${line.unit}`)) : null;
  return {
    product_id: productIdOf(ctx, line.name),
    name: line.description || line.name,
    product_qty: qty,
    price_unit: price,
    date_planned: plannedAt,
    ...(unit === null ? {} : { uom_id: unit }),
    tax_ids: [[6, 0, [...ctx.taxIds]]],   // always explicit: Odoo's per-product defaults are never relied on (OQ-OPP-4)
    ...(ctx.costAccountId === null ? {} : { analytic_distribution: { [ctx.costAccountId]: 100 } }),
  };
}

export function plannedAt(date: string | null | undefined): string {
  return `${/^\d{4}-\d{2}-\d{2}$/.test(date ?? '') ? date : new Date().toISOString().slice(0, 10)} 00:00:00`;
}

/** Checks that apply to a whole order before any line is built. */
export function assertOrderResolved(po: Pick<OrderInput, 'projectIds' | 'lines'>, ctx: Pick<OrderCtx, 'costAccountId'>): void {
  if (po.projectIds.length > 1) refuse('multiple-projects');
  if (po.projectIds.length === 1 && ctx.costAccountId === null) refuse('project-unlinked');
  if (po.lines.length === 0) refuse('no-lines');
}

export function buildOrderBody(po: OrderInput, ctx: OrderCtx): Record<string, unknown> {
  assertOrderResolved(po, ctx);
  const partnerId = vendorPartnerId(po.vendor);
  const planned = plannedAt(po.expectedDate);
  return {
    partner_id: partnerId,
    company_id: ctx.companyId,
    currency_id: ctx.currencyId,   // explicit: never the vendor's purchase-currency default (OQ-OPP-9)
    ...(po.vendorReference ? { partner_ref: po.vendorReference } : {}),
    ...(po.caseNumber ? { origin: po.caseNumber } : {}),
    order_line: po.lines.map((line) => [0, 0, lineVals(line, ctx, planned)]),
  };
}
