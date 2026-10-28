import { describe, expect, it } from 'vitest';
import { procurementMoney } from '../procurementMoney';

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
