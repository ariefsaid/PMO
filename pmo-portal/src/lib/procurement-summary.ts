/**
 * Pure derivation helpers for procurement data. T3 (plan §9 Phase 1).
 * Buckets per plan §4.2:
 *   Open      = everything not Paid / Cancelled / Rejected
 *   Completed = Paid
 *   Closed    = Cancelled | Rejected
 */
import type { ProcurementWithRefs } from '@/src/lib/db/procurements';

const COMPLETED = new Set<string>(['Paid']);
const CLOSED = new Set<string>(['Cancelled', 'Rejected']);

export interface ProcurementSummary {
  open: number;
  completed: number;
  closed: number;
  /** Requested values remain separated by native currency and include closed request history. */
  requestValueByCurrency: Array<{ currency: string; amount: number }>;
  /** Open commitments remain separate from request value and are never summed across currencies. */
  openCommitmentByCurrency: Array<{ currency: string; amount: number }>;
  /** Count of non-Cancelled/Rejected rows. */
  count: number;
  /** Every request row represented by the three status buckets. */
  totalCount: number;
}

/**
 * T3: Aggregates a list of procurement rows into the 3-bucket summary
 * used by the Overview "Procurement summary" card.
 */
export function summarizeProcurement(rows: ProcurementWithRefs[], projectCurrency = 'IDR'): ProcurementSummary {
  let open = 0;
  let completed = 0;
  let closed = 0;
  let count = 0;
  const requestValues = new Map<string, number>();
  const openCommitments = new Map<string, number>();

  for (const row of rows) {
    const s = row.status as string;
    const currency = row.currency || projectCurrency;
    const requestValue = Number(row.total_value) || 0;
    requestValues.set(currency, (requestValues.get(currency) ?? 0) + requestValue);
    if (COMPLETED.has(s)) {
      completed++;
    } else if (CLOSED.has(s)) {
      closed++;
    } else {
      open++;
    }

    if (!CLOSED.has(s)) {
      const commitment = Number(row.open_commitment ?? row.total_value) || 0;
      openCommitments.set(currency, (openCommitments.get(currency) ?? 0) + commitment);
      count++;
    }
  }

  const asCurrencyRows = (values: Map<string, number>) => [...values.entries()]
    .sort(([left], [right]) => left === projectCurrency ? -1 : right === projectCurrency ? 1 : left.localeCompare(right))
    .map(([currency, amount]) => ({ currency, amount }));

  return {
    open, completed, closed, count, totalCount: rows.length,
    requestValueByCurrency: asCurrencyRows(requestValues),
    openCommitmentByCurrency: asCurrencyRows(openCommitments),
  };
}

/**
 * T3: Returns the top `limit` procurement rows by created_at descending.
 */
export function recentRequests(
  rows: ProcurementWithRefs[],
  limit: number,
): ProcurementWithRefs[] {
  return [...rows]
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
    .slice(0, limit);
}
