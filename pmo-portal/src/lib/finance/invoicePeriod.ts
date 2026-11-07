import type { SalesInvoiceRow } from '@/src/lib/db/revenue';

/**
 * #1461 drill-through parity: the window a dashboard period figure drills with, and the rule
 * that keeps exactly the records the figure counts.
 *
 * The dashboard's "Invoiced · excl. tax" figure sums billed work from get_management_pack
 * (migration 0323 §counted): invoices with status Submitted/Unpaid/Paid, not ERP-cancelled,
 * invoice_date within the inclusive month window. A receivables drill carries that window as
 * `from`/`to` month tokens; applying the same rule to the invoice list makes it show exactly
 * the records behind the figure.
 */

const MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/u;

/** Validated inclusive month window from URL month tokens, or null when either is absent/invalid. */
export function monthWindowFromParams(
  from: string | null,
  to: string | null,
): { from: string; to: string } | null {
  if (from === null || to === null || !MONTH_PATTERN.test(from) || !MONTH_PATTERN.test(to)) return null;
  if (Number(from.slice(0, 4)) < 1900 || Number(to.slice(0, 4)) < 1900) return null;
  return { from, to };
}

/** Exclusive upper bound (first day after the `to` month) as a YYYY-MM-DD date string. */
export function monthWindowExclusiveEnd(to: string): string {
  const [year, month] = to.split('-').map(Number);
  return month === 12 ? `${year + 1}-01-01` : `${year}-${String(month + 1).padStart(2, '0')}-01`;
}

/** The management-pack invoiced rule at invoice granularity (0323 §counted, minus line-level splits). */
export function issuedWithinMonthWindow(
  invoice: Pick<SalesInvoiceRow, 'status' | 'invoice_date' | 'erp_cancelled_at' | 'erp_docstatus'>,
  window: { from: string; to: string },
): boolean {
  if (invoice.status !== 'Submitted' && invoice.status !== 'Unpaid' && invoice.status !== 'Paid') return false;
  if (invoice.erp_cancelled_at) return false;
  if ((invoice.erp_docstatus ?? 1) === 2) return false;
  const date = invoice.invoice_date;
  if (!date) return false;
  return date >= `${window.from}-01` && date < monthWindowExclusiveEnd(window.to);
}
