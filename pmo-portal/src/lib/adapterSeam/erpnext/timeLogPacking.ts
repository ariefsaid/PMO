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
 * site-local `'YYYY-MM-DD HH:MM:SS'` built by integer minute arithmetic, NEVER by `new Date()` —
 * which would apply the RUNNER's timezone and silently mis-date an hour at a day boundary, and whose
 * ISO form is a `Z`-suffixed string that reaches ERP's DB layer unparsed as an unguarded raw 500
 * (spike §4). Hours cross as decimal STRINGS (FR-TSP-070).
 */
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

const MAX_MINUTES_PER_DAY = 24 * 60;

/** Decimal-string hours → integer minutes WITHOUT float drift: split on '.', scale the fraction to
 *  2dp, integer-multiply. (`'0.05'` = 3 min; `'7.25'` = 435 min.) */
function hoursToMinutes(hours: string): number {
  const raw = String(hours).trim();
  if (!/^\d+(\.\d+)?$/.test(raw)) throw new Error(`unparseable hours: ${hours}`);
  const [wholeRaw, fracRaw = ''] = raw.split('.');
  const whole = Number.parseInt(wholeRaw || '0', 10);
  const frac = Number.parseInt((fracRaw + '00').slice(0, 2), 10);
  return whole * 60 + Math.round((frac * 60) / 100);
}

function minutesToClock(totalMinutes: number): string {
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00`;
}

/**
 * Pack PMO entries into non-overlapping ERP time logs.
 *
 * @throws Error('daily-hours-exceed-24') — FR-TSP-055. PMO caps a SINGLE entry at 24h (0001 CHECK)
 *   but NOT the daily total across projects: 3 projects × 10h is a legal PMO sheet. ERP has NO cap of
 *   its own (spike §7 — it accepts the spill with a clean 200 and quietly mis-dates the tail into the
 *   NEXT ERP calendar day), so this is the only guard. Rejected BEFORE any ERP call.
 */
export function packTimeLogs(entries: TimesheetEntryInput[], dayStart: string): PackedTimeLog[] {
  const sorted = [...entries].sort((a, b) =>
    a.entry_date === b.entry_date ? a.project_id.localeCompare(b.project_id) : a.entry_date.localeCompare(b.entry_date),
  );
  const [sh, sm] = dayStart.split(':').map((p) => Number.parseInt(p, 10));
  const startMinutes = sh * 60 + sm;
  const cursor = new Map<string, number>();
  const out: PackedTimeLog[] = [];
  for (const entry of sorted) {
    const minutes = hoursToMinutes(entry.hours);
    if (minutes <= 0) continue; // zero rows are dropped (FR-TSP-056) — ERP rejects a 0-hour row at submit
    const at = cursor.get(entry.entry_date) ?? startMinutes;
    if (at - startMinutes + minutes > MAX_MINUTES_PER_DAY) throw new Error('daily-hours-exceed-24');
    out.push({
      entry_date: entry.entry_date,
      project_id: entry.project_id,
      from_time: `${entry.entry_date} ${minutesToClock(at)}`,
      to_time: `${entry.entry_date} ${minutesToClock(at + minutes)}`,
      hours: entry.hours,
    });
    cursor.set(entry.entry_date, at + minutes);
  }
  return out;
}
