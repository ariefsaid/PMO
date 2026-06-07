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
  /** Sum of total_value for all non-Cancelled/Rejected rows. */
  committedTotal: number;
  /** Count of non-Cancelled/Rejected rows. */
  count: number;
}

/**
 * T3: Aggregates a list of procurement rows into the 3-bucket summary
 * used by the Overview "Procurement summary" card.
 */
export function summarizeProcurement(rows: ProcurementWithRefs[]): ProcurementSummary {
  let open = 0;
  let completed = 0;
  let closed = 0;
  let committedTotal = 0;
  let count = 0;

  for (const row of rows) {
    const s = row.status as string;
    if (COMPLETED.has(s)) {
      completed++;
    } else if (CLOSED.has(s)) {
      closed++;
    } else {
      open++;
    }

    if (!CLOSED.has(s)) {
      committedTotal += Number(row.total_value) || 0;
      count++;
    }
  }

  return { open, completed, closed, committedTotal, count };
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
