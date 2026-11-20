/** Queue urgency from age alone: no due dates exist for approvals, so how long it has waited is the signal. */
export type Urgency = 'overdue' | 'today' | 'later';

/** Whole days a decision may wait before it counts as overdue. */
export const OVERDUE_AFTER_DAYS = 3;

const DAY_MS = 86_400_000;
export function ageInDays(iso: string | null | undefined, now: Date = new Date()): number {
  const at = iso ? new Date(iso).getTime() : NaN;
  if (Number.isNaN(at)) return 0;
  return Math.max(0, Math.floor((now.getTime() - at) / DAY_MS));
}

export function urgencyOf(iso: string | null | undefined, now: Date = new Date()): Urgency {
  const days = ageInDays(iso, now);
  return days >= OVERDUE_AFTER_DAYS ? 'overdue' : days >= 1 ? 'today' : 'later';
}

/** Overdue, Today, Later; each group oldest first; empty groups dropped. */
