import type { IncomingPaymentRow, SalesInvoiceRow } from '@/src/lib/db/revenue';

export interface NativeReceiptInvoiceContext {
  customerId?: string | null;
  currency?: string | null;
}

/**
 * The shared read-side eligibility rule for native receipt invoice pickers. The allocation RPC
 * remains authoritative and recalculates the balance under its locks; this aligns the two client
 * pickers on invoice state/customer/currency and filters out rows whose reported balance is empty.
 * Reported balance is a display-time candidate signal, never the amount or final server decision.
 */
export function isApplicableNativeReceiptInvoice(
  invoice: SalesInvoiceRow,
  context: NativeReceiptInvoiceContext,
): boolean {
  return Boolean(invoice.pmo_native)
    && invoice.status === 'Unpaid'
    && (!context.customerId || invoice.customer_id === context.customerId)
    && (!context.currency || invoice.currency === context.currency)
    && (invoice.erp_outstanding_amount ?? 0) > 0;
}

/** Candidate rows for native receipt pickers; currency is unknown until a direct invoice is chosen. */
export function nativeReceiptInvoiceCandidates(
  invoices: SalesInvoiceRow[],
  context: NativeReceiptInvoiceContext,
): SalesInvoiceRow[] {
  return invoices.filter((invoice) => isApplicableNativeReceiptInvoice(invoice, context));
}

/** The invoices a PMO receipt can be applied to in the client form. */
export function applicableInvoices(receipt: IncomingPaymentRow, invoices: SalesInvoiceRow[]): SalesInvoiceRow[] {
  return nativeReceiptInvoiceCandidates(invoices, {
    customerId: receipt.customer_id,
    currency: receipt.currency,
  });
}
