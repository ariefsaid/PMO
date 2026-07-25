import { parseISO } from 'date-fns';
import type { MilestoneWithProgress } from '@/src/lib/db/milestones';

/**
 * Pure S-curve math for the project Delivery lens (FR-SC-002/003, FR-SCA-008..011).
 *
 * v1 (OBS-SC-001): plots a genuine multi-point PLANNED curve but a SINGLE "actual to date"
 * dot — because `project_milestones` records no per-date completion history.
 *
 * v2 (FR-SCA-008..011): When `tasks` is provided and non-empty, buildSCurve emits a
 * multi-point actual series via the **hybrid source rule** (mirrors `effective_pct`):
 *   - Milestone has tasks AND no input_pct override → task-level: each Done task contributes
 *     weight·(1/total_tasks) at `completed_at` (real) else `end_date` (proxy), clamped ≤ asOf.
 *   - Milestone has input_pct override OR no tasks → milestone-level: contributes
 *     weight·input_pct/100·100 (i.e. weight·effective_pct) at `target_date`, clamped ≤ asOf.
 *   The series endpoint at asOf equals actualToDate by construction (NFR-SCA-001).
 *   When tasks absent/empty → the existing single-point fallback (FR-SCA-011).
 */

export interface SCurvePoint {
  /** ISO date 'YYYY-MM-DD' (label). */
  date: string;
  /**
   * Epoch ms (UTC midnight) for the recharts time axis (`type='number'`, `dataKey='ts'`).
   * Placing every point at its real coordinate, not by array index.
   */
  ts: number;
  /** Cumulative planned % at this date (0..100), or null on the actual-only point. */
  planned: number | null;
  /** Cumulative actual-to-date % (0..100), or null on planned-only points. */
  actual: number | null;
}

export interface SCurveModel {
  points: SCurvePoint[];
  /** Weight-weighted current rollup (actual to date), 0..100. */
  actualToDate: number;
  /** Planned % the plan expected by `asOf` (interpolated), 0..100, or null if undated. */
  plannedToDate: number | null;
}

/**
 * Narrow task view the builder reads. Structurally assignable from TaskWithRefs.
 * (FR-SCA-007/008: completed_at is the trigger-stamped instant; end_date is the proxy.)
 */
export interface SCurveTask {
  milestone_id: string | null;
  /**
   * OD-INT-9 subtask rollup rule: a non-null parent_task_id marks this row a SUBTASK. Subtasks
   * never contribute to the actual series (only top-level tasks move a percentage). Kept on the
   * narrow view so buildSCurve can filter without callers pre-stripping subtasks.
   */
  parent_task_id: string | null;
  /** Nullable archive timestamp; archived tasks never contribute to delivery. */
  archived_at?: string | null;
  /** 'To Do' | 'In Progress' | 'Done' | 'Blocked' — only 'Done' matters here. */
  status: string;
  /** ISO timestamptz, trigger-stamped when task entered Done. null = not yet Done or backfill absent. */
  completed_at: string | null;
  /** 'YYYY-MM-DD' scheduled finish — proxy when completed_at is null. */
  end_date: string | null;
}

const round2 = (x: number): number => Math.round(x * 100) / 100;
const clampPct = (x: number): number => Math.max(0, Math.min(100, x));

/**
 * Epoch ms for an ISO date string at UTC midnight — the x-coordinate for the time axis.
 * date-fns `parseISO` honours the explicit `Z` offset → UTC instant, byte-identical to the
 * prior `Date.parse(`${iso}T00:00:00Z`)` (UTC-midnight convention A; DST/TZ-immutable).
 */
export const isoToTs = (iso: string): number => parseISO(`${iso}T00:00:00Z`).getTime();

/**
 * Inverse of `isoToTs`: convert epoch-ms (UTC midnight) back to a 'YYYY-MM-DD' string.
 * Uses UTC date methods so the result is TZ-agnostic and round-trips exactly with `isoToTs`.
 */
export const tsToIso = (ts: number): string => {
  const d = new Date(ts);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
};

/**
 * Clamp an ISO date string (either 'YYYY-MM-DD' or timestamptz ISO) to be ≤ asOf.
 * Returns the epoch-ms of min(isoDate, asOf) using UTC-midnight for both inputs.
 * The `completed_at` column is a timestamptz; we extract just the date portion (first 10 chars)
 * for the comparison so that time-of-day doesn't push the result past midnight of asOf.
 * (FR-SCA-008: all proxy dates clamped ≤ asOf.)
 */
function clampDate(iso: string, asOf: string): number {
  // Take only the date portion (YYYY-MM-DD) to normalise timestamptz to day precision.
  const dateOnly = iso.slice(0, 10);
  return isoToTs(dateOnly < asOf ? dateOnly : asOf);
}

/**
 * Days between two 'YYYY-MM-DD' dates (b - a). Keeps the UTC-midnight ms-divide (via `isoToTs`'s
 * date-fns parsing) so the value is byte-identical to the prior hand-rolled divide for every input
 * — important because the result feeds a linear-interpolation fraction.
 */
const daysBetween = (a: string, b: string): number =>
  (isoToTs(b) - isoToTs(a)) / 86_400_000;

/**
 * Axis tick + tooltip formatter for the S-curve time axis.
 *
 * Takes epoch ms (the `ts` coordinate) and returns a compact label that keeps
 * **day precision** (so multiple milestones in the same month are distinguishable,
 * and the tooltip shows the exact date) AND **disambiguates the year** when the
 * chart span crosses calendar-year boundaries (e.g. 2025-03-15 → "15 Mar '25",
 * 2026-03-15 → "15 Mar '26").
 *
 * Exported so the component (axis + tooltip) can use it and tests can assert the
 * day- and year-disambiguation properties directly (AC-SC-AXIS-004/005).
 */
const axisDateFmt = new Intl.DateTimeFormat('en-GB', {
  day: '2-digit',
  month: 'short',
  year: '2-digit',
  timeZone: 'UTC',
});

export const formatSCurveAxisDate = (epochMs: number): string => {
  // Left on Intl (not date-fns `format`) intentionally: date-fns `format` is LOCAL-tz, which would
  // drift the day in behind-UTC zones. Reproducing this UTC-locale output would require the
  // separate `date-fns-tz` package (`formatInTimeZone`) — not worth a second dependency for a
  // display formatter that is already correct + UTC-stable. (ADR-0030 §F: buy the engine where it
  // kills a bug class; don't add deps chasing purity.) Parsing/arithmetic above IS date-fns-backed.
  const parts = axisDateFmt.formatToParts(new Date(epochMs));
  const find = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return `${find('day')} ${find('month')} '${find('year')}`;
};

/**
 * Returns evenly-spaced first-of-month UTC epoch-ms ticks across [tsMin, tsMax].
 *
 * Stride selection keeps the tick count in the 5–7 range for readability:
 *   span ≤ 7 months  → monthly (stride 1)
 *   span ≤ 18 months → every 2nd month (stride 2)
 *   span ≤ 36 months → every 3rd month (stride 3)
 *   span > 36 months → quarterly (stride 4)
 *
 * All ticks are first-of-month boundaries so labels never overlap regardless of
 * how clustered the underlying data points are (fixes the overlapping-axis-label
 * defect caused by auto-ticks near clustered actual-line coordinates).
 *
 * Exported so unit tests can assert determinism and the component can pass
 * explicit `ticks` to recharts XAxis.
 */
export function evenAxisTicks(tsMin: number, tsMax: number): number[] {
  // Edge: degenerate range — return the single point as-is.
  if (tsMin >= tsMax) return [tsMin];

  // Identify the first first-of-month UTC date on or after tsMin.
  const dMin = new Date(tsMin);
  let year = dMin.getUTCFullYear();
  let month = dMin.getUTCMonth(); // 0-based

  // If tsMin is not already the 1st, advance to the next month's 1st.
  if (dMin.getUTCDate() !== 1) {
    month += 1;
    if (month > 11) { month = 0; year += 1; }
  }

  // Identify the last first-of-month UTC date on or before tsMax.
  const dMax = new Date(tsMax);
  let endYear = dMax.getUTCFullYear();
  let endMonth = dMax.getUTCMonth();
  // Step back to the 1st of the current month if needed.
  // (Date.UTC with day=1 always gives midnight UTC.)
  if (Date.UTC(endYear, endMonth, 1) > tsMax) {
    endMonth -= 1;
    if (endMonth < 0) { endMonth = 11; endYear -= 1; }
  }

  // Total number of first-of-month boundaries from start to end (inclusive).
  const totalMonths = (endYear - year) * 12 + (endMonth - month) + 1;

  if (totalMonths <= 0) {
    // No first-of-month boundary fits within [tsMin, tsMax]; return tsMin itself.
    return [tsMin];
  }

  // Choose stride to keep tick count near 5–7.
  let stride: number;
  if (totalMonths <= 7) {
    stride = 1;
  } else if (totalMonths <= 18) {
    stride = 2;
  } else if (totalMonths <= 36) {
    stride = 3;
  } else {
    stride = 4;
  }

  const ticks: number[] = [];
  let m = month;
  let y = year;

  while (y < endYear || (y === endYear && m <= endMonth)) {
    const tickTs = Date.UTC(y, m, 1);
    if (tickTs >= tsMin && tickTs <= tsMax) {
      ticks.push(tickTs);
    }
    m += stride;
    while (m > 11) { m -= 12; y += 1; }
  }

  // Safety: ensure the last first-of-month boundary is always included so there
  // is always a tick close to tsMax (within one stride-period of the end).
  const lastBoundary = Date.UTC(endYear, endMonth, 1);
  if (ticks.length === 0 || ticks[ticks.length - 1] !== lastBoundary) {
    if (lastBoundary >= tsMin && lastBoundary <= tsMax) {
      ticks.push(lastBoundary);
    }
  }

  return ticks;
}

/**
 * Build the S-curve series from milestones (and optionally tasks). Pure + deterministic.
 *
 * - `totalWeight` = Σ weight over milestones with weight > 0 (dated or not), so the
 *   planned curve and the actual rollup share ONE denominator (no drift between them).
 * - `actualToDate` = round2(Σ(weight · clamp(effective_pct,0,100)) / totalWeight) over
 *   ALL milestones — independent of dates.
 * - Dated milestones are sorted ascending by `target_date`, ties broken by `sort_order`;
 *   the running cumulative weight gives `planned = round2(100 · running / totalWeight)`.
 *   The planned series is prefixed by an origin point at the earliest date valued 0.
 * - `plannedToDate` = the planned curve linearly interpolated at `asOf`, clamped [0,100]
 *   (before the first point → 0, after the last → 100).
 * - When `tasks` is provided and non-empty: the hybrid actual series (FR-SCA-008..011).
 * - When `tasks` is absent/empty: single-point fallback at `asOf` valued `actualToDate`.
 * - No dated milestones (or zero total weight) → `points: []` (caller shows the empty
 *   state), but `actualToDate` is still computed when there is weight.
 */
export function buildSCurve(
  milestones: MilestoneWithProgress[],
  asOf: string,
  tasks?: SCurveTask[],
): SCurveModel {
  const totalWeight = milestones.reduce(
    (sum, m) => (m.weight > 0 ? sum + m.weight : sum),
    0,
  );

  if (totalWeight === 0) {
    return { points: [], actualToDate: 0, plannedToDate: null };
  }

  const actualToDate = round2(
    milestones.reduce(
      (sum, m) => (m.weight > 0 ? sum + m.weight * clampPct(m.effective_pct) : sum),
      0,
    ) / totalWeight,
  );

  // Dated, weighted milestones → the planned cumulative curve.
  const dated = milestones
    .filter((m) => m.weight > 0 && m.target_date != null)
    .sort((a, b) => {
      if (a.target_date! < b.target_date!) return -1;
      if (a.target_date! > b.target_date!) return 1;
      return a.sort_order - b.sort_order;
    });

  if (dated.length === 0) {
    return { points: [], actualToDate, plannedToDate: null };
  }

  // Planned cumulative points: origin at the earliest date (0%), then one per milestone.
  const plannedSeries: Array<{ date: string; planned: number }> = [
    { date: dated[0].target_date!, planned: 0 },
  ];
  let running = 0;
  for (const m of dated) {
    running += m.weight;
    plannedSeries.push({
      date: m.target_date!,
      planned: round2((100 * running) / totalWeight),
    });
  }

  const plannedToDate = interpolatePlanned(plannedSeries, asOf);

  // Base points list from the planned series (actual=null on all planned points).
  const points: SCurvePoint[] = plannedSeries.map((p) => ({
    date: p.date,
    ts: isoToTs(p.date),
    planned: p.planned,
    actual: null,
  }));

  // ── Actual series (FR-SCA-008..011) ─────────────────────────────────────────
  //
  // When tasks arg is provided (even empty), attempt to build a hybrid actual series.
  // Tasks=undefined (absent) → immediate single-point fallback (FR-SCA-011).
  // Tasks=[] or all non-Done → 0 contributions → same single-point fallback.
  //
  // Each weighted milestone contributes one or more (ts, numerator) pairs:
  //   - Has tasks AND no input_pct override → one contribution per Done task.
  //   - Has input_pct override OR no tasks → one contribution at target_date.
  // Contributions are accumulated in ascending ts order → monotone series (FR-SCA-009).
  // Final point forced to asOf valued actualToDate anchors endpoint to the gauge (NFR-SCA-001).
  if (tasks !== undefined) {
    const tasksByMilestone = new Map<string | null, SCurveTask[]>();
    for (const t of tasks) {
      // OD-INT-9 subtask rollup rule: subtasks (parent_task_id != null) never move a percentage.
      // Excluding them here keeps them out of BOTH the per-milestone Done/total denominator AND
      // the contribution series, so the gauge (driven by the milestone RPC's effective_pct) and
      // the trajectory agree on "top-level tasks only".
      if (t.parent_task_id !== null || t.archived_at != null) continue;
      const key = t.milestone_id;
      if (!tasksByMilestone.has(key)) tasksByMilestone.set(key, []);
      tasksByMilestone.get(key)!.push(t);
    }

    // Collect (ts, numeratorContribution) pairs from each weighted milestone.
    const contributions: Array<{ ts: number; numerator: number }> = [];

    for (const m of milestones) {
      if (m.weight <= 0) continue;

      const msTasksAll = tasksByMilestone.get(m.id) ?? [];
      const hasTasks = msTasksAll.length > 0;
      const hasOverride = m.input_pct != null;

      if (hasOverride || !hasTasks) {
        // ── Milestone-level path: override or no tasks ──────────────────────
        // Contribution = weight · clampPct(effective_pct); placed at target_date.
        // Skip if no target_date (Error-Handling row in spec).
        if (m.target_date == null) continue;
        const ts = clampDate(m.target_date, asOf);
        const numerator = m.weight * clampPct(m.effective_pct);
        contributions.push({ ts, numerator });
      } else {
        // ── Task-level path: has tasks, no override ─────────────────────────
        // Each Done task contributes weight · (1 / total_tasks) at completed_at else end_date.
        const totalTasksInMs = msTasksAll.length;
        const perTaskNumerator = (m.weight * 100) / totalTasksInMs;
        for (const t of msTasksAll) {
          if (t.status !== 'Done') continue;
          // Use completed_at if present, else end_date proxy. Skip if both null.
          const dateIso = t.completed_at ?? t.end_date;
          if (dateIso == null) continue;
          const ts = clampDate(dateIso, asOf);
          contributions.push({ ts, numerator: perTaskNumerator });
        }
      }
    }

    // Sort contributions by ts ascending (non-decreasing — FR-SCA-009).
    contributions.sort((a, b) => a.ts - b.ts);

    if (contributions.length > 0) {
      // Accumulate into the points list; merge by ts (same-ts contributions collapse).
      let runningNumerator = 0;
      const actualPointsMap = new Map<number, number>(); // ts → running actual value

      for (const c of contributions) {
        runningNumerator += c.numerator;
        const val = round2(runningNumerator / totalWeight);
        actualPointsMap.set(c.ts, val);
      }

      // Emit actual points in ts order.
      const asOfTs = isoToTs(asOf);
      for (const [ts, val] of actualPointsMap) {
        // Convert ts back to 'YYYY-MM-DD' for the date label.
        const date = tsToIso(ts);
        points.push({ date, ts, planned: null, actual: val });
      }

      // If the last contribution ts < asOfTs, add a terminal point at asOf valued actualToDate
      // to anchor the endpoint to the gauge (FR-SCA-010 / NFR-SCA-001).
      const lastContribTs = [...actualPointsMap.keys()].at(-1)!;
      if (lastContribTs < asOfTs) {
        points.push({ date: asOf, ts: asOfTs, planned: null, actual: actualToDate });
      } else if (lastContribTs === asOfTs) {
        // The last contribution already lands at asOf; force its value to actualToDate
        // to guarantee the endpoint invariant (NFR-SCA-001) even under floating-point drift.
        const lastPoint = points.find((p) => p.ts === asOfTs && p.actual !== null);
        if (lastPoint) lastPoint.actual = actualToDate;
      }

      return { points, actualToDate, plannedToDate };
    }
  }

  // ── Single-point fallback (FR-SCA-011) ──────────────────────────────────────
  // tasks absent, empty, or no contributions (all tasks non-Done + no override milestones) →
  // preserve the v1 single "actual to date" dot at asOf.
  points.push({ date: asOf, ts: isoToTs(asOf), planned: null, actual: actualToDate });

  return { points, actualToDate, plannedToDate };
}

/** Linear interpolation of the planned curve at `asOf`, clamped to [0,100]. */
function interpolatePlanned(
  series: Array<{ date: string; planned: number }>,
  asOf: string,
): number {
  const first = series[0];
  const last = series[series.length - 1];
  if (asOf <= first.date) return clampPct(first.planned);
  if (asOf >= last.date) return clampPct(last.planned);

  for (let i = 1; i < series.length; i += 1) {
    const prev = series[i - 1];
    const next = series[i];
    if (asOf <= next.date) {
      const span = daysBetween(prev.date, next.date);
      if (span <= 0) return clampPct(next.planned);
      const frac = daysBetween(prev.date, asOf) / span;
      return clampPct(prev.planned + (next.planned - prev.planned) * frac);
    }
  }
  return clampPct(last.planned);
}
