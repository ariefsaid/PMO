/**
 * erpnext/piStatus.ts (Slice 6, task 6.12) — derives the PMO `procurement_invoices.status`
 * (`procurement_invoice_status`: `'Received'|'Scheduled'|'Paid'`) from ERPNext's mirrored
 * `erp_outstanding_amount` (R9 paid-detection: a referenced Payment Entry submit flips the Purchase
 * Invoice's `outstanding_amount` to `0` server-side — the mirror never recomputes this, ADR-0048).
 * Mirrors the `poGrStatus.ts` idiom (table-agnostic derivation, table-specific status CHECK domain).
 */

export type ProcurementInvoiceStatus = 'Received' | 'Scheduled' | 'Paid';

/** `erp_outstanding_amount` is the decimal-string money shape (moneyShape.ts) mirrored from ERP's
 *  `outstanding_amount` — `"0.00"` (or any zero-valued decimal string) means the invoice is fully
 *  paid; a present non-zero value or `null` (not yet returned/derived) stays `'Received'` (the
 *  initial capture state — no PMO-side "Scheduled" derivation exists yet, `'Scheduled'` remains a
 *  manual/legacy value this mirror never sets). */
export function derivePiStatus(erpOutstandingAmount: string | null | undefined): ProcurementInvoiceStatus {
  if (erpOutstandingAmount != null && Number(erpOutstandingAmount) === 0) return 'Paid';
  return 'Received';
}
