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

describe('gateHold — cumulative by target step, as the server applies them (AC-PFE-003)', () => {
  const KINDS = ['purchase_request', 'rfq', 'purchase_order', 'goods_receipt', 'vendor_invoice', 'payment'] as const;
  type Kind = (typeof KINDS)[number];

  // Mirror of procurement_gate_violation on an empty Draft (no request, approval or receipt on file): the order
  // gates bind every step from Ordered up, the receipt gate every step from Vendor Invoiced up, the payment gate Paid.
  function serverHold(kind: Kind, g: typeof OFF): string | null {
    const rank = { purchase_request: 0, rfq: 3, purchase_order: 5, goods_receipt: 6, vendor_invoice: 7, payment: 8 }[kind];
    if (rank >= 5 && g.request_before_order) return 'request';
    if (rank >= 5 && g.approval_before_order) return 'approval';
    if (rank >= 7 && g.receipt_before_invoice) return 'receipt';
    if (kind === 'payment' && g.approval_before_payment) return 'approval';
    return null;
  }

  it('matches the server for every combination of the four rules and every first kind', () => {
    for (let mask = 0; mask < 16; mask += 1) {
      const g = {
        request_before_order: Boolean(mask & 1), approval_before_order: Boolean(mask & 2),
        approval_before_payment: Boolean(mask & 4), receipt_before_invoice: Boolean(mask & 8),
      };
      for (const kind of KINDS) expect(gateHold(kind, g), `${kind} @ ${JSON.stringify(g)}`).toBe(serverHold(kind, g));
    }
  });
  it('holds nothing while every rule is off, or while the rules are not yet known', () => {
    for (const kind of KINDS) {
      expect(gateHold(kind, OFF)).toBeNull();
      expect(gateHold(kind, undefined)).toBeNull();
    }
  });
  it('a request-before-order rule holds the goods receipt, invoice and payment as well as the order', () => {
    for (const kind of ['purchase_order', 'goods_receipt', 'vendor_invoice', 'payment'] as const) {
      expect(gateHold(kind, { ...OFF, request_before_order: true })).toBe('request');
    }
  });
  it('a receipt-before-invoice rule holds the payment as well as the invoice', () => {
    expect(gateHold('vendor_invoice', { ...OFF, receipt_before_invoice: true })).toBe('receipt');
    expect(gateHold('payment', { ...OFF, receipt_before_invoice: true })).toBe('receipt');
    expect(gateHold('goods_receipt', { ...OFF, receipt_before_invoice: true })).toBeNull();
  });
  it('a request, quote request are never held; the goods receipt is held only by the order rules', () => {
    const ALL = { request_before_order: true, approval_before_order: true, approval_before_payment: true, receipt_before_invoice: true };
    for (const kind of ['purchase_request', 'rfq'] as const) expect(gateHold(kind, ALL)).toBeNull();
    expect(gateHold('goods_receipt', ALL)).toBe('request');
    expect(gateHold('goods_receipt', { ...OFF, approval_before_order: true })).toBe('approval');
  });
});
