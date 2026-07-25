/**
 * erpnext/siStatus.ts (P3a, FR-SAR-103) — derives the PMO `sales_invoices.status`
 * (`'Draft'|'Submitted'|'Unpaid'|'Paid'|'Cancelled'`) from ERPNext's mirrored `docstatus` +
 * `erp_outstanding_amount` (R9 §2 AR paid-detection: a referenced PE-receive submit flips the SI's
 * `outstanding_amount` to 0 server-side — the mirror never recomputes this, ADR-0048).
 */
export type SalesInvoiceStatus = 'Draft' | 'Submitted' | 'Unpaid' | 'Paid' | 'Cancelled';

/**
 * Derives the PMO sales invoice status from ERP docstatus and outstanding amount.
 * - docstatus 2 → 'Cancelled' (takes precedence)
 * - docstatus 1 + outstanding_amount === 0 → 'Paid' (server-side flip via PE-receive)
 * - docstatus 1 + outstanding_amount > 0 → 'Unpaid'
 * - docstatus 0/null → 'Draft'
 */
export function deriveSiStatus(
  erpOutstandingAmount: string | null | undefined,
  docstatus: number | null | undefined,
): SalesInvoiceStatus {
  if (docstatus === 2) return 'Cancelled';
  if (docstatus === 1) {
    // a submitted SI with outstanding 0 is Paid; otherwise Unpaid (R9: a submitted SI is Unpaid until paid)
    // empty string / null / undefined are NOT zero — only explicit "0" or "0.00" means Paid
    const outstanding = typeof erpOutstandingAmount === 'string' ? erpOutstandingAmount.trim() : erpOutstandingAmount;
    return outstanding != null && outstanding !== '' && Number(outstanding) === 0 ? 'Paid' : 'Unpaid';
  }
  return 'Draft'; // docstatus 0 / null
}