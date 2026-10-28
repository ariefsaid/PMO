import { useMemo } from 'react';
import { useErpPurchases } from '@/src/hooks/useErpPurchases';
import type { ErpPurchaseRow } from '@/src/lib/repositories/erpPurchases';
import type { CurrencyTotals, FinancePosition, PayablesAgeingBuckets } from '@/src/lib/finance/financePosition';
import { supplierUnpaid } from '@/pages/procurement/blocks/procurementMoney';

export type PayablesBucket = keyof PayablesAgeingBuckets;
/** Supplier invoices whose unpaid balance is unknown, counted per currency and age bucket (never added as zero). */
export type PayablesUnknownAgeing = Record<string, Partial<Record<PayablesBucket, number>>>;

export interface PayablesPosition {
  payables: FinancePosition['payables'];
  payablesTotals: CurrencyTotals;
  payablesUnknownCount: number;
  payablesAgeing: Record<string, PayablesAgeingBuckets>;
  payablesUnknownAgeing: PayablesUnknownAgeing;
}

/** Same age buckets as the finance position: calendar days since the supplier invoice was recorded. */
export function payablesAgeBucket(days: number): PayablesBucket {
  if (days <= 30) return 'd0_30';
  if (days <= 60) return 'd31_60';
  if (days <= 90) return 'd61_90';
  return 'over90';
}

function cents(amount: number): number {
  return Math.round(amount * 100);
}

/**
 * L12: the procurement record reads a supplier invoice that lives in the accounting system through its linked
 * documents. Payables must read the same source, so each payable with linked documents is re-read through the
 * shared `supplierUnpaid` helper with those documents. Payables without linked documents keep the finance
 * position's figure, which comes from the same helper. Unknown balances stay unknown and are counted by age.
 */
export function withLinkedSupplierInvoices(position: FinancePosition, erpDocuments: readonly ErpPurchaseRow[]): PayablesPosition {
  const linked = new Map<string, ErpPurchaseRow[]>();
  for (const document of erpDocuments) {
    if (!document.procurementId) continue;
    const list = linked.get(document.procurementId) ?? [];
    list.push(document);
    linked.set(document.procurementId, list);
  }

  let changed = false;
  const payables = (position.payables ?? []).map((row) => {
    const documents = linked.get(row.procurement.id);
    if (!documents || documents.length === 0) return row;
    const unpaid = supplierUnpaid({
      ...row.procurement,
      erpDocuments: documents.map((document) => ({ doctype: document.doctype, grand_total: document.grandTotal, outstanding_amount: document.outstanding })),
    });
    const amount = unpaid.unknown || unpaid.amount === null ? null : cents(unpaid.amount);
    if (amount === row.amount) return row;
    changed = true;
    return { ...row, amount };
  });

  const payablesUnknownAgeing: PayablesUnknownAgeing = {};
  for (const row of payables) {
    if (row.amount !== null) continue;
    const counts = payablesUnknownAgeing[row.procurement.currency] ??= {};
    const bucket = payablesAgeBucket(row.ageDays);
    counts[bucket] = (counts[bucket] ?? 0) + 1;
  }

  if (!changed) {
    return {
      payables,
      payablesTotals: position.payablesTotals,
      payablesUnknownCount: position.payablesUnknownCount,
      payablesAgeing: position.payablesAgeing,
      payablesUnknownAgeing,
    };
  }

  const payablesTotals: CurrencyTotals = {};
  const payablesAgeing: Record<string, PayablesAgeingBuckets> = {};
  let payablesUnknownCount = 0;
  for (const row of payables) {
    if (row.amount === null) {
      payablesUnknownCount += 1;
      continue;
    }
    const currency = row.procurement.currency;
    payablesTotals[currency] = (payablesTotals[currency] ?? 0) + row.amount;
    const buckets = payablesAgeing[currency] ??= { d0_30: 0, d31_60: 0, d61_90: 0, over90: 0 };
    buckets[payablesAgeBucket(row.ageDays)] += row.amount;
  }
  return { payables, payablesTotals, payablesUnknownCount, payablesAgeing, payablesUnknownAgeing };
}

/** The finance position's payables, read through the accounting-system documents linked to each procurement. */
export function usePayablesPosition(position: FinancePosition, enabled: boolean) {
  const erp = useErpPurchases(undefined, { enabled });
  const payables = useMemo(() => withLinkedSupplierInvoices(position, erp.data ?? []), [position, erp.data]);
  // A failed document read falls back to the PMO-recorded figures (unknown stays unknown); it never blocks the page.
  return { ...payables, isPending: enabled && erp.isPending && !erp.isError };
}
