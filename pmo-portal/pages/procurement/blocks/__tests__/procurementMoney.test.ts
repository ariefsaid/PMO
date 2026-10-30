import { describe, expect, it } from 'vitest';
import { procurementMoney, supplierUnpaid, withLinkedDocuments } from '../procurementMoney';

describe('procurementMoney', () => {
  it('uses the most specific recorded figures and reports the unpaid balance', () => {
    const money = procurementMoney({
      total_value: 100,
      purchase_requests: [{ amount: 90 }],
      purchase_orders: [{ amount: 110 }],
      procurement_invoices: [{ amount: 80, erp_outstanding_amount: null }],
      payments: [{ amount: 25, status: 'Paid' }],
      erpDocuments: [
        { doctype: 'Purchase Order', grand_total: 10, outstanding_amount: null },
        { doctype: 'Purchase Invoice', grand_total: 20, outstanding_amount: 12 },
        { doctype: 'Payment Entry', grand_total: 5, outstanding_amount: null },
      ],
    });

    expect(money).toMatchObject({
      requested: { amount: 90, unknown: false },
      ordered: { amount: 120, unknown: false },
      invoiced: { amount: 100, unknown: false },
      paid: { amount: 30, unknown: false },
      unpaid: { amount: 70, unknown: false },
      mostReal: { kind: 'paid', amount: 30 },
    });
  });

  it('keeps a missing amount unknown instead of treating it as zero', () => {
    const money = procurementMoney({
      total_value: 100,
      purchase_requests: [{ amount: 100 }],
      purchase_orders: [{ amount: null }],
      procurement_invoices: [],
      payments: [],
      erpDocuments: [],
    });

    expect(money.ordered).toEqual({ amount: null, unknown: true });
    expect(money.unknown.has('ordered')).toBe(true);
    expect(money.mostReal).toEqual({ kind: 'requested', amount: 100 });
  });

  it('uses ERP outstanding amounts when every invoice is linked from the accounting system', () => {
    const money = procurementMoney({
      total_value: 100,
      purchase_requests: [],
      purchase_orders: [],
      procurement_invoices: [],
      payments: [],
      erpDocuments: [
        { doctype: 'Purchase Invoice', grand_total: 60, outstanding_amount: 14 },
        { doctype: 'Purchase Invoice', grand_total: 40, outstanding_amount: 10 },
      ],
    });

    expect(money.invoiced).toEqual({ amount: 100, unknown: false });
    expect(money.unpaid).toEqual({ amount: 24, unknown: false });
  });

  it('marks requested unknown when no purchase request exists but a later document does', () => {
    const money = procurementMoney({
      total_value: 110500,
      purchase_requests: [],
      purchase_orders: [{ amount: 110500 }],
      procurement_invoices: [],
      payments: [],
      erpDocuments: [],
    });

    expect(money.requested).toEqual({ amount: null, unknown: true });
    expect(money.ordered).toEqual({ amount: 110500, unknown: false });
    expect(money.mostReal).toEqual({ kind: 'ordered', amount: 110500 });
  });

  it('keeps empty ordered, invoiced, and paid figures distinct from recorded zeroes', () => {
    const empty = procurementMoney({
      total_value: 100,
      purchase_requests: [],
      purchase_orders: [],
      procurement_invoices: [],
      payments: [],
      erpDocuments: [],
    });
    const recordedZero = procurementMoney({
      total_value: 100,
      purchase_requests: [],
      purchase_orders: [{ amount: 0 }],
      procurement_invoices: [{ amount: 0 }],
      payments: [{ amount: 0, status: 'Paid' }],
      erpDocuments: [],
    });

    expect(empty.ordered).toEqual({ amount: null, unknown: false });
    expect(empty.invoiced).toEqual({ amount: null, unknown: false });
    expect(empty.paid).toEqual({ amount: null, unknown: false });
    expect(recordedZero.ordered).toEqual({ amount: 0, unknown: false });
    expect(recordedZero.invoiced).toEqual({ amount: 0, unknown: false });
    expect(recordedZero.paid).toEqual({ amount: 0, unknown: false });
  });
});

describe('supplierUnpaid (SEC-RS-2: the one owed-to-suppliers figure)', () => {
  it('is the supplier invoice amount less Paid payments, not the procurement value', () => {
    expect(supplierUnpaid({
      total_value: 1000,
      procurement_invoices: [{ amount: 1110 }],
      payments: [{ amount: 400, status: 'Paid' }, { amount: 300, status: 'Scheduled' }],
    })).toEqual({ amount: 710, unknown: false });
  });

  it('is unknown, not zero, when no supplier invoice amount is on record', () => {
    expect(supplierUnpaid({ total_value: 1000, procurement_invoices: [], payments: [] })).toEqual({ amount: null, unknown: true });
    expect(supplierUnpaid({ total_value: 1000 })).toEqual({ amount: null, unknown: true });
  });

  it('is unknown when an invoice amount is missing', () => {
    expect(supplierUnpaid({ procurement_invoices: [{ amount: null }], payments: [] })).toEqual({ amount: null, unknown: true });
  });

  it('is zero when the invoice is fully paid', () => {
    expect(supplierUnpaid({ procurement_invoices: [{ amount: 500 }], payments: [{ amount: 500, status: 'Paid' }] })).toEqual({ amount: 0, unknown: false });
  });
});

describe('withLinkedDocuments (L12: one supplier-invoice amount on every screen)', () => {
  it('L12 a supplier invoice recorded only in the accounting system reads its linked document amount', () => {
    const rows = [{ id: 'p1', total_value: 110_500, procurement_invoices: [], payments: [] }, { id: 'p2', total_value: 5, procurement_invoices: [], payments: [] }];
    const linked = withLinkedDocuments(rows, [{ procurementId: 'p1', doctype: 'Purchase Invoice', grandTotal: 62_000, outstanding: 62_000 }])!;
    expect(supplierUnpaid(linked[0])).toEqual({ amount: 62_000, unknown: false });
    expect(linked[1]).toBe(rows[1]);
    expect(withLinkedDocuments(rows, [])).toBe(rows);
  });
});
