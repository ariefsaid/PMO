/** Queue urgency from age alone: no due dates exist for approvals, so how long it has waited is the signal. */
export type Urgency = 'overdue' | 'today' | 'later';

/** Whole days a decision may wait before it counts as overdue. */
export const OVERDUE_AFTER_DAYS = 3;

/** Whole days after which a queue row's waiting time takes the waiting tone (display only; a week). */
export const WAITING_OLD_AFTER_DAYS = 7;

const DAY_MS = 86_400_000;
const ORDER: Urgency[] = ['overdue', 'today', 'later'];

export function ageInDays(iso: string | null | undefined, now: Date = new Date()): number {
  const at = iso ? new Date(iso).getTime() : NaN;
  if (Number.isNaN(at)) return 0;
  return Math.max(0, Math.floor((now.getTime() - at) / DAY_MS));
}

/**
 * Overdue once it has waited the overdue threshold; Today while it arrived under a day ago (the row then reads
 * "Today" too); Later for the rest. A missing or unreadable date is Later, so the item is never hidden.
 */
export function urgencyOf(iso: string | null | undefined, now: Date = new Date()): Urgency {
  if (!iso || Number.isNaN(new Date(iso).getTime())) return 'later';
  const days = ageInDays(iso, now);
  return days >= OVERDUE_AFTER_DAYS ? 'overdue' : days === 0 ? 'today' : 'later';
}

const timeOf = (iso: string | null | undefined): number => {
  const ms = iso ? new Date(iso).getTime() : NaN;
  return Number.isNaN(ms) ? Number.POSITIVE_INFINITY : ms;
};

/** Overdue, Today, Later; each group oldest first; empty groups dropped. */
export function groupByUrgency<T>(items: readonly T[], at: (item: T) => string | null | undefined, now: Date = new Date()) {
  return ORDER.map((group) => ({
    group,
    items: items
      .filter((item) => urgencyOf(at(item), now) === group)
      .sort((a, b) => timeOf(at(a)) - timeOf(at(b))),
  })).filter((g) => g.items.length > 0);
}

/** A submitted week waits from its submission; a sheet with no stamp waits from the end of its week. */
export function timesheetWaitingSince(sheet: { submitted_at?: string | null; week_start_date: string }): string {
  if (sheet.submitted_at) return sheet.submitted_at;
  const [y, m, d] = sheet.week_start_date.split('-').map(Number);
  return new Date(y, (m ?? 1) - 1, (d ?? 1) + 7).toISOString();
}
