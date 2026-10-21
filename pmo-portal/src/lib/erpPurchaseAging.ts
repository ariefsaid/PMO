import type { ErpPurchaseRow } from '@/src/lib/repositories/erpPurchases';

export type PaymentState = 'paid' | 'partly-paid' | 'unpaid' | 'overdue' | 'return';
export type AgingBucket = 'notDue' | 'd1_30' | 'd31_60' | 'd61_90' | 'd90Plus';
export const AGING_BUCKETS: readonly AgingBucket[] = ['notDue', 'd1_30', 'd31_60', 'd61_90', 'd90Plus'];

const daysPastDue = (due: string, today: string) => Math.floor((Date.parse(today) - Date.parse(due)) / 86_400_000);

/** Paid/unpaid from ERP's own `outstanding_amount` (ADR-0048) — never recomputed from payments. */
export function paymentState(r: ErpPurchaseRow, today: string): PaymentState | null {
  if (r.doctype !== 'Purchase Invoice' || r.outstanding === null) return null;
  if (r.isReturn) return 'return';
  if (r.outstanding <= 0) return 'paid';
  if (r.dueDate && daysPastDue(r.dueDate, today) > 0) return 'overdue';
  return r.grandTotal !== null && r.outstanding < r.grandTotal ? 'partly-paid' : 'unpaid';
}

export function agingBucket(dueDate: string | null, today: string): AgingBucket {
  const d = dueDate ? daysPastDue(dueDate, today) : 0;
  return d <= 0 ? 'notDue' : d <= 30 ? 'd1_30' : d <= 60 ? 'd31_60' : d <= 90 ? 'd61_90' : 'd90Plus';
}

export interface ProjectAging {
  currency: string;
  buckets: Record<AgingBucket, number>;
  total: number;
}

/**
 * FR-EPR-008 — one project's AP aging from its open ERP purchase invoices, one entry per currency (never added
 * across currencies). An invoice shared with other projects is left out: its full outstanding would overstate
 * this project's payables. `sharedOpen` counts those so the screen can say so.
 */
export function projectAging(rows: ErpPurchaseRow[], today: string): { aging: ProjectAging[]; sharedOpen: number } {
  const byCurrency = new Map<string, ProjectAging>();
  let sharedOpen = 0;
  for (const r of rows) {
    // ponytail: an invoice with no currency cannot be stated as money, so it stays out of the buckets.
    if (r.doctype !== 'Purchase Invoice' || r.isReturn || !r.currency || !r.outstanding || r.outstanding <= 0) continue;
    if (r.projectIds.length > 1) { sharedOpen += 1; continue; }
    const currency = r.currency;
    const entry = byCurrency.get(currency)
      ?? { currency, total: 0, buckets: { notDue: 0, d1_30: 0, d31_60: 0, d61_90: 0, d90Plus: 0 } };
    entry.buckets[agingBucket(r.dueDate, today)] += r.outstanding;
    entry.total += r.outstanding;
    byCurrency.set(currency, entry);
  }
  return { aging: [...byCurrency.values()], sharedOpen };
}
