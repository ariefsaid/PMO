import { describe, expect, it } from 'vitest';
import { creditNoteStatus, invoiceReceiptAwaitingOdoo, invoiceStatus, paymentStatus } from './status.ts';

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

  // #1825: the two clocks decide nothing once the receipt's own Odoo reference appears in the invoice
  // read-back (single-system evidence), whatever the clocks say.
  it('clears awaiting Odoo on the read-back evidence even when the Odoo clock is behind PMOs', () => {
    expect(invoiceReceiptAwaitingOdoo({
      invoiceStatus: 'Unpaid',
      invoiceErpModified: '2026-11-02T08:00:00.000Z', // Odoo's write_date: behind the outbox clock
      receiptCommandState: 'confirmed',
      receiptCommandCreatedAt: '2026-11-02T09:00:30.000Z',
      receiptCommandExternalRef: 'account.payment:42',
      receiptCommandRecordedReadBack: true,
      invoiceMatchedPaymentRefs: ['account.payment:42'],
    })).toBe(false);
  });

  it('stays awaiting when the recorded reference is absent from the invoice read-back (the mirror has not caught up)', () => {
    expect(invoiceReceiptAwaitingOdoo({
      invoiceStatus: 'Unpaid',
      invoiceErpModified: '2026-11-02T09:02:00.000Z', // even a read after outbox creation proves nothing without the reference
      receiptCommandState: 'confirmed',
      receiptCommandCreatedAt: '2026-11-02T09:00:30.000Z',
      receiptCommandExternalRef: 'account.payment:42',
      receiptCommandRecordedReadBack: true,
      invoiceMatchedPaymentRefs: [],
    })).toBe(true);
  });

  it('a command still committing waits even with the reference evidence present', () => {
    expect(invoiceReceiptAwaitingOdoo({
      invoiceStatus: 'Unpaid',
      invoiceErpModified: '2026-11-02T08:00:00.000Z',
      receiptCommandState: 'committing',
      receiptCommandCreatedAt: '2026-11-02T09:00:30.000Z',
      receiptCommandExternalRef: 'account.payment:42',
      receiptCommandRecordedReadBack: true,
      invoiceMatchedPaymentRefs: ['account.payment:42'],
    })).toBe(true);
  });

  it('a reference without recorded read-back evidence falls back to the clocks (rows committed before the evidence existed)', () => {
    expect(invoiceReceiptAwaitingOdoo({
      invoiceStatus: 'Unpaid',
      invoiceErpModified: '2026-11-02T08:00:00.000Z',
      receiptCommandState: 'confirmed',
      receiptCommandCreatedAt: '2026-11-02T09:00:30.000Z',
      receiptCommandExternalRef: 'account.payment:42',
      receiptCommandRecordedReadBack: false,
    })).toBe(true);
    expect(invoiceReceiptAwaitingOdoo({
      invoiceStatus: 'Unpaid',
      invoiceErpModified: '2026-11-02T09:02:00.000Z',
      receiptCommandState: 'confirmed',
      receiptCommandCreatedAt: '2026-11-02T09:00:30.000Z',
      receiptCommandExternalRef: 'account.payment:42',
      receiptCommandRecordedReadBack: false,
    })).toBe(false);
  });

  it('no reference recorded at all falls back to the clocks exactly as before', () => {
    expect(invoiceReceiptAwaitingOdoo({
      invoiceStatus: 'Unpaid',
      invoiceErpModified: '2026-11-02T08:00:00.000Z',
      receiptCommandState: 'held',
      receiptCommandCreatedAt: '2026-11-02T09:00:30.000Z',
    })).toBe(true);
    expect(invoiceReceiptAwaitingOdoo({
      invoiceStatus: 'Unpaid',
      invoiceErpModified: '2026-11-02T09:02:00.000Z',
      receiptCommandState: 'held',
      receiptCommandCreatedAt: '2026-11-02T09:00:30.000Z',
    })).toBe(false);
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

  // #1825 (review I1): the replay-after-partial-failure path. Attempt 1 committed the payment row but
  // failed the invoice read-back write, so the invoice's references hold nothing yet — the outbox's
  // recorded read-back disables the clock fallback, and the flag would stay awaiting forever. The
  // replay treats the duplicate payment row as already applied and writes the read-back; the reference
  // arriving is what clears the flag — never a clock.
  it('a replay that lands the read-back reference clears the flag a failed first attempt left stuck', () => {
    const base = {
      invoiceStatus: 'Unpaid',
      invoiceErpModified: '2026-11-02T09:02:00.000Z', // even a read after outbox creation proves nothing without the reference
      receiptCommandState: 'confirmed',
      receiptCommandCreatedAt: '2026-11-02T09:00:30.000Z',
      receiptCommandExternalRef: 'account.payment:42',
      receiptCommandRecordedReadBack: true,
    } as const;
    expect(invoiceReceiptAwaitingOdoo({ ...base, invoiceMatchedPaymentRefs: [] })).toBe(true);
    expect(invoiceReceiptAwaitingOdoo({ ...base, invoiceMatchedPaymentRefs: ['account.payment:42'] })).toBe(false);
  });
});
