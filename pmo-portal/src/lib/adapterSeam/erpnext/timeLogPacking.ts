/**
 * erpnext/timeLogPacking.ts (P3b, FR-TSP-062/063/055) — PMO stores `entry_date` + `hours` and NO
 * clock times; ERP's `time_logs[]` needs real datetimes (spike
 * docs/spikes/2026-07-20-erpnext-timesheet-fields.md §1). This synthesizes them DETERMINISTICALLY:
 * per date, ordered by (entry_date, project_id) — a stable TOTAL order, never object-key or hash
 * order — starting at `dayStart`, each row packed sequentially and NON-OVERLAPPING (spike §3: ERP's
 * overlap validator rejects the whole document, within a doc AND across docs, on every save).
 * Determinism is load-bearing: a re-push after a `committed`-state recovery must rebuild a
 * byte-identical body.
 *
 * BOTH `from_time` and `to_time` are emitted (spike §1a): whenever both are present ERP RECOMPUTES
 * `hours` from them, so sending both removes every drift/derivation surface. Datetimes are NAIVE
 * site-local `'YYYY-MM-DD HH:MM:SS'` built by integer second arithmetic, without converting wall times to instants —
 * which would apply the RUNNER's timezone and silently mis-date an hour at a day boundary, and whose
 * ISO form is a `Z`-suffixed string that reaches ERP's DB layer unparsed as an unguarded raw 500
 * (spike §4). Hours cross as decimal STRINGS (FR-TSP-070).
 */
import { addDays } from '../../reports/months.ts';

export interface TimesheetEntryInput {
  project_id: string;
  entry_date: string;
  hours: string;
}

export interface PackedTimeLog {
  entry_date: string;
  project_id: string;
  from_time: string;
  to_time: string;
  hours: string;
}

const SECONDS_PER_DAY = 24 * 60 * 60;

/** Two decimal places of hours are exact multiples of 36 seconds. */
function hoursToSeconds(hours: string): number {
  const raw = String(hours).trim();
  if (!/^\d+(?:\.\d{1,2}0*)?$/.test(raw)) throw new Error(`unparseable hours: ${hours}`);
  const [wholeRaw, fracRaw = ''] = raw.split('.');
  const whole = Number.parseInt(wholeRaw, 10);
  const frac = Number.parseInt((fracRaw + '00').slice(0, 2), 10);
  return whole * 3600 + frac * 36;
}

function secondsToClock(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return [h, m, s].map((part) => String(part).padStart(2, '0')).join(':');
}

function startToSeconds(dayStart: string): number {
  if (!/^(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/.test(dayStart)) {
    throw new Error('invalid-timesheet-day-start');
  }
  const [h, m, s = 0] = dayStart.split(':').map(Number);
  return h * 3600 + m * 60 + s;
}

/**
 * Pack PMO entries into non-overlapping ERP time logs.
 *
 * @throws Error('daily-hours-exceed-24') — FR-TSP-055. PMO caps a SINGLE entry at 24h (0001 CHECK)
 *   but NOT the daily total across projects: 3 projects × 10h is a legal PMO sheet. ERP has NO cap of
 *   its own (spike §7 — it accepts the spill with a clean 200 and quietly mis-dates the tail into the
 *   NEXT ERP calendar day), so this is the only guard. An endpoint exactly at midnight is allowed;
 *   an interval extending past it is rejected BEFORE any ERP call.
 */
export function packTimeLogs(entries: TimesheetEntryInput[], dayStart: string): PackedTimeLog[] {
  const sorted = [...entries].sort((a, b) =>
    a.entry_date === b.entry_date ? a.project_id.localeCompare(b.project_id) : a.entry_date.localeCompare(b.entry_date),
  );
  const startSeconds = startToSeconds(dayStart);
  const cursor = new Map<string, number>();
  const out: PackedTimeLog[] = [];
  for (const entry of sorted) {
    const seconds = hoursToSeconds(entry.hours);
    if (seconds <= 0) continue; // zero rows are dropped (FR-TSP-056) — ERP rejects a 0-hour row at submit
    const at = cursor.get(entry.entry_date) ?? startSeconds;
    if (at + seconds > SECONDS_PER_DAY) throw new Error('daily-hours-exceed-24');
    out.push({
      entry_date: entry.entry_date,
      project_id: entry.project_id,
      from_time: `${entry.entry_date} ${secondsToClock(at)}`,
      to_time: at + seconds === SECONDS_PER_DAY
        ? `${addDays(entry.entry_date, 1)} 00:00:00`
        : `${entry.entry_date} ${secondsToClock(at + seconds)}`,
      hours: entry.hours,
    });
    cursor.set(entry.entry_date, at + seconds);
  }
  return out;
}
