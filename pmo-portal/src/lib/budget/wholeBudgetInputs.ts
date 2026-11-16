import type { CanonicalBudgetReading } from '@/src/lib/db/projectMoney';
import type { CommitmentSource } from '@/src/hooks/useProcurements';

export interface WholeBudgetInputs {
  /** Order totals less what `spent` already holds. */
  openOrders: number;
  /** Recorded spending, or null when it is not known (never read as zero). */
  spent: number | null;
}

/**
 * The readings behind "Left after this purchase", each amount counted once (OD-APPROVAL-LEFT).
 * Returns null when open orders are not known (another currency, purchasing kept outside PMO, no position yet).
 * `spent: null` means only spending is unknown, so a caller can still offer the figure without it, labelled as such.
 */
export function wholeBudgetInputs(
  reading: CanonicalBudgetReading | undefined,
  committed: { data?: number; otherCurrencies: ReadonlyArray<unknown>; commitmentSource?: CommitmentSource },
  projectCurrency: string,
): WholeBudgetInputs | null {
  if (committed.commitmentSource === 'not-tracked' || committed.commitmentSource === 'unavailable') return null;
  if ((committed.otherCurrencies ?? []).length > 0) return null;
  const usable = reading !== undefined && reading.currency === projectCurrency;
  // PMO: the same row as `spent`, so a payment cannot fall between two reads. ERP (and no reading): the per-order position.
  const openOrders = usable && reading.ledgerBasis === 'pmo'
    ? reading.openCommitment
    : committed.data === undefined ? null : String(committed.data);
  if (openOrders === null) return null;
  return { openOrders: Number(openOrders), spent: usable && reading.spent !== null ? Number(reading.spent) : null };
}
