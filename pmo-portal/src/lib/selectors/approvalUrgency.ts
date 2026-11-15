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
