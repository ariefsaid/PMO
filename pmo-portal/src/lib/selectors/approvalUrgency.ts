/** Queue urgency from age alone: no due dates exist for approvals, so how long it has waited is the signal. */
export type Urgency = 'overdue' | 'today' | 'later';

/** Whole days a decision may wait before it counts as overdue. */
export const OVERDUE_AFTER_DAYS = 3;

const DAY_MS = 86_400_000;
const ORDER: Urgency[] = ['overdue', 'today', 'later'];

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
export function groupByUrgency<T>(items: readonly T[], at: (item: T) => string | null | undefined, now: Date = new Date()) {
  return ORDER.map((group) => ({
    group,
    items: items
      .filter((item) => urgencyOf(at(item), now) === group)
      .sort((a, b) => (at(a) ?? '').localeCompare(at(b) ?? '')),
  })).filter((g) => g.items.length > 0);
}

/** A submitted week waits from its submission; a sheet with no stamp waits from the end of its week. */
export function timesheetWaitingSince(sheet: { submitted_at?: string | null; week_start_date: string }): string {
  if (sheet.submitted_at) return sheet.submitted_at;
  const [y, m, d] = sheet.week_start_date.split('-').map(Number);
  return new Date(y, (m ?? 1) - 1, (d ?? 1) + 7).toISOString();
}

export type ArrivalGroup = 'overdue' | 'today' | 'earlier';
const ARRIVAL_ORDER: ArrivalGroup[] = ['overdue', 'today', 'earlier'];

/**
 * Queue groups built on the age rule above without changing it: Overdue is urgencyOf === 'overdue' (at or past
 * OVERDUE_AFTER_DAYS); Today is what arrived today (ageInDays 0); Earlier is everything between. A missing or
 * unreadable date is Earlier, so the item is never hidden. Each group oldest first; empty groups dropped.
 */
export function arrivalGroupOf(iso: string | null | undefined, now: Date = new Date()): ArrivalGroup {
  if (urgencyOf(iso, now) === 'overdue') return 'overdue';
  if (iso && !Number.isNaN(new Date(iso).getTime()) && ageInDays(iso, now) === 0) return 'today';
  return 'earlier';
}

export function groupByArrival<T>(items: readonly T[], at: (item: T) => string | null | undefined, now: Date = new Date()) {
  const time = (iso: string | null | undefined) => {
    const ms = iso ? new Date(iso).getTime() : NaN;
    return Number.isNaN(ms) ? Number.POSITIVE_INFINITY : ms;
  };
  return ARRIVAL_ORDER.map((group) => ({
    group,
    items: items.filter((i) => arrivalGroupOf(at(i), now) === group).sort((a, b) => time(at(a)) - time(at(b))),
  })).filter((g) => g.items.length > 0);
}
