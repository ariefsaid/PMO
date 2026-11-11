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
  if (row.pmo_native) {
    // #1415: a PMO receipt's unapplied cash is what its live allocations have not taken — amount less Σ allocations. Not loaded = unknown.
    if (!row.allocations || row.amount == null) return null;
    let taken = 0;
    for (const a of row.allocations) {
      if (a.currency !== row.currency) return null;
      taken += cents(a.amount);
    }
    const left = cents(row.amount) - taken;
    return left < 0 ? null : left / 100;
  }
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

/**
 * The allocations to show for a row. A PMO-native receipt settles exactly its LIVE allocations (#1415: `[]` = on account; `null` = the
 * embed was not loaded, which is unknown, never "nothing applied"); a receipt PMO sent to Odoo settles exactly its one named invoice
 * (PMO is the authority, so nothing is "unreported"); an ERP-mirrored receipt shows only what the ERP reported (`null` = unknown).
 */
export function displayAllocations(
  row: IncomingPaymentRow,
  invoiceNumberOf: (invoiceId: string) => string | null,
): ReceiptAllocation[] | null {
  if (row.pmo_native) {
    // The receipt's own sales_invoice_id is only where it was recorded from; it settles nothing by itself.
    return row.allocations
      ? row.allocations.map((a) => ({
        invoice_id: a.sales_invoice_id,
        invoice_number: invoiceNumberOf(a.sales_invoice_id) ?? '—',
        amount: a.amount.toFixed(2),
        currency: a.currency,
      }))
      : null;
  }
  const mirrored = receiptAllocations(row);
  // A receipt PMO sent to Odoo (it has a send command) is PMO's own record too: it names the one invoice it settles.
  if (mirrored !== null || row.push_command_state == null) return mirrored;
  const number = row.sales_invoice_id ? invoiceNumberOf(row.sales_invoice_id) : null;
  if (!row.sales_invoice_id || number === null || row.amount == null) return null;
  return [{ invoice_id: row.sales_invoice_id, invoice_number: number, amount: row.amount.toFixed(2), currency: row.currency }];
}
