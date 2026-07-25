/**
 * erpnext/poGrStatus.ts (Slice 5, task 5.7) — derives the PMO `status` CHECK value from ERPNext's
 * `docstatus` for `purchase_orders`/`procurement_receipts` (FR-ENA-113/114). See the test file for
 * why `docstatus:2` maps to the closest "done" value rather than a new CHECK value: cancellation is
 * tracked separately via the soft-tombstone `erp_cancelled_at` (erpnext/lineage.ts).
 */

export type PurchaseOrderStatus = 'Draft' | 'Issued' | 'Acknowledged' | 'Closed';
export type ProcurementReceiptStatus = 'Partial' | 'Complete';

/** `purchase_orders.status` (FR-ENA-113): 0 -> Draft, 1 -> Issued (submitted/sent), 2 -> Closed. */
export function derivePurchaseOrderStatus(docstatus: number | null | undefined): PurchaseOrderStatus {
  if (docstatus === 1) return 'Issued';
  if (docstatus === 2) return 'Closed';
  return 'Draft';
}

/** `procurement_receipts.status` (FR-ENA-114, `procurement_receipt_status`): the receipt is
 *  Complete once submitted (docstatus 1); Draft/cancelled stays Partial. */
export function deriveProcurementReceiptStatus(docstatus: number | null | undefined): ProcurementReceiptStatus {
  return docstatus === 1 ? 'Complete' : 'Partial';
}
