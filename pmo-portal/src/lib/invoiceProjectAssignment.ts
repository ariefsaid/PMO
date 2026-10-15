import type { SalesInvoiceRow } from '@/src/lib/db/revenue';

export function canAttributeInvoice(invoice: SalesInvoiceRow): boolean {
  return !invoice.pmo_native && Boolean(invoice.si_number)
    && invoice.author_user_id === null && invoice.author_user_ids.length === 0;
}
