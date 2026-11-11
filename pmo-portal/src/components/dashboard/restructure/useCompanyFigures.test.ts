import { describe, expect, it } from 'vitest';
import { amountFromDashboard, currencyFigure, exactFromDashboard, selectCollectedTotals, selectInvoicedTotals, selectUnbilledTotals } from './useCompanyFigures';
import type { ManagementPack } from '@/src/lib/reports/managementPack';
import { monthsBetween } from '@/src/lib/reports/months';
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

  it('includes both selected ISO months and excludes outside months by currency', () => {
    const months = monthsBetween('2026-01-01', '2026-04-01');
    const pack = {
      totals: [
        { currency: 'USD', months: months.map((month, index) => ({ month, invoiced: [90_000, 12_345, 6_789, 80_000][index] })) },
        { currency: 'IDR', months: months.map((month, index) => ({ month, invoiced: [50_000, 10_000, 20_000, 70_000][index] })) },
      ],
    } as unknown as ManagementPack;

    expect(selectInvoicedTotals(pack, '2026-02', '2026-03')).toEqual([
      { currency: 'USD', amount: 191.34 },
      { currency: 'IDR', amount: 300 },
    ]);
    expect(selectInvoicedTotals(pack, '2026-03', '2026-03')).toEqual([
      { currency: 'USD', amount: 67.89 },
      { currency: 'IDR', amount: 200 },
    ]);
    expect(selectInvoicedTotals(undefined, '2026-02', '2026-03')).toBeUndefined();
    expect(selectInvoicedTotals(pack, null, '2026-03')).toBeUndefined();
    expect(selectInvoicedTotals(pack, '2026-02', null)).toBeUndefined();
  });

  it('collects only paid receipts dated inside the inclusive period', () => {
    const payments = [
      { status: 'Paid', date: '2026-01-31', currency: 'USD', amount: 100, id: 'a' },
      { status: 'Paid', date: '2026-02-01', currency: 'USD', amount: 50, id: 'b' },
      { status: 'Scheduled', date: '2026-01-15', currency: 'USD', amount: 500, id: 'c' },
      { status: 'Paid', date: null, currency: 'USD', amount: 900, id: 'd' },
    ] as unknown as IncomingPaymentRow[];
    expect(selectCollectedTotals(payments, '2026-01', '2026-01')).toEqual({ totals: [{ currency: 'USD', amount: '100.00' }], unknownCurrencies: [] });
  });

  it('renders the collected KPI for fractional paid receipts', () => {
    const payments = [
      { status: 'Paid', date: '2026-01-15', currency: 'USD', amount: 0.1 },
      { status: 'Paid', date: '2026-01-16', currency: 'USD', amount: 0.2 },
    ] as unknown as IncomingPaymentRow[];
    const collected = selectCollectedTotals(payments, '2026-01', '2026-01')!;
    expect(currencyFigure(collected.totals, 'USD', 'Unavailable')?.value).toBe('$0');
  });


  it('does not turn paid receipts with an unknown amount into a zero collected total', () => {
    const payments = [
      { status: 'Paid', date: '2026-01-15', currency: 'USD', amount: null, id: 'unknown' },
    ] as unknown as IncomingPaymentRow[];
    expect(selectCollectedTotals(payments, '2026-01', '2026-01')).toEqual({ totals: [], unknownCurrencies: ['USD'] });
  });

  it('shows the known currency and names an unknown currency amount only in the exact text, never as a dash', () => {
    const rows = [
      { currency: 'IDR', contract_value: 1_000_000 },
      { currency: 'USD', contract_value: null },
    ];
    const t = (_key: string, fallback: string, options?: Record<string, unknown>) => fallback.replace('{{currency}}', String(options?.currency ?? ''));
    const formatted = amountFromDashboard(rows, 'contract_value', 'IDR', t);
    const exact = exactFromDashboard(rows, 'contract_value', 'IDR', t);

    expect(formatted).toMatch(/\d/);
    expect(formatted).not.toContain('—');
    expect(formatted).not.toContain('USD');
    expect(exact?.exactValue).toContain('USD amount unknown');
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
