export type ProcurementStage = 'Request' | 'Order' | 'Receive' | 'Pay';
export type StageKey = 'request' | 'order' | 'receive' | 'pay';
export const PROCUREMENT_STAGES: ProcurementStage[] = ['Request', 'Order', 'Receive', 'Pay'];

export function payStepLabel(hasPayment: boolean): 'Invoiced' | 'Paid' {
  return hasPayment ? 'Paid' : 'Invoiced';
}

export function stageForStatus(status: string): ProcurementStage {
  if (status === 'Ordered') return 'Order';
  if (status === 'Received') return 'Receive';
  if (status === 'Vendor Invoiced' || status === 'Paid') return 'Pay';
  return 'Request';
}

export function stageLabelForStatus(status: string): ProcurementStage | 'Invoiced, not paid' | 'Paid' {
  if (status === 'Vendor Invoiced') return 'Invoiced, not paid';
  if (status === 'Paid') return 'Paid';
  return stageForStatus(status);
}

type DateRow = { date?: string | null; created_at?: string | null; receipt_date?: string | null; invoice_date?: string | null };
type LinkedDocument = { doctype: string; docDate?: string | null };

export interface StageDates {
  request: string | null;
  order: string | null;
  receive: string | null;
  pay: string | null;
}

function firstDate(values: Array<string | null | undefined>): string | null {
  return values.filter((value): value is string => Boolean(value)).sort((a, b) => a.localeCompare(b))[0] ?? null;
}

/** First evidenced date for each of the four user-facing stages. */
export function stageDates(
  detail: {
    purchase_requests?: readonly DateRow[];
    purchase_orders?: readonly DateRow[];
    receipts?: readonly DateRow[];
    invoices?: readonly DateRow[];
    payments?: readonly DateRow[];
  },
  linked: readonly LinkedDocument[] = [],
): StageDates {
  const linkedDates = (doctype: string) => linked.filter((doc) => doc.doctype === doctype).map((doc) => doc.docDate);
  return {
    request: firstDate((detail.purchase_requests ?? []).map((row) => row.date ?? row.created_at)),
    order: firstDate([
      ...(detail.purchase_orders ?? []).map((row) => row.date ?? row.created_at),
      ...linkedDates('Purchase Order'),
    ]),
    receive: firstDate([
      ...(detail.receipts ?? []).map((row) => row.receipt_date ?? row.created_at),
      ...linkedDates('Purchase Receipt'),
    ]),
    pay: firstDate([
      ...(detail.invoices ?? []).map((row) => row.invoice_date ?? row.created_at),
      ...(detail.payments ?? []).map((row) => row.date ?? row.created_at),
      ...linkedDates('Purchase Invoice'),
      ...linkedDates('Payment Entry'),
    ]),
  };
}
