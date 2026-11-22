import { formatCalendarDayInTimeZone } from '@/src/lib/format';

/**
 * #2800 — pure derivations for checklist target dates (docs/specs/checklist-target-dates.spec.md FR-CTD-009,
 * AC-CTD-009). A due day is the DATABASE's column (`work_order_closeout_items.due_on`, the clearance due-day
 * function `clearance_due_on`); nothing here invents one. These only answer, for a passed-in organisation day:
 * is this item overdue, and how many overdue items does each work order / person carry.
 *
 * Dates are ISO `YYYY-MM-DD` calendar days in the organisation's zone (the server's `native_org_today`). "Past the
 * due day" is strictly `due_on < today`, the same comparison the daily runner uses, so the marker and the notice
 * agree on the day an item first counts as overdue.
 */

/**
 * The organisation's calendar day for an instant, in an explicitly supplied zone. The caller supplies the zone
 * (the resolved organisation timezone, `coalesce(default_timezone, 'UTC')` on the server), so no clock and no
 * ambient locale is read here and the day boundary is testable without mocking time.
 */
export function orgToday(instant: Date, timezone: string): string {
  return formatCalendarDayInTimeZone(instant, timezone || 'UTC');
}

export interface DueItemLike {
  /** The database's due day (`due_on`), or null when the item carries no target. */
  dueOn: string | null;
  /** Done: close-out `done_on` set; clearance a recorded row (or a live document, as the database reads it). */
  done: boolean;
}

/** True when an item is not done and its due day has passed. A missing due day is never overdue (FR-CTD-005). */
export function isChecklistItemOverdue(item: DueItemLike, today: string): boolean {
  return !item.done && item.dueOn !== null && item.dueOn < today;
}

export interface CloseoutDueRowLike {
  workOrderId: string;
  dueOn: string | null;
  doneOn: string | null;
}

/** Overdue close-out item count per work order (FR-CTD-009), from open items that carry a due day. */
export function closeoutOverdueByWorkOrder(rows: ReadonlyArray<CloseoutDueRowLike>, today: string): Map<string, number> {
  const counts = new Map<string, number>();
  for (const row of rows) {
    if (!isChecklistItemOverdue({ dueOn: row.dueOn, done: row.doneOn !== null }, today)) continue;
    counts.set(row.workOrderId, (counts.get(row.workOrderId) ?? 0) + 1);
  }
  return counts;
}

export interface ClearanceDueRowLike {
  personId: string;
  itemId: string;
  dueOn: string | null;
  /** The database's own answer (`person_clearance_due().overdue`); never recomputed here. */
  overdue: boolean;
}

/** Overdue clearance item count per person (FR-CTD-009), from the database's per-(person, item) answer. */
export function clearanceOverdueByPerson(rows: ReadonlyArray<ClearanceDueRowLike>): Map<string, number> {
  const counts = new Map<string, number>();
  for (const row of rows) {
    if (!row.overdue) continue;
    counts.set(row.personId, (counts.get(row.personId) ?? 0) + 1);
  }
  return counts;
}

export interface PersonItemDue {
  dueOn: string;
  overdue: boolean;
}

/** One person's due rows by item id, for the checklist's marker. Other people's rows are ignored. */
export function clearanceDueByItem(
  rows: ReadonlyArray<ClearanceDueRowLike>,
  personId: string,
): Map<string, PersonItemDue> {
  const byItem = new Map<string, PersonItemDue>();
  for (const row of rows) {
    if (row.personId !== personId || row.dueOn === null) continue;
    byItem.set(row.itemId, { dueOn: row.dueOn, overdue: row.overdue });
  }
  return byItem;
}

/**
 * A form's day-count draft → a target (1–365), `null` for a blank field, or `undefined` for a draft that is not a whole
 * number in range. The one rule both checklist item forms apply before they write; the database checks the same bounds
 * again (the close-out list refuses with `COT_TARGET_DAYS`).
 */
export function parseTargetDays(raw: string): number | null | undefined {
  const text = raw.trim();
  if (text === '') return null;
  if (!/^[0-9]{1,3}$/.test(text)) return undefined;
  const days = Number(text);
  return days >= 1 && days <= 365 ? days : undefined;
}
