/**
 * purchaseValue — does a purchase have a value yet? "Mark as Paid" is offered only when it does (D2 review C3): a
 * purchase started at a later step may carry no line items, and paying one with nothing on it would close a purchase
 * that counts for nothing in committed spend. A value is a line item (or the total the server derived from them), or a recorded document with an amount.
 */
interface WithAmount { amount?: number | string | null }

export interface PurchaseValueFacts {
  items: readonly unknown[];
  /** The server's value for the purchase (derived from its line items); what committed spend counts. */
  total_value?: number | string | null;
  purchase_requests?: readonly WithAmount[] | null;
  purchase_orders?: readonly WithAmount[] | null;
  invoices?: readonly WithAmount[] | null;
  payments?: readonly WithAmount[] | null;
  quotations?: readonly { total_amount?: number | string | null }[] | null;
}

const positive = (v: number | string | null | undefined) => Number(v ?? 0) > 0;

export function purchaseHasValue(p: PurchaseValueFacts): boolean {
  return p.items.length > 0 || positive(p.total_value)
    || [p.purchase_requests, p.purchase_orders, p.invoices, p.payments].some((rows) => (rows ?? []).some((r) => positive(r.amount)))
    || (p.quotations ?? []).some((q) => positive(q.total_amount));
}
