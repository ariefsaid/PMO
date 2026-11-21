import type { ProofStatusRow } from '@/src/lib/db/stockTransfers';

/** Whole calendar days from a movement's date (YYYY-MM-DD) to today; never negative. */
export function daysWaiting(movementDate: string, today: Date = new Date()): number {
  const [y, m, d] = movementDate.slice(0, 10).split('-').map(Number);
  if (!y || !m || !d) return 0;
  const days = Math.round((Date.UTC(today.getFullYear(), today.getMonth(), today.getDate()) - Date.UTC(y, m - 1, d)) / 86_400_000);
  return Math.max(0, days);
}

/** The proof keys still missing, in order, as the rule names the proof tables already hold ("paper", "confirmation", "either"). */
export function missingRules(missing: string | null): string[] {
  return (missing ?? '').split(',').filter(Boolean);
}

/** Oldest first: the list is for chasing. */
export const byOldest = (a: ProofStatusRow, b: ProofStatusRow): number =>
  a.movementDate.localeCompare(b.movementDate) || a.number.localeCompare(b.number, undefined, { numeric: true });
