import type { SalesInvoiceRow, SalesInvoiceStatus } from '@/src/lib/db/revenue';
import { isPartlyPaid } from '@/src/lib/revenue/nativeInvoice';

/** Status filter segments. "PartlyPaid" is a display state of a PMO invoice (DD-NAR-3), never a stored status. */
export type StatusFilter = 'All' | SalesInvoiceStatus | 'PartlyPaid';
export const ERP_STATUS_FILTERS: StatusFilter[] = ['All', 'Draft', 'Submitted', 'Unpaid', 'PartlyPaid', 'Paid', 'Cancelled'];
/** M-7: PMO invoices are never "Submitted" (DD-NAR-3: Draft → Unpaid → Paid); a part-paid one is its own filter. */
export const NATIVE_STATUS_FILTERS: StatusFilter[] = ['All', 'Draft', 'Unpaid', 'PartlyPaid', 'Paid', 'Cancelled'];

export function salesInvoiceStatusLabel(status: StatusFilter, t: (key: string, fallback: string) => string): string {
  const labels: Record<StatusFilter, string> = {
    All: t('financeCopy.statusAll', 'All'),
    Draft: t('financeCopy.statusDraft', 'Draft'),
    Submitted: t('financeCopy.statusSubmitted', 'Submitted'),
    Unpaid: t('financeCopy.statusUnpaid', 'Unpaid'),
    PartlyPaid: t('financeCopy.statusPartlyPaid', 'Partly paid'),
    Paid: t('financeCopy.statusPaid', 'Paid'),
    Cancelled: t('financeCopy.statusCancelled', 'Cancelled'),
  };
  return labels[status];
}

/** What the status filter matches. A part-paid invoice reads "Partly paid", so it is under that filter, not Unpaid. */
export function matchesStatus(inv: SalesInvoiceRow, filter: StatusFilter): boolean {
  if (filter === 'All') return true;
  if (filter === 'PartlyPaid') return isPartlyPaid(inv);
  if (filter === 'Unpaid' || filter === 'Submitted') return inv.status === filter && !isPartlyPaid(inv);
  return inv.status === filter;
}
