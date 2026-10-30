import { describe, expect, it } from 'vitest';
import type { FinancePosition } from '@/src/lib/finance/financePosition';
import type { ErpPurchaseRow } from '@/src/lib/repositories/erpPurchases';
import { supplierUnpaid } from '@/pages/procurement/blocks/procurementMoney';
import { withLinkedSupplierInvoices } from './payablesPosition';

type Payable = FinancePosition['payables'][number];

const procurement = (id: string, over: Record<string, unknown> = {}) => ({
  id, title: id, code: id, status: 'Vendor Invoiced', currency: 'USD', vendor_id: null, vendor: null,
  total_value: null, purchase_requests: [], purchase_orders: [], procurement_invoices: [], payments: [], ...over,
}) as never as Payable['procurement'];

const erpInvoice = (procurementId: string, grandTotal: number, outstanding: number | null): ErpPurchaseRow => ({
  id: `doc-${procurementId}`, doctype: 'Purchase Invoice', name: `PINV-${procurementId}`, supplier: null, docDate: '2026-10-01',
  dueDate: '2026-10-15', billNo: null, currency: 'USD', grandTotal, netTotal: grandTotal, outstanding, erpStatus: 'Overdue',
  isReturn: false, projectIds: [], procurementId, linkId: `link-${procurementId}`,
});

function position(payables: Payable[], over: Partial<FinancePosition> = {}): FinancePosition {
  return {
    receivablesCount: 0, receivablesUnknownCount: 0, overdue: [], overdueTotals: {}, overdueUnknownCount: 0,
    drafts: { canApprove: [], awaitingOther: [], all: [] }, toSend: [], unappliedPayments: [], unappliedTotals: {},
    payables, payablesTotals: {}, payablesUnknownCount: payables.filter((row) => row.amount === null).length,
    receivablesAgeing: {}, payablesAgeing: {}, ...over,
  };
}

describe('withLinkedSupplierInvoices', () => {
  it('L12(a): a supplier invoice kept in the accounting system reads the same unpaid amount as the procurement record', () => {
    const inverter = procurement('inverter');
    const docs = [erpInvoice('inverter', 62_000, 62_000)];
    const result = withLinkedSupplierInvoices(position([{ procurement: inverter, ageDays: 27, amount: null }]), docs);

    const record = supplierUnpaid({ ...inverter, erpDocuments: [{ doctype: 'Purchase Invoice', grand_total: 62_000, outstanding_amount: 62_000 }] });
    expect(record.amount).toBe(62_000);
    expect(result.payables[0]?.amount).toBe(6_200_000);
    expect(result.payablesTotals).toEqual({ USD: 6_200_000 });
    expect(result.payablesUnknownCount).toBe(0);
    expect(result.payablesAgeing.USD).toEqual({ d0_30: 6_200_000, d31_60: 0, d61_90: 0, over90: 0 });
  });

  it('L12(b): a balance that stays unknown is counted in its own age bucket, never added and never put in 0–30', () => {
    const known = { procurement: procurement('known'), ageDays: 15, amount: 3_000_000 };
    const old = { procurement: procurement('old'), ageDays: 101, amount: null };
    const middle = { procurement: procurement('middle'), ageDays: 41, amount: null };
    const base = position([old, middle, known], {
      payablesTotals: { USD: 3_000_000 },
      payablesAgeing: { USD: { d0_30: 3_000_000, d31_60: 0, d61_90: 0, over90: 0 } },
    });
    const result = withLinkedSupplierInvoices(base, []);

    expect(result.payablesUnknownAgeing).toEqual({ USD: { over90: 1, d31_60: 1 } });
    expect(result.payablesAgeing).toBe(base.payablesAgeing);
    expect(result.payablesTotals).toBe(base.payablesTotals);
    expect(result.payablesUnknownCount).toBe(2);
  });

  it('L12: an accounting-system invoice without a reported balance stays unknown, never zero', () => {
    const result = withLinkedSupplierInvoices(
      position([{ procurement: procurement('pending'), ageDays: 70, amount: null }]),
      [erpInvoice('pending', 9_000, null)],
    );
    expect(result.payables[0]?.amount).toBeNull();
    expect(result.payablesTotals).toEqual({});
    expect(result.payablesUnknownAgeing).toEqual({ USD: { d61_90: 1 } });
  });

  it('ignores documents linked to other procurements or to none', () => {
    const base = position([{ procurement: procurement('a'), ageDays: 5, amount: 100 }], { payablesTotals: { USD: 100 } });
    const result = withLinkedSupplierInvoices(base, [erpInvoice('b', 50, 50), { ...erpInvoice('x', 10, 10), procurementId: null }]);
    expect(result.payables).toEqual(base.payables);
    expect(result.payablesTotals).toBe(base.payablesTotals);
  });
});
