import { instantToZonedDatetimeLocal } from '@/src/lib/format';
/**
 * When a prompted survey may appear (#1532 S9). Pure rules; `SurveyHost` feeds them a snapshot.
 * The 30-day cap is PostHog's own wait period (survey setting), not decided here.
 */

export const FIRST_WEEK_MS = 7 * 86_400_000;
/** No keypress or click for this long before a prompt may appear. */
export const QUIET_MS = 3000;

/** Fail closed: an unknown or unparseable account age counts as "still in the first week". */
export function isPastFirstWeek(createdAt: string | undefined, now: number): boolean {
  const t = createdAt ? Date.parse(createdAt) : NaN;
  return Number.isFinite(t) && now - t > FIRST_WEEK_MS;
}

export interface Moment {
  now: number;
  lastInteractionAt: number;
  openDialogs: number;
  editableFocused: boolean;
  mutationsInFlight: number;
  pathname: string;
}

// Create / edit / import routes end in these segments (/procurement/new, /views/:id/edit, /projects/import).
const FORM_ROUTE = /\/(new|edit|import)\/?$/;

/** Why this is not a safe moment, or null when it is (never interrupt a write or a form). */
export function momentRefusal(m: Moment): 'dialog' | 'field' | 'write' | 'busy' | 'form-route' | null {
  if (m.openDialogs > 0) return 'dialog';
  if (m.editableFocused) return 'field';
  if (m.mutationsInFlight > 0) return 'write';
  if (m.now - m.lastInteractionAt < QUIET_MS) return 'busy';
  if (FORM_ROUTE.test(m.pathname)) return 'form-route';
  return null;
}

const ACTIVE_DAYS_KEY = 'pmo.activeDays';
const WINDOW_DAYS = 14;
const ACTIVE_MIN_DAYS = 3;

type Store = Pick<Storage, 'getItem' | 'setItem'>;

function readDays(storage: Store): string[] {
  try {
    const v = JSON.parse(storage.getItem(ACTIVE_DAYS_KEY) ?? '[]');
    return Array.isArray(v) ? v.filter((d): d is string => typeof d === 'string') : [];
  } catch {
    return [];
  }
}

/** The calendar day (YYYY-MM-DD) of an instant in the given timezone: the org's day, not UTC's. */
export function dayInZone(ms: number, timeZone: string): string {
  return instantToZonedDatetimeLocal(new Date(ms), timeZone).slice(0, 10);
}

/** Remember that the user was here on `today` (a YYYY-MM-DD day from `dayInZone`); keeps the last fourteen distinct days. */
export function recordActiveDay(storage: Store, today: string): void {
  try {
    const days = readDays(storage);
    if (days.includes(today)) return;
    storage.setItem(ACTIVE_DAYS_KEY, JSON.stringify([...days, today].slice(-WINDOW_DAYS)));
  } catch {
    /* storage blocked: the user simply never counts as active */
  }
}

export function readActiveDays(storage: Store): string[] {
  return readDays(storage);
}

/** Active = seen on at least three distinct days of the last fourteen. */
export function isActiveUser(days: string[], today: string): boolean {
  const end = Date.parse(today);
  if (!Number.isFinite(end)) return false;
  const inWindow = days.filter((d) => {
    const age = (end - Date.parse(d)) / 86_400_000;
    return age >= 0 && age < WINDOW_DAYS;
  });
  return new Set(inWindow).size >= ACTIVE_MIN_DAYS;
}
