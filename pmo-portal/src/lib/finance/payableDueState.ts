/**
 * The ONE due-state rule for an unpaid supplier invoice, read by the Payables list colours, its
 * "overdue" filter and count, and the Finance hub's queue line. Supplier invoices carry no due date,
 * so their age (calendar days since the supplier invoice date) decides it: past 90 days is overdue,
 * the 30 days before that are due soon, anything younger (or with no age) is normal.
 */
export type PayableDueState = 'overdue' | 'dueSoon' | 'normal';

export const PAYABLE_OVERDUE_AFTER_DAYS = 90;
export const PAYABLE_DUE_SOON_AFTER_DAYS = 60;

export function payableDueState(ageDays: number | null | undefined): PayableDueState {
  if (ageDays == null) return 'normal';
  if (ageDays > PAYABLE_OVERDUE_AFTER_DAYS) return 'overdue';
  if (ageDays > PAYABLE_DUE_SOON_AFTER_DAYS) return 'dueSoon';
  return 'normal';
}
