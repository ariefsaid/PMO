import { stageAgeDays } from '@/src/lib/billingStages';

/**
 * #2593 — pure derivations for a work order's close-out checklist (docs/specs/work-order-closeout-checklist.spec.md
 * FR-WCO-013, FR-WCO-020). Dates are ISO `YYYY-MM-DD` calendar days in the organisation's zone; the caller passes today.
 * The close rule itself is the database's (the close guard); these only explain it on screen.
 */
export interface CloseoutItemLike {
  required: boolean;
  startedOn: string | null;
  doneOn: string | null;
}

/** Days an item has been current: its start (issue date, or the previous item's done date) to its done date, or to today while open. */
export function closeoutItemAgeDays(item: Pick<CloseoutItemLike, 'startedOn' | 'doneOn'>, today: string): number | null {
  return stageAgeDays({ startedOn: item.startedOn, completedOn: item.doneOn }, today);
}

/** How many required items are not done yet: what stands between the work order and closing. */
export function closeoutRemaining(items: ReadonlyArray<Pick<CloseoutItemLike, 'required' | 'doneOn'>>): number {
  return items.filter((i) => i.required && !i.doneOn).length;
}

/**
 * Whether an item can be recorded now: not done yet, and (when required) every earlier REQUIRED item is done. An optional
 * item never waits and never holds the items after it (FR-WCO-011).
 */
export function closeoutItemActionable(items: ReadonlyArray<Pick<CloseoutItemLike, 'required' | 'doneOn'>>, index: number): boolean {
  const item = items[index];
  if (!item || item.doneOn) return false;
  if (!item.required) return true;
  return items.slice(0, index).every((i) => !i.required || Boolean(i.doneOn));
}
