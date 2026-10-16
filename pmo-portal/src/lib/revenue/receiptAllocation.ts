import type { IncomingPaymentRow } from '@/src/lib/db/revenue';

/** One invoice a receipt settled, as the ERP reported it. `amount` is an exact decimal string; `null` = the source
 *  gave no figure. `currency` is the allocation's own denomination (null = not recorded). */
export interface ReceiptAllocation {
  invoice_id: string | null;
  invoice_number: string;
  amount: string | null;
  currency: string | null;
}

/** The ERP-authored allocations. `null` = coverage unknown (never read as "none"); `[]` = the source reported none. */
export function receiptAllocations(row: Pick<IncomingPaymentRow, 'allocation_details'>): ReceiptAllocation[] | null {
  const details = row.allocation_details;
  return Array.isArray(details) ? details : null;
}

const cents = (n: number): number => Math.round(n * 100);

/**
 * Cash value the ERP has not matched to any invoice: received + withheld − Σ allocations (DD-RCPT-1: an allocation
 * is the GROSS, so withheld tax counts toward coverage). `null` whenever any input is unknown, an allocation is in
 * another/unrecorded currency, or the allocations exceed the receipt — unknown is never zero, currencies never mix.
 */
export function knownUnappliedCash(row: IncomingPaymentRow): number | null {
  const allocations = receiptAllocations(row);
  if (allocations === null || row.received_amount == null || row.withheld_amount == null) return null;
  let applied = 0;
  for (const a of allocations) {
    if (a.amount == null || a.currency !== row.currency) return null;
    applied += cents(Number(a.amount));
  }
  const remainder = cents(row.received_amount) + cents(row.withheld_amount) - applied;
  return remainder < 0 ? null : remainder / 100;
}
