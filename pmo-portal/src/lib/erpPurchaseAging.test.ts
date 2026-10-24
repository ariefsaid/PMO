import { describe, expect, it } from 'vitest';
import { agingBucket, paymentState, projectAging } from './erpPurchaseAging';
import type { ErpPurchaseRow } from './repositories/erpPurchases';

const pi = (over: Partial<ErpPurchaseRow>): ErpPurchaseRow => ({
  id: 'x', doctype: 'Purchase Invoice', name: 'PINV', supplier: 'Acme', docDate: '2026-01-01', dueDate: '2026-02-01',
  billNo: null, currency: 'IDR', grandTotal: 100, netTotal: null, outstanding: 100, erpStatus: 'Unpaid', isReturn: false, projectIds: ['p1'],
  procurementId: null, linkId: null, ...over,
});
const TODAY = '2026-03-15';

describe('erpPurchaseAging', () => {
  it('derives paid/unpaid/overdue from ERP outstanding, and nothing for a PO', () => {
    expect(paymentState(pi({ outstanding: 0 }), TODAY)).toBe('paid');
    expect(paymentState(pi({ dueDate: '2026-04-01' }), TODAY)).toBe('unpaid');
    expect(paymentState(pi({ dueDate: '2026-04-01', outstanding: 40 }), TODAY)).toBe('partly-paid');
    expect(paymentState(pi({}), TODAY)).toBe('overdue');
    expect(paymentState(pi({ isReturn: true, outstanding: -10 }), TODAY)).toBe('return');
    expect(paymentState(pi({ doctype: 'Purchase Order', outstanding: null }), TODAY)).toBeNull();
  });

  it('buckets by days past due, due today counting as not due', () => {
    expect(agingBucket('2026-03-15', TODAY)).toBe('notDue');
    expect(agingBucket('2026-03-14', TODAY)).toBe('d1_30');
    expect(agingBucket('2026-01-14', TODAY)).toBe('d31_60');
    expect(agingBucket('2025-12-15', TODAY)).toBe('d61_90');
    expect(agingBucket('2025-12-14', TODAY)).toBe('d90Plus');
    expect(agingBucket(null, TODAY)).toBe('notDue');
  });

  it('FR-EPR-008 totals open, unshared invoices per currency and counts the shared ones apart', () => {
    const { aging, sharedOpen } = projectAging([
      pi({ outstanding: 100, dueDate: '2026-04-01' }),
      pi({ outstanding: 30, dueDate: '2026-03-01' }),
      pi({ outstanding: 0 }),
      pi({ outstanding: 50, projectIds: ['p1', 'p2'] }),
      pi({ outstanding: 7, currency: 'USD', dueDate: '2025-01-01' }),
      pi({ doctype: 'Purchase Order', outstanding: null }),
    ], TODAY);
    expect(sharedOpen).toBe(1);
    expect(aging).toEqual([
      { currency: 'IDR', total: 130, buckets: { notDue: 100, d1_30: 30, d31_60: 0, d61_90: 0, d90Plus: 0 } },
      { currency: 'USD', total: 7, buckets: { notDue: 0, d1_30: 0, d31_60: 0, d61_90: 0, d90Plus: 7 } },
    ]);
  });
});
