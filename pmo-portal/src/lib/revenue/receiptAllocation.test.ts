import { describe, expect, it } from 'vitest';
import { knownUnappliedCash, receiptAllocations } from './receiptAllocation';
import type { IncomingPaymentRow } from '@/src/lib/db/revenue';

/** S-06 (RF-030/031): synthetic fixtures only. `allocation_details` is the ERP-authored mirror:
 *  `null` = coverage unknown, `[]` = the source reported no invoice allocations. */
const row = (over: Partial<IncomingPaymentRow> = {}): IncomingPaymentRow => ({
  id: 'ip-1', org_id: 'org-1', customer_id: 'cust-1', customer_name: 'Fixture Customer', sales_invoice_id: null,
  ip_number: 'ACC-PAY-0001', reference_number: null, date: '2026-10-07', amount: 75_000,
  received_amount: 75_000, withheld_amount: 0, withholding_slip_number: null, currency: 'IDR',
  status: 'Paid', erp_docstatus: 1, erp_modified: null, erp_amended_from: null, erp_cancelled_at: null,
  created_at: '2026-10-07T00:00:00Z', ...over,
}) as IncomingPaymentRow;

const allocation = (invoice_number: string, amount: string, currency = 'IDR', invoice_id: string | null = null) =>
  ({ invoice_id, invoice_number, amount, currency });

describe('receiptAllocations — ERP-authored allocation coverage (S-06)', () => {
  it('RF-030 returns every allocation in source order, amounts preserved as strings', () => {
    expect(receiptAllocations(row({
      allocation_details: [allocation('ACC-SINV-A', '25000.00'), allocation('ACC-SINV-B', '30000.00')],
    }))).toEqual([
      { invoice_id: null, invoice_number: 'ACC-SINV-A', amount: '25000.00', currency: 'IDR' },
      { invoice_id: null, invoice_number: 'ACC-SINV-B', amount: '30000.00', currency: 'IDR' },
    ]);
  });

  it('an empty array is KNOWN no-coverage — never read as unknown', () => {
    expect(receiptAllocations(row({ allocation_details: [] }))).toEqual([]);
  });

  it('null means the source did not report coverage', () => {
    expect(receiptAllocations(row({ allocation_details: null }))).toBeNull();
    expect(receiptAllocations(row({ allocation_details: undefined }))).toBeNull();
  });
});

describe('knownUnappliedCash — cash the ERP has not matched to any invoice (S-06 RF-031)', () => {
  it('a multi-invoice receipt leaves the remainder unapplied: received + withheld − allocations', () => {
    expect(knownUnappliedCash(row({
      received_amount: 75_000, withheld_amount: 0,
      allocation_details: [allocation('ACC-SINV-A', '25000.00'), allocation('ACC-SINV-B', '30000.00')],
      amount: 75_000,
    }))).toBe(20_000);
  });

  it('DD-RCPT-1: a withholding receipt allocates its GROSS, so the withheld tax counts toward coverage', () => {
    // Cash 980 + withheld 20 = gross 1000, fully allocated: nothing unapplied.
    expect(knownUnappliedCash(row({
      received_amount: 980, withheld_amount: 20,
      allocation_details: [allocation('ACC-SINV-A', '1000.00')],
      amount: 1000,
    }))).toBe(0);
  });

  it('a known-zero remainder is a genuine zero (fully matched), distinct from unknown', () => {
    expect(knownUnappliedCash(row({
      received_amount: 500, withheld_amount: 0, allocation_details: [allocation('ACC-SINV-A', '500.00')],
    }))).toBe(0);
  });

  it('unknown coverage (null allocations) never computes a figure', () => {
    expect(knownUnappliedCash(row({ allocation_details: null }))).toBeNull();
  });

  it('unknown cash received never computes a figure', () => {
    expect(knownUnappliedCash(row({ received_amount: null, allocation_details: [] }))).toBeNull();
  });

  it('unknown withholding never computes a figure (the allocation may already cover it)', () => {
    expect(knownUnappliedCash(row({
      withheld_amount: null, allocation_details: [allocation('ACC-SINV-A', '500.00')],
    }))).toBeNull();
  });

  it('an allocation whose amount the source did not report blocks the arithmetic — it never reads as zero', () => {
    expect(knownUnappliedCash(row({
      allocation_details: [allocation('ACC-SINV-A', '25000.00'), allocation('ACC-SINV-B', null)],
    }))).toBeNull();
  });

  it('an allocation denominated in another currency blocks the arithmetic (currencies are never mixed)', () => {
    expect(knownUnappliedCash(row({
      allocation_details: [allocation('ACC-SINV-A', '25000.00', 'USD')],
    }))).toBeNull();
  });

  it('an allocation with no recorded currency blocks the arithmetic', () => {
    expect(knownUnappliedCash(row({
      allocation_details: [allocation('ACC-SINV-A', '25000.00', null)],
    }))).toBeNull();
  });

  it('over-allocation is not a negative unapplied figure — the arithmetic declines', () => {
    expect(knownUnappliedCash(row({
      received_amount: 100, withheld_amount: 0, allocation_details: [allocation('ACC-SINV-A', '250.00')],
    }))).toBeNull();
  });

  it('cent fractions stay exact (no binary float drift)', () => {
    expect(knownUnappliedCash(row({
      received_amount: 100.1, withheld_amount: 0,
      allocation_details: [allocation('A', '30.00'), allocation('B', '70.09')],
    }))).toBe(0.01);
  });
});
