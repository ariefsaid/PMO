/**
 * AC-SAR-060 — erpnext/feedKinds.ts: Payment Entry inbound disambiguation by payment_type.
 *   Receive → 'incoming-payment' / domain 'revenue' / table 'incoming_payments'
 *   Pay → 'payment' / domain 'procurement' / table 'payments'
 * Sales Invoice is a unique doctype → 'sales-invoice' (no disambiguation needed).
 */
import { describe, expect, it } from 'vitest';
import {
  kindFromDoctype,
  kindFromDoctypeAndPaymentType,
  KIND_DOMAIN,
  KIND_MIRROR_TABLE,
  externalIdForKind,
} from './feedKinds.ts';

describe('erpnext/feedKinds — Payment Entry disambiguation (AC-SAR-060)', () => {
  it('Payment Entry with payment_type=Receive → incoming-payment (revenue domain)', () => {
    const kind = kindFromDoctypeAndPaymentType('Payment Entry', 'Receive');
    expect(kind).toBe('incoming-payment');
    expect(KIND_DOMAIN[kind!]).toBe('revenue');
    expect(KIND_MIRROR_TABLE[kind!]).toBe('incoming_payments');
  });

  it('Payment Entry with payment_type=Pay → payment (procurement domain)', () => {
    const kind = kindFromDoctypeAndPaymentType('Payment Entry', 'Pay');
    expect(kind).toBe('payment');
    expect(KIND_DOMAIN[kind!]).toBe('procurement');
    expect(KIND_MIRROR_TABLE[kind!]).toBe('payments');
  });

  it('Payment Entry with unknown/absent payment_type → undefined (ack-and-skip, lossy hint)', () => {
    expect(kindFromDoctypeAndPaymentType('Payment Entry', 'Unknown')).toBeUndefined();
    expect(kindFromDoctypeAndPaymentType('Payment Entry', undefined)).toBeUndefined();
    expect(kindFromDoctypeAndPaymentType('Payment Entry', '')).toBeUndefined();
  });

  it('Sales Invoice is a unique doctype → sales-invoice (no disambiguation)', () => {
    const kind = kindFromDoctype('Sales Invoice');
    expect(kind).toBe('sales-invoice');
    expect(KIND_DOMAIN[kind!]).toBe('revenue');
    expect(KIND_MIRROR_TABLE[kind!]).toBe('sales_invoices');
  });

  it('kindFromDoctype still works for Payment Entry (returns one kind, but disambiguation requires payment_type)', () => {
    // kindFromDoctype alone cannot disambiguate - it returns the first match
    const kind = kindFromDoctype('Payment Entry');
    // The registry has 'payment' first, but the feed should use kindFromDoctypeAndPaymentType
    expect(['payment', 'incoming-payment']).toContain(kind);
  });

  it('externalIdForKind encodes parties with prefix, uses raw name for revenue kinds', () => {
    expect(externalIdForKind('customer', 'CUST-001')).toBe('Customer:CUST-001');
    expect(externalIdForKind('supplier', 'SUPP-001')).toBe('Supplier:SUPP-001');
    expect(externalIdForKind('sales-invoice', 'SINV-001')).toBe('SINV-001');
    expect(externalIdForKind('incoming-payment', 'PE-REC-001')).toBe('PE-REC-001');
    expect(externalIdForKind('payment', 'PE-PAY-001')).toBe('PE-PAY-001');
  });
});