import type { ProcurementWithRefs, SupplierPayablesTotal } from '@/src/lib/db/procurements';
import { supplierUnpaid } from '@/src/lib/procurement/procurementMoney';
import { calendarAgeDays, isProcurementReadyToPay, supplierInvoiceDate } from '@/src/lib/finance/financePosition';

/** Test double for the server's supplier totals (2814): the browser rule over mocked purchase rows, so a test that
 *  feeds rows still sees the figures those rows make. The real rule is proven by the 2814 pgTAP file and serverTotalsParity. */
export function supplierTotalsFromRows(rows: readonly ProcurementWithRefs[] | undefined, today: string | null = null): SupplierPayablesTotal[] | undefined {
  if (!rows) return undefined;
  const byCurrency = new Map<string, SupplierPayablesTotal>();
  for (const row of rows) {
    if (!isProcurementReadyToPay(row)) continue;
    const total = byCurrency.get(row.currency) ?? { currency: row.currency, invoiceCount: 0, unknownCount: 0, knownCount: 0, knownTotal: 0, notDueCount: 0, notDueTotal: 0, overdueKnownCount: 0, overdueTotal: 0, overdueCount: 0, oldestDays: null };
    byCurrency.set(row.currency, total);
    const age = calendarAgeDays(supplierInvoiceDate(row), today);
    const late = age !== null && age > 90;
    total.invoiceCount += 1;
    if (late) total.overdueCount += 1;
    if (age !== null) total.oldestDays = Math.max(total.oldestDays ?? 0, age);
    const unpaid = supplierUnpaid(row);
    if (unpaid.unknown || unpaid.amount === null) { total.unknownCount += 1; continue; }
    total.knownCount += 1;
    total.knownTotal += unpaid.amount;
    if (late) { total.overdueKnownCount += 1; total.overdueTotal += unpaid.amount; } else { total.notDueCount += 1; total.notDueTotal += unpaid.amount; }
  }
  return [...byCurrency.values()];
}

/** The query result shape of `useSupplierPayablesTotals` around those totals. */
export function supplierTotalsRead(read: { data?: readonly ProcurementWithRefs[]; isPending?: boolean; isError?: boolean } | undefined, today: string | null = null) {
  return {
    data: supplierTotalsFromRows(read?.data, today),
    isPending: read?.isPending ?? false,
    isError: read?.isError ?? false,
    fetchStatus: read?.isPending ? 'fetching' : 'idle',
    refetch: (read as { refetch?: () => unknown } | undefined)?.refetch ?? (() => Promise.resolve()),
  };
}

/** Adds `useSupplierPayablesTotals` to a `useProcurements` module mock, made from the same mocked rows. */
export function withSupplierTotals<M extends { useProcurements: (...args: never[]) => unknown }>(mock: M) {
  return {
    ...mock,
    useSupplierPayablesTotals: (today: string | null, enabled = true) =>
      supplierTotalsRead((mock.useProcurements as (opts: unknown) => Parameters<typeof supplierTotalsRead>[0])({ lean: true, enabled }), today),
  };
}
