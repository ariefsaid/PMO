import type { IncomingPaymentRow, SalesInvoiceRow } from '@/src/lib/db/revenue';

/** The invoices a PMO receipt can be applied to: same customer, PMO-native, approved, same currency, still owing. */
export function applicableInvoices(receipt: IncomingPaymentRow, invoices: SalesInvoiceRow[]): SalesInvoiceRow[] {
  return invoices.filter((inv) => Boolean(inv.pmo_native)
    && inv.status === 'Unpaid'
    && inv.customer_id === receipt.customer_id
    && inv.currency === receipt.currency
    && (inv.erp_outstanding_amount ?? 0) > 0);
}
