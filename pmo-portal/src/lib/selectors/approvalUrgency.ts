/**
 * Queue urgency from age alone: no due dates exist for approvals, so how long it has waited is the signal.
 * `overdue` = waited 3+ whole days, `waiting` = 1–2 days, `new` = under a day.
 */
export type Urgency = 'overdue' | 'waiting' | 'new';

/** Whole days a decision may wait before it counts as overdue. */
export const OVERDUE_AFTER_DAYS = 3;

const DAY_MS = 86_400_000;
const ORDER: Urgency[] = ['overdue', 'waiting', 'new'];

export function ageInDays(iso: string | null | undefined, now: Date = new Date()): number {
  const at = iso ? new Date(iso).getTime() : NaN;
  if (Number.isNaN(at)) return 0;
  return Math.max(0, Math.floor((now.getTime() - at) / DAY_MS));
}

export function urgencyOf(iso: string | null | undefined, now: Date = new Date()): Urgency {
  const days = ageInDays(iso, now);
  return days >= OVERDUE_AFTER_DAYS ? 'overdue' : days >= 1 ? 'waiting' : 'new';
}

/** Longest wait first (overdue, waiting, new); each group oldest first; empty groups dropped. */
export function groupByUrgency<T>(items: readonly T[], at: (item: T) => string | null | undefined, now: Date = new Date()) {
  return ORDER.map((group) => ({
    group,
    items: items
      .filter((item) => urgencyOf(at(item), now) === group)
      .sort((a, b) => (at(a) ?? '').localeCompare(at(b) ?? '')),
  })).filter((g) => g.items.length > 0);
}
