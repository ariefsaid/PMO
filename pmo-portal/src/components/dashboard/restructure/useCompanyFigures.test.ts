import { describe, expect, it } from 'vitest';
import { selectCollectedTotals, selectInvoicedTotals, selectUnbilledTotals } from './useCompanyFigures';
import type { ManagementPack } from '@/src/lib/reports/managementPack';
import type { IncomingPaymentRow } from '@/src/lib/db/revenue';
import type { UnbilledWorkOrderTotal } from '@/src/lib/db/workOrderBilling';

describe('company period totals', () => {
  it('sums invoiced net amounts in the selected months by currency', () => {
    const pack = {
      totals: [
        { currency: 'USD', months: [{ month: '2026-01', invoiced: 120_000 }, { month: '2026-02', invoiced: 80_000 }, { month: '2026-03', invoiced: 900_000 }] },
        { currency: 'IDR', months: [{ month: '2026-02', invoiced: 500_000 }] },
      ],
    } as unknown as ManagementPack;
    expect(selectInvoicedTotals(pack, '2026-01', '2026-02')).toEqual([
      { currency: 'USD', amount: 2_000 },
      { currency: 'IDR', amount: 5_000 },
    ]);
  });

  it('collects only paid receipts dated inside the inclusive period', () => {
    const payments = [
      { status: 'Paid', date: '2026-01-31', currency: 'USD', amount: 100, id: 'a' },
      { status: 'Paid', date: '2026-02-01', currency: 'USD', amount: 50, id: 'b' },
      { status: 'Scheduled', date: '2026-01-15', currency: 'USD', amount: 500, id: 'c' },
      { status: 'Paid', date: null, currency: 'USD', amount: 900, id: 'd' },
    ] as unknown as IncomingPaymentRow[];
    expect(selectCollectedTotals(payments, '2026-01', '2026-01')).toEqual([{ currency: 'USD', amount: 100 }]);
  });

  it('formats unbilled totals from their remaining amount by currency', () => {
    const totals: UnbilledWorkOrderTotal[] = [
      { currency: 'USD', remaining: 1_250, count: 2 },
      { currency: 'IDR', remaining: 2_000_000, count: 1 },
    ];

    expect(selectUnbilledTotals(totals)).toEqual([
      { currency: 'USD', amount: 1_250 },
      { currency: 'IDR', amount: 2_000_000 },
    ]);
    expect(selectUnbilledTotals(undefined)).toBeUndefined();
  });
});
