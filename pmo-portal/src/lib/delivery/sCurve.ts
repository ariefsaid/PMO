import type { MilestoneWithProgress } from '@/src/lib/db/milestones';

/**
 * Pure S-curve math for the project Delivery lens (FR-SC-002/003, OBS-SC-001).
 *
 * OBS-SC-001 (honesty): `project_milestones` records no per-date actual-completion
 * history — only the current weight-weighted `effective_pct`. So v1 plots a genuine
 * multi-point PLANNED curve (one cumulative point per dated milestone) but a SINGLE
 * "actual to date" point at `asOf`; it does NOT synthesize historical actuals. When a
 * future migration adds a milestone completion date, the actual series can step at
 * those dates with no rewrite — `buildSCurve` already emits a `{date, planned, actual}`
 * point list either way.
 */

export interface SCurvePoint {
  /** ISO date 'YYYY-MM-DD' (x). */
  date: string;
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

const round2 = (x: number): number => Math.round(x * 100) / 100;
const clampPct = (x: number): number => Math.max(0, Math.min(100, x));

/** Days between two 'YYYY-MM-DD' dates (b - a), via UTC midnight to avoid DST drift. */
const daysBetween = (a: string, b: string): number => {
  const ms = Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`);
  return ms / 86_400_000;
};

/**
 * Build the S-curve series from milestones. Pure + deterministic.
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
 * - The actual series carries a single point at `asOf` valued `actualToDate`.
 * - No dated milestones (or zero total weight) → `points: []` (caller shows the empty
 *   state), but `actualToDate` is still computed when there is weight.
 */
export function buildSCurve(
  milestones: MilestoneWithProgress[],
  asOf: string,
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

  // Merge into the {date, planned, actual} point list. The actual series is a single
  // point at `asOf` (OBS-SC-001 — no fabricated history).
  const points: SCurvePoint[] = plannedSeries.map((p) => ({
    date: p.date,
    planned: p.planned,
    actual: null,
  }));
  points.push({ date: asOf, planned: null, actual: actualToDate });

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
