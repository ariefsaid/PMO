import type { IncomingPaymentRow, SalesInvoiceRow } from '@/src/lib/db/revenue';
import { paidToDate } from '@/src/lib/revenue/nativeInvoice';

/** Payment facts available from the native balance and the existing receipt read. */
export function salesInvoicePaymentFacts(invoice: SalesInvoiceRow | null, payments: {
  data?: IncomingPaymentRow[];
  isPending: boolean;
  isError: boolean;
}): { amount: number | null; date: string | null } {
  const amount = invoice ? paidToDate(invoice) : null;
  const matching = invoice?.pmo_native && !payments.isPending && !payments.isError
    ? (payments.data ?? []).filter((payment) => payment.pmo_native && payment.status === 'Paid'
      && !payment.cancelled_at && !payment.erp_cancelled_at
      && payment.allocations?.some((allocation) => allocation.sales_invoice_id === invoice.id))
    : [];
  const receipt = matching.length === 1 ? matching[0] : null;
  const allocations = receipt?.allocations?.filter((allocation) => allocation.sales_invoice_id === invoice?.id) ?? [];
  const date = receipt && amount != null && allocations.length === 1
    && allocations[0].currency === invoice?.currency && allocations[0].amount === amount
    ? receipt.date : null;
  return { amount, date };
}
