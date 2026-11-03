import { formatTimeMaterialsDescription, formatTimeMaterialsNumber } from '../../erpnext/dispatchRevenueFormatting.ts';
import { odooFloatRound, odooLineSubtotal } from './odooRounding.ts';

/**
 * The Odoo create payload for one approved PMO sales invoice (PD-6). It transports: quantities, prices and line order
 * are the record's own, byte for byte; BoQ, assessment, recovery and VAT logic stay where they are. It only maps ids,
 * attaches the explicit tax set and the cost-account distribution, and refuses before any write when something is
 * unmapped. No due date and no received date travel (FR-OCI-015).
 */
export interface PmoInvoiceLine {
  itemId: string; description: string; quantity: number; unitPrice: number;
  /** A signed claim line's frozen amount; used only to preserve it across Odoo currency rounding. */
  amount?: number;
  /** The PMO unit; absent on an ordinary invoice line (the product's own unit then stands in Odoo). */
  unit?: string;
  /** A down-payment or recovery line rides the org's down-payment item; every other line is an ordinary item. */
  kind?: 'down-payment' | 'recovery';
  /** An explicit income account for this line (otherwise the item's own account stands). */
  incomeAccountId?: number;
}
export interface PmoInvoice {
  id: string; customerId: string; invoiceDate: string; currency: string; lines: readonly PmoInvoiceLine[];
  referenceNumber?: string | null; workOrderPoNumber?: string | null; projectContractRef?: string | null;
  /** Never sent: the PMO-recorded dates stay PMO-only. */
  receivedDate?: string | null; dueDate?: string | null;
}
export interface InvoiceMaps {
  companyCurrency: string;
  /** `res.currency.rounding` for the Odoo company's currency. */
  currencyRounding?: number;
  /** The rounding increment from Odoo's `decimal.precision` record used by account.move.line.quantity. */
  quantityRounding?: number;
  partners: Readonly<Record<string, number>>;
  items: Readonly<Record<string, { productId: number; incomeAccountId: number | null }>>;
  units: Readonly<Record<string, number>>;
  /** The project's cost account; null when the invoice has no project (the gate is off). */
  costAccountId: number | null;
  /** From `selectSaleTaxes`; an empty list is the explicit empty set. */
  taxIds: readonly number[];
  downPayment?: { itemId: string; advanceAccountId: number };
}
export type RefusedThing = 'client' | 'item' | 'unit' | 'quantity-rounding' | 'income-account' | 'down-payment-account' | 'currency' | 'line-amount' | 'line-amount-range' | 'lines' | 'net-negative';
export type InvoiceBodyResult =
  | { outcome: 'ready'; body: Record<string, unknown> }
  | { outcome: 'refused'; code: 'config-rejected'; thing: RefusedThing; name: string };

const MAX_FROZEN_LINE_AMOUNT = 1_000_000_000_000;
const nonblank = (v: string | null | undefined) => (typeof v === 'string' && v.trim() !== '' ? v.trim() : null);

/** The invoice's own reference, else its work order's PO number, else the project's contract reference (as ERPNext). */
export function resolveClientReference(r: { invoice?: string | null; workOrderPo?: string | null; projectContractRef?: string | null }): string | null {
  return nonblank(r.invoice) ?? nonblank(r.workOrderPo) ?? nonblank(r.projectContractRef);
}

const refuse = (thing: RefusedThing, name: string): InvoiceBodyResult => ({ outcome: 'refused', code: 'config-rejected', thing, name });

function reshapeDescription(line: PmoInvoiceLine, currency: string): string {
  if (line.amount === undefined) return line.description;
  if (!line.unit) {
    return `${line.description} (${formatTimeMaterialsNumber(line.quantity, currency)} x ${formatTimeMaterialsNumber(line.unitPrice, currency)})`;
  }

  const suffix = ` (${line.unit})`;
  const label = line.description.endsWith(suffix) ? line.description.slice(0, -suffix.length) : line.description;
  return formatTimeMaterialsDescription(label, line.unit, line.quantity, line.unitPrice, line.amount, currency);
}

export function buildInvoiceBody(invoice: PmoInvoice, maps: InvoiceMaps): InvoiceBodyResult {
  if (invoice.currency !== maps.companyCurrency) return refuse('currency', invoice.currency);
  if (invoice.lines.length === 0) return refuse('lines', invoice.id);
  const partnerId = maps.partners[invoice.customerId];
  if (partnerId === undefined) return refuse('client', invoice.customerId);

  const lines: Array<[0, 0, Record<string, unknown>]> = [];
  let netCents = 0;
  const currencyRounding = maps.currencyRounding ?? 0.01;
  if (!Number.isFinite(currencyRounding) || currencyRounding <= 0) return refuse('currency', invoice.currency);
  for (const line of invoice.lines) {
    const item = maps.items[line.itemId];
    if (!item) return refuse('item', line.itemId);
    let quantity = line.quantity;
    let unitPrice = line.unitPrice;
    let description = line.description;
    const unitId = line.unit === undefined ? null : maps.units[line.unit];
    if (unitId === undefined) return refuse('unit', line.unit!);
    if (line.amount !== undefined) {
      if (!Number.isFinite(line.amount)) return refuse('line-amount', line.description);
      if (Math.abs(line.amount) >= MAX_FROZEN_LINE_AMOUNT) return refuse('line-amount-range', line.description);
      const quantityRounding = maps.quantityRounding;
      if (quantityRounding === undefined || !Number.isFinite(quantityRounding) || quantityRounding <= 0) return refuse('quantity-rounding', line.description);
      if (odooFloatRound(line.amount, { precisionRounding: currencyRounding }) !== line.amount) return refuse('line-amount', line.description);
      if (odooLineSubtotal(quantity, unitPrice, quantityRounding, currencyRounding) !== line.amount) {
        description = reshapeDescription(line, invoice.currency);
        quantity = 1;
        unitPrice = line.amount;
      }
    }
    if (line.kind) {
      const advance = maps.downPayment;
      if (line.incomeAccountId !== undefined || !advance || advance.itemId !== line.itemId || item.incomeAccountId !== advance.advanceAccountId) return refuse('down-payment-account', line.itemId);
    } else if (line.incomeAccountId === undefined && item.incomeAccountId === null) {
      return refuse('income-account', line.itemId);
    }
    netCents += Math.round((line.amount ?? quantity * unitPrice) * 100);
    lines.push([0, 0, {
      product_id: item.productId, name: description, quantity, price_unit: unitPrice, ...(unitId === null ? {} : { product_uom_id: unitId }),
      tax_ids: [[6, 0, [...maps.taxIds]]],
      ...(maps.costAccountId === null ? {} : { analytic_distribution: { [String(maps.costAccountId)]: 100 } }),
      ...(line.incomeAccountId === undefined ? {} : { account_id: line.incomeAccountId }),
    }]);
  }
  // Odoo refuses to post a negative total and would leave a draft behind; a zero total posts and reads paid (V-OCI1).
  if (netCents < 0) return refuse('net-negative', invoice.id);

  const ref = resolveClientReference({ invoice: invoice.referenceNumber, workOrderPo: invoice.workOrderPoNumber, projectContractRef: invoice.projectContractRef });
  return {
    outcome: 'ready',
    body: { move_type: 'out_invoice', partner_id: partnerId, invoice_date: invoice.invoiceDate, ...(ref === null ? {} : { ref }), invoice_line_ids: lines },
  };
}
