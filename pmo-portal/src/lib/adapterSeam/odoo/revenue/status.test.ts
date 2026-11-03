import { describe, expect, it } from 'vitest';
import { classifyPaymentDirection, creditNoteStatus, invoiceReceiptAwaitingOdoo, invoiceStatus, paymentStatus } from './status.ts';

describe('AC-OCI-071 invoice status is read from Odoo, never set by PMO', () => {
  it.each([
    ['draft', '1110.00', { mirrored: false, status: null, cancelled: false }],
    ['draft', undefined, { mirrored: false, status: null, cancelled: false }],
    ['posted', '1110.00', { mirrored: true, status: 'Unpaid', cancelled: false }],
    ['posted', '0.01', { mirrored: true, status: 'Unpaid', cancelled: false }],
    ['posted', '0.00', { mirrored: true, status: 'Paid', cancelled: false }],
    ['posted', 0, { mirrored: true, status: 'Paid', cancelled: false }],
    ['posted', '0', { mirrored: true, status: 'Paid', cancelled: false }],
    ['posted', undefined, { mirrored: true, status: 'Unpaid', cancelled: false }],
    ['posted', '', { mirrored: true, status: 'Unpaid', cancelled: false }],
    ['posted', null, { mirrored: true, status: 'Unpaid', cancelled: false }],
    ['cancel', '1110.00', { mirrored: true, status: 'Cancelled', cancelled: true }],
    ['cancel', '0.00', { mirrored: true, status: 'Cancelled', cancelled: true }],
  ] as const)('%s residual %s → %o', (state, residual, expected) => expect(invoiceStatus(state, residual)).toEqual(expected));

  it('an unknown state is not guessed: nothing is mirrored and nothing is cancelled', () => {
    expect(invoiceStatus('weird', '0.00')).toEqual({ mirrored: false, status: null, cancelled: false });
    expect(invoiceStatus(undefined, '0.00')).toEqual({ mirrored: false, status: null, cancelled: false });
  });
});

describe('AC-OCI-071 credit notes mirror as negative documents; cancelled is marked, never deleted', () => {
  it.each([
    ['draft', { mirrored: false, status: null, cancelled: false, negative: true }],
    ['posted', { mirrored: true, status: 'Posted', cancelled: false, negative: true }],
    ['cancel', { mirrored: true, status: 'Cancelled', cancelled: true, negative: true }],
    ['weird', { mirrored: false, status: null, cancelled: false, negative: true }],
  ] as const)('%s → %o', (state, expected) => expect(creditNoteStatus(state)).toEqual(expected));
});

describe('AC-OCI-071 receipt status', () => {
  it.each([
    ['draft', { mirrored: true, status: 'Scheduled', cancelled: false }],
    ['paid', { mirrored: true, status: 'Paid', cancelled: false }],
    ['reconciled', { mirrored: true, status: 'Paid', cancelled: false }],
    ['canceled', { mirrored: true, status: 'Cancelled', cancelled: true }],
    ['rejected', { mirrored: true, status: 'Cancelled', cancelled: true }],
    ['in_process', { mirrored: false, status: null, cancelled: false }],
    ['posted', { mirrored: false, status: null, cancelled: false }],
    ['cancel', { mirrored: false, status: null, cancelled: false }],
    ['weird', { mirrored: false, status: null, cancelled: false }],
  ] as const)('%s → %o', (state, expected) => expect(paymentStatus(state)).toEqual(expected));
});

describe('AC-OCI-054 a receipt does not mark its invoice Paid before a fresh Odoo invoice read', () => {
  it('shows awaiting Odoo while the latest receipt command is newer than the invoice mirror', () => {
    expect(invoiceReceiptAwaitingOdoo({
      invoiceStatus: 'Unpaid',
      invoiceErpModified: '2026-11-02T09:00:00.000Z',
      receiptCommandState: 'confirmed',
      receiptCommandCreatedAt: '2026-11-02T09:00:30.000Z',
    })).toBe(true);
  });

  it('clears awaiting Odoo after the invoice mirror advances past the receipt command', () => {
    expect(invoiceReceiptAwaitingOdoo({
      invoiceStatus: 'Unpaid',
      invoiceErpModified: '2026-11-02T09:02:00.000Z',
      receiptCommandState: 'confirmed',
      receiptCommandCreatedAt: '2026-11-02T09:00:30.000Z',
    })).toBe(false);
  });

  it('keeps awaiting Odoo when second-resolution timestamps are equal because read order is ambiguous', () => {
    expect(invoiceReceiptAwaitingOdoo({
      invoiceStatus: 'Unpaid',
      invoiceErpModified: '2026-11-02T09:00:30.000Z',
      receiptCommandState: 'confirmed',
      receiptCommandCreatedAt: '2026-11-02T09:00:30.000Z',
    })).toBe(true);
  });

  it('stays awaiting while the receipt is still committing even if a read falls after outbox creation', () => {
    expect(invoiceReceiptAwaitingOdoo({
      invoiceStatus: 'Unpaid',
      invoiceErpModified: '2026-11-02T09:00:30.000Z',
      receiptCommandState: 'committing',
      receiptCommandCreatedAt: '2026-11-02T09:00:00.000Z',
    })).toBe(true);
  });

  it.each(['Paid', 'Cancelled'])('%s remains authoritative even if a receipt command is newer', (invoiceStatus) => {
    expect(invoiceReceiptAwaitingOdoo({
      invoiceStatus,
      invoiceErpModified: null,
      receiptCommandState: 'committed',
      receiptCommandCreatedAt: '2026-11-02T09:00:00.000Z',
    })).toBe(false);
  });

  it('does not call a failed receipt a sent receipt', () => {
    expect(invoiceReceiptAwaitingOdoo({
      invoiceStatus: 'Unpaid',
      invoiceErpModified: null,
      receiptCommandState: 'failed',
      receiptCommandCreatedAt: '2026-11-02T09:00:00.000Z',
    })).toBe(false);
  });
});

describe('AC-OCI-071 payment direction follows what Odoo states, as the shared receipt.read expectations', () => {
  const receipt = { kind: 'receipt', domain: 'revenue', table: 'incoming_payments' };
  const vendor = { kind: 'vendor-payment', domain: 'procurement', table: 'payments' };
  it('inbound from a customer is a receipt; outbound to a supplier is a vendor payment', () => {
    expect(classifyPaymentDirection('inbound', 'customer')).toEqual(receipt);
    expect(classifyPaymentDirection('outbound', 'supplier')).toEqual(vendor);
  });
  it('anything else, blank or absent is skipped, never guessed (a customer refund and a supplier refund included)', () => {
    for (const [type, partner] of [['inbound', 'supplier'], ['outbound', 'customer'], ['transfer', 'customer'], ['', ''], [undefined, undefined], ['inbound', undefined], [undefined, 'customer'], ['INBOUND', 'customer'], [false, false]] as const) {
      expect(classifyPaymentDirection(type as never, partner as never), `${type}/${partner}`).toEqual({ kind: 'skipped' });
    }
  });
});
