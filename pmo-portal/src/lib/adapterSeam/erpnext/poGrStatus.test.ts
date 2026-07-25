/**
 * erpnext/poGrStatus.ts (Slice 5, task 5.7) — the PMO `status` CHECK value ERPNext's `docstatus`
 * derives for `purchase_orders`/`procurement_receipts` (FR-ENA-113/114). Neither table's status enum
 * carries a `Cancelled`/`Draft-after-cancel` value — a cancel is tracked via the soft-tombstone
 * `erp_cancelled_at` (lineage.ts), not the status column, so `docstatus:2` maps to the closest legal
 * "done" value for each enum (`Closed` / `Complete`) rather than inventing a new CHECK value.
 */
import { describe, expect, it } from 'vitest';
import { derivePurchaseOrderStatus, deriveProcurementReceiptStatus } from './poGrStatus.ts';

describe('erpnext/poGrStatus — derivePurchaseOrderStatus (FR-ENA-113, status CHECK: Draft|Issued|Acknowledged|Closed)', () => {
  it('docstatus 0 (draft) -> Draft', () => {
    expect(derivePurchaseOrderStatus(0)).toBe('Draft');
  });
  it('docstatus 1 (submitted) -> Issued', () => {
    expect(derivePurchaseOrderStatus(1)).toBe('Issued');
  });
  it('docstatus 2 (cancelled) -> Closed', () => {
    expect(derivePurchaseOrderStatus(2)).toBe('Closed');
  });
  it('null/undefined docstatus (not yet mirrored) -> Draft', () => {
    expect(derivePurchaseOrderStatus(null)).toBe('Draft');
    expect(derivePurchaseOrderStatus(undefined)).toBe('Draft');
  });
});

describe('erpnext/poGrStatus — deriveProcurementReceiptStatus (FR-ENA-114, procurement_receipt_status: Partial|Complete)', () => {
  it('docstatus 1 (submitted) -> Complete', () => {
    expect(deriveProcurementReceiptStatus(1)).toBe('Complete');
  });
  it('docstatus 0 (draft) -> Partial', () => {
    expect(deriveProcurementReceiptStatus(0)).toBe('Partial');
  });
  it('docstatus 2 (cancelled) -> Partial (cancellation is tracked via erp_cancelled_at, not this enum)', () => {
    expect(deriveProcurementReceiptStatus(2)).toBe('Partial');
  });
  it('null/undefined docstatus -> Partial', () => {
    expect(deriveProcurementReceiptStatus(null)).toBe('Partial');
    expect(deriveProcurementReceiptStatus(undefined)).toBe('Partial');
  });
});
