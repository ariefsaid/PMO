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
});
