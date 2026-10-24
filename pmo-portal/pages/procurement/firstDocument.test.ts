import { describe, expect, it } from 'vitest';
import { gateHold, recordableFirstKinds } from './firstDocument';

const OFF = { request_before_order: false, approval_before_order: false, approval_before_payment: false, receipt_before_invoice: false };

describe('recordableFirstKinds — filtered by who may record each', () => {
  it('a requester with no other role may only open with a request', () => {
    expect(recordableFirstKinds({ canSource: false, canReceive: false, canInvoicePay: false })).toEqual(['purchase_request']);
  });
  it('Finance may open with a request, order, invoice or payment but cannot receive goods unless it may', () => {
    expect(recordableFirstKinds({ canSource: true, canReceive: false, canInvoicePay: true }))
      .toEqual(['purchase_request', 'rfq', 'purchase_order', 'vendor_invoice', 'payment']);
  });
  it('lists every kind in the lifecycle order for a role that may do all of them', () => {
    expect(recordableFirstKinds({ canSource: true, canReceive: true, canInvoicePay: true }))
      .toEqual(['purchase_request', 'rfq', 'purchase_order', 'goods_receipt', 'vendor_invoice', 'payment']);
  });
});

describe('gateHold — annotated by the active purchase rules (AC-PFE-003)', () => {
  it('holds nothing while every rule is off, or while the rules are not yet known', () => {
    for (const kind of ['purchase_order', 'vendor_invoice', 'payment'] as const) {
      expect(gateHold(kind, OFF)).toBeNull();
      expect(gateHold(kind, undefined)).toBeNull();
    }
  });
  it('an order waits for a request, or for an approval', () => {
    expect(gateHold('purchase_order', { ...OFF, request_before_order: true })).toBe('request');
    expect(gateHold('purchase_order', { ...OFF, approval_before_order: true })).toBe('approval');
  });
  it('an invoice waits for a receipt; a payment waits for an approval', () => {
    expect(gateHold('vendor_invoice', { ...OFF, receipt_before_invoice: true })).toBe('receipt');
    expect(gateHold('payment', { ...OFF, approval_before_payment: true })).toBe('approval');
  });
  it('a request, quote request and goods receipt are never held', () => {
    const ALL = { request_before_order: true, approval_before_order: true, approval_before_payment: true, receipt_before_invoice: true };
    for (const kind of ['purchase_request', 'rfq', 'goods_receipt'] as const) expect(gateHold(kind, ALL)).toBeNull();
  });
});
