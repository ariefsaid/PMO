/**
 * Pure date helpers for the read-only Project Calendar view (no external deps).
 *
 * All date math is done with the native `Date` in LOCAL time. `target_date` /
 * `start_date` / `end_date` arrive as `YYYY-MM-DD` calendar dates with no time
 * zone — they must be parsed locally (`parseLocalDate`) so a project dated the
 * 3rd never renders in the 2nd's cell after a UTC shift. The matrix is a fixed
 * 6×7 grid (always 42 cells) so the month container never reflows between months.
 */

/** A displayed-month pointer. `month` is 0-based (0 = January) to match `Date`. */
export interface MonthCursor {
  year: number;
  month: number;
}

/** One day cell in the month grid. `iso` is the local YYYY-MM-DD key. */
export interface DayCell {
  iso: string;
  day: number;
  inMonth: boolean;
  /** 0 = Sunday … 6 = Saturday. */
  weekdayIndex: number;
  isToday: boolean;
}

/** Parse a `YYYY-MM-DD` string as a LOCAL date (no UTC/TZ shift). */
export function parseLocalDate(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d);
}

/** Format a Date as a local `YYYY-MM-DD` string (matches `parseLocalDate`). */
export function toIso(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate(),
  ).padStart(2, '0')}`;
}

/** Human month label, e.g. `June 2026` (en-US, locale-stable for the header). */
export function monthLabel(year: number, month: number): string {
  return new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric' }).format(
    new Date(year, month, 1),
  );
}

/** Shift a cursor by whole months, rolling year boundaries. */
export function addMonths(c: MonthCursor, delta: number): MonthCursor {
  const d = new Date(c.year, c.month + delta, 1);
  return { year: d.getFullYear(), month: d.getMonth() };
}

/** The cursor for the month containing today. */
export function todayCursor(): MonthCursor {
  const n = new Date();
  return { year: n.getFullYear(), month: n.getMonth() };
}

/**
 * Build a fixed 6×7 month matrix (Sunday-first). Leading/trailing days from the
 * adjacent months are included with `inMonth: false` so the grid never reflows.
 */
export function buildMonthMatrix(year: number, month: number): DayCell[][] {
  const todayIso = toIso(new Date());
  const first = new Date(year, month, 1);
  // Back up to the Sunday of the first week.
  const start = new Date(year, month, 1 - first.getDay());
  const weeks: DayCell[][] = [];
  for (let w = 0; w < 6; w++) {
    const row: DayCell[] = [];
    for (let i = 0; i < 7; i++) {
      const cur = new Date(start.getFullYear(), start.getMonth(), start.getDate() + w * 7 + i);
      const iso = toIso(cur);
      row.push({
        iso,
        day: cur.getDate(),
        inMonth: cur.getMonth() === month,
        weekdayIndex: cur.getDay(),
        isToday: iso === todayIso,
      });
    }
    weeks.push(row);
  }
  return weeks;
}
