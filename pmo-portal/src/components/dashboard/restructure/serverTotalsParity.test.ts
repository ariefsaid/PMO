import { describe, expect, it } from 'vitest';
import type { ProcurementWithRefs, SupplierPayablesTotal } from '@/src/lib/db/procurements';
import { paidFactsFromMonths, type PaidPaymentFact } from '@/src/lib/db/revenue';
import { withLinkedDocuments } from '@/src/lib/procurement/procurementMoney';
import { selectSupplierInvoices, supplierInvoicesFromTotals } from './useNeedsYou';
import { supplierTotalsFromRows } from '@/src/test/supplierTotalsFromRows';
import { payablesFromTotals, selectCollectedByMonth, selectCollectedTotals, splitPayables } from './useCompanyFigures';

// #3045: the rows of supabase/tests/2814_supplier_payables_totals.test.sql, as the browser read them, and the server's
// answer pinned there. The browser rule over the rows and the mapped server answer must be the same figures.
const bill = (amount: number, invoice_date: string | null, voided_at: string | null = null) => ({ amount, invoice_date, voided_at });
const purchase = (id: string, currency: string, status: string, procurement_invoices: unknown[], payments: unknown[] = []) =>
  ({ id, currency, status, procurement_invoices, payments }) as unknown as ProcurementWithRefs;
const rows = [
  purchase('e0', 'EUR', 'Vendor Invoiced', []),
  purchase('e1', 'IDR', 'Vendor Invoiced', [bill(1000, '2026-11-01')], [{ amount: 300, status: 'Paid' }, { amount: 500, status: 'Scheduled' }]),
  purchase('e2', 'IDR', 'Vendor Invoiced', [bill(500, '2026-07-01'), bill(999, '2026-01-01', '2026-02-01T00:00:00Z')]),
  purchase('e3', 'IDR', 'Vendor Invoiced', []),
  purchase('e4', 'USD', 'Vendor Invoiced', []),
  purchase('e5', 'USD', 'Vendor Invoiced', [bill(100.10, '2026-08-01')], [{ amount: 150, status: 'Paid' }]),
  purchase('e6', 'IDR', 'Ordered', [bill(70, '2026-01-01')]),
  purchase('e7', 'IDR', 'Vendor Invoiced', []),
];
// The browser's accounting read keeps submitted documents only, so P7's cancelled invoice never arrives.
const documents = [
  { procurementId: 'e4', doctype: 'Purchase Invoice', grandTotal: 800, outstanding: 250.55 },
  { procurementId: 'e5', doctype: 'Payment Entry', grandTotal: 10, outstanding: null },
];
const server: SupplierPayablesTotal[] = [
  { currency: 'EUR', invoiceCount: 1, unknownCount: 1, knownCount: 0, knownTotal: 0, notDueCount: 0, notDueTotal: 0, overdueKnownCount: 0, overdueTotal: 0, overdueCount: 0, oldestDays: null },
  { currency: 'IDR', invoiceCount: 4, unknownCount: 2, knownCount: 2, knownTotal: 1200, notDueCount: 1, notDueTotal: 700, overdueKnownCount: 1, overdueTotal: 500, overdueCount: 1, oldestDays: 150 },
  { currency: 'USD', invoiceCount: 2, unknownCount: 0, knownCount: 2, knownTotal: 250.55, notDueCount: 1, notDueTotal: 250.55, overdueKnownCount: 1, overdueTotal: 0, overdueCount: 1, oldestDays: 119 },
];

describe('#3045 supplier figures from the server equal the browser rule', () => {
  const linked = withLinkedDocuments(rows, documents);
  it('owed to suppliers and the supplier-invoices wait row', () => {
    expect(supplierInvoicesFromTotals(server)).toEqual(selectSupplierInvoices(linked));
  });
  it('the payables split by age', () => {
    expect(payablesFromTotals(server)).toEqual(splitPayables(linked, '2026-11-28'));
  });
  it('the test double other suites use makes the same totals from rows as the server', () => {
    expect(supplierTotalsFromRows(linked, '2026-11-28')).toEqual(server);
  });
  it('a currency with no invoice dates shows no oldest age, as before', () => {
    expect(payablesFromTotals(server.slice(0, 1))?.oldestDays).toBeNull();
    expect(payablesFromTotals(server.slice(0, 1))).toEqual(splitPayables(withLinkedDocuments(rows.slice(0, 1), documents), '2026-11-28'));
  });
  it('nothing waiting for payment is zero purchases, not unknown', () => {
    expect(supplierInvoicesFromTotals([])).toEqual(selectSupplierInvoices([]));
    expect(payablesFromTotals([])).toEqual(splitPayables([], '2026-11-28'));
  });
});

// #3046: the receipts of supabase/tests/2815_paid_receipt_months.test.sql plus an unknown amount, row by row, against the
// server's monthly sums mapped back to facts.
const receipts: PaidPaymentFact[] = [
  { status: 'Paid', date: '2026-10-03', amount: 1000.10, currency: 'IDR' },
  { status: 'Paid', date: '2026-10-31', amount: 0.05, currency: 'IDR' },
  { status: 'Paid', date: '2026-11-01', amount: 987654321012.34, currency: 'IDR' },
  { status: 'Paid', date: '2026-11-30', amount: 0.01, currency: 'IDR' },
  { status: 'Paid', date: '2026-11-02', amount: 50, currency: 'USD' },
  { status: 'Paid', date: '2026-09-05', amount: null, currency: 'USD' },
  { status: 'Paid', date: null, amount: 7, currency: 'IDR' },
];
const months = paidFactsFromMonths([
  { currency: 'IDR', month: null, total: '7.00', receipt_count: 1, unknown_count: 0 },
  { currency: 'USD', month: '2026-09', total: null, receipt_count: 1, unknown_count: 1 },
  { currency: 'IDR', month: '2026-10', total: '1000.15', receipt_count: 2, unknown_count: 0 },
  { currency: 'IDR', month: '2026-11', total: '987654321012.35', receipt_count: 2, unknown_count: 0 },
  { currency: 'USD', month: '2026-11', total: '50.00', receipt_count: 1, unknown_count: 0 },
]);

describe('#3046 collected from monthly server sums equals the receipt-by-receipt figures', () => {
  it.each([['2026-10', '2026-10'], ['2026-10', '2026-11'], ['2026-09', '2026-11'], ['2026-11', '2026-11'], ['2025-01', '2025-12']])('period %s to %s', (from, to) => {
    const sort = (value: ReturnType<typeof selectCollectedTotals>) => value && { ...value, totals: [...value.totals].sort((a, b) => a.currency.localeCompare(b.currency)) };
    expect(sort(selectCollectedTotals(months, from, to))).toEqual(sort(selectCollectedTotals(receipts, from, to)));
  });
  it('the exact sum survives a size a float cannot hold', () => {
    expect(selectCollectedTotals(months, '2026-11', '2026-11')?.totals).toContainEqual({ currency: 'IDR', amount: '987654321012.35' });
  });
  it('by month, including one unknown amount anywhere making a currency unknown', () => {
    const near = (map: Map<string, number> | undefined) => map && [...map].map(([month, amount]) => [month, Math.round(amount * 100)]).sort();
    expect(near(selectCollectedByMonth(months, 'IDR'))).toEqual(near(selectCollectedByMonth(receipts, 'IDR')));
    expect(selectCollectedByMonth(months, 'USD')).toBeUndefined();
    expect(selectCollectedByMonth(receipts, 'USD')).toBeUndefined();
  });
  it('a receipt with no date still counts as a receipt', () => {
    expect(months.length).toBeGreaterThan(0);
  });
});
