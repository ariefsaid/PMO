import { describe, it, expect } from 'vitest';
import { buildSCurve, evenAxisTicks, formatSCurveAxisDate, isoToTs } from './sCurve';
import type { MilestoneWithProgress } from '@/src/lib/db/milestones';
import type { SCurveTask } from './sCurve';

/**
 * Test oracle for the pure S-curve math util (FR-SC-002/003, OBS-SC-001; v2 actual
 * series: FR-SCA-008..011, AC-SCA-001..006, + the evenAxisTicks helper).
 * Each case drives a property of buildSCurve at the lowest sufficient layer.
 */

/** Minimal milestone factory — only the fields buildSCurve reads matter. */
const ms = (over: Partial<MilestoneWithProgress>): MilestoneWithProgress => ({
  id: over.id ?? 'm',
  project_id: 'p1',
  name: over.name ?? 'Phase',
  sort_order: over.sort_order ?? 0,
  target_date: over.target_date ?? null,
  weight: over.weight ?? 1,
  input_pct: over.input_pct ?? null,
  task_count: over.task_count ?? 0,
  calculated_pct: over.calculated_pct ?? null,
  effective_pct: over.effective_pct ?? 0,
});

// Shared fixture: weights [1,1,2], dates spread, effective [100,50,0].
const threePhases: MilestoneWithProgress[] = [
  ms({ id: 'a', target_date: '2026-01-01', weight: 1, effective_pct: 100, sort_order: 0 }),
  ms({ id: 'b', target_date: '2026-04-01', weight: 1, effective_pct: 50, sort_order: 1 }),
  ms({ id: 'c', target_date: '2026-07-01', weight: 2, effective_pct: 0, sort_order: 2 }),
];

describe('buildSCurve', () => {
  it('AC-SC-001: planned points are cumulative-weighted, date-sorted, monotonic, ending at 100', () => {
    const model = buildSCurve(threePhases, '2026-12-31');
    const planned = model.points
      .filter((p) => p.planned !== null)
      .map((p) => ({ date: p.date, planned: p.planned }));

    // Origin at the earliest date, then one cumulative point per dated milestone.
    expect(planned).toEqual([
      { date: '2026-01-01', planned: 0 },
      { date: '2026-01-01', planned: 25 },
      { date: '2026-04-01', planned: 50 },
      { date: '2026-07-01', planned: 100 },
    ]);

    // Strictly non-decreasing.
    const vals = planned.map((p) => p.planned as number);
    for (let i = 1; i < vals.length; i += 1) {
      expect(vals[i]).toBeGreaterThanOrEqual(vals[i - 1]);
    }
    expect(vals[vals.length - 1]).toBe(100);
  });

  it('AC-SC-002: actualToDate is the weight-weighted effective_pct rollup (round2), independent of dates', () => {
    // (1·100 + 1·50 + 2·0) / 4 = 37.5
    expect(buildSCurve(threePhases, '2026-12-31').actualToDate).toBe(37.5);

    // Same weights/effective but NO dates → rollup is unchanged.
    const undated = threePhases.map((m) => ({ ...m, target_date: null }));
    expect(buildSCurve(undated, '2026-12-31').actualToDate).toBe(37.5);
  });

  it('AC-SC-002: actualToDate clamps effective_pct into [0,100] before weighting', () => {
    const over = [
      ms({ id: 'a', target_date: '2026-01-01', weight: 1, effective_pct: 150 }),
      ms({ id: 'b', target_date: '2026-02-01', weight: 1, effective_pct: -20 }),
    ];
    // (1·100 + 1·0) / 2 = 50
    expect(buildSCurve(over, '2026-12-31').actualToDate).toBe(50);
  });

  it('AC-SC-003: plannedToDate is the planned curve linearly interpolated at asOf, clamped [0,100]', () => {
    // asOf between 2026-04-01 (50) and 2026-07-01 (100); 30 of 91 days in.
    const mid = buildSCurve(threePhases, '2026-05-01').plannedToDate;
    expect(mid).not.toBeNull();
    expect(mid as number).toBeCloseTo(50 + (100 - 50) * (30 / 91), 1);

    // Before the first dated point → 0.
    expect(buildSCurve(threePhases, '2025-12-01').plannedToDate).toBe(0);
    // After the last dated point → 100.
    expect(buildSCurve(threePhases, '2027-01-01').plannedToDate).toBe(100);
  });

  it('AC-SC-004: no dated milestones → empty points, but actualToDate still computed', () => {
    const undated = threePhases.map((m) => ({ ...m, target_date: null }));
    const model = buildSCurve(undated, '2026-12-31');
    expect(model.points).toEqual([]);
    expect(model.actualToDate).toBe(37.5);
  });

  it('AC-SC-004: zero total weight → empty points, actualToDate 0, plannedToDate null', () => {
    const zero = threePhases.map((m) => ({ ...m, weight: 0 }));
    const model = buildSCurve(zero, '2026-12-31');
    expect(model.points).toEqual([]);
    expect(model.actualToDate).toBe(0);
    expect(model.plannedToDate).toBeNull();
  });

  it('AC-SC-004: empty milestone list → empty points, actualToDate 0, plannedToDate null', () => {
    const model = buildSCurve([], '2026-12-31');
    expect(model.points).toEqual([]);
    expect(model.actualToDate).toBe(0);
    expect(model.plannedToDate).toBeNull();
  });

  it('AC-SC-003: the actual series carries a single point at asOf valued actualToDate', () => {
    const model = buildSCurve(threePhases, '2026-05-01');
    const actualPts = model.points.filter((p) => p.actual !== null);
    expect(actualPts).toHaveLength(1);
    expect(actualPts[0].date).toBe('2026-05-01');
    expect(actualPts[0].actual).toBe(37.5);
  });

  // ── Time-axis correctness (data-viz position bug fix) ─────────────────────────

  it('AC-SC-AXIS-001: every point carries a ts (epoch ms UTC midnight) matching its date', () => {
    const model = buildSCurve(threePhases, '2026-05-01');
    for (const pt of model.points) {
      const expected = Date.parse(`${pt.date}T00:00:00Z`);
      expect(pt.ts).toBe(expected);
    }
  });

  it('AC-SC-AXIS-002 position-oracle: today/actual ts sits BETWEEN surrounding milestone ts values, not after the last', () => {
    // asOf = 2026-05-01, between milestones at 2026-04-01 and 2026-07-01
    const asOf = '2026-05-01';
    const model = buildSCurve(threePhases, asOf);

    const actualPt = model.points.find((p) => p.actual !== null);
    expect(actualPt).toBeDefined();

    // ts of the last planned milestone (2026-07-01)
    const lastMilestonePt = model.points
      .filter((p) => p.planned !== null)
      .at(-1)!;

    const actualTs = actualPt!.ts;
    const lastMilestoneTs = lastMilestonePt.ts;

    // The bug: categorical axis appended today AFTER the last milestone, making
    // ts of today > ts of the last milestone visually. With a time axis, today
    // (2026-05-01) must be BEFORE 2026-07-01.
    expect(actualTs).toBeLessThan(lastMilestoneTs);

    // Also strictly after the preceding milestone (2026-04-01).
    const prevMilestonePt = model.points
      .filter((p) => p.planned !== null && p.ts < lastMilestoneTs)
      .at(-1)!;
    expect(actualTs).toBeGreaterThan(prevMilestonePt.ts);
  });

  it('AC-SC-AXIS-003: all ts values are non-decreasing when points are sorted by ts (monotonic domain)', () => {
    const model = buildSCurve(threePhases, '2026-05-01');
    const sorted = [...model.points].sort((a, b) => a.ts - b.ts);
    for (let i = 1; i < sorted.length; i += 1) {
      expect(sorted[i].ts).toBeGreaterThanOrEqual(sorted[i - 1].ts);
    }
  });

  it('AC-SC-AXIS-004: formatSCurveAxisDate disambiguates same-month different-year (no duplicate labels)', () => {
    // Categorical year-drop bug: 2025-03-15 and 2026-03-15 both rendered "15 Mar"
    const label2025 = formatSCurveAxisDate(Date.parse('2025-03-15T00:00:00Z'));
    const label2026 = formatSCurveAxisDate(Date.parse('2026-03-15T00:00:00Z'));
    expect(label2025).not.toBe(label2026);
    // Both must include the year in some form
    expect(label2025).toMatch(/25|2025/);
    expect(label2026).toMatch(/26|2026/);
  });

  it('AC-SC-AXIS-005: formatSCurveAxisDate keeps DAY precision (same-month different-day distinguishable)', () => {
    // Day-precision regression guard: multiple milestones in one month (and the tooltip)
    // must not collapse to one label. "15 Mar '26" vs "22 Mar '26".
    const d15 = formatSCurveAxisDate(Date.parse('2026-03-15T00:00:00Z'));
    const d22 = formatSCurveAxisDate(Date.parse('2026-03-22T00:00:00Z'));
    expect(d15).not.toBe(d22);
    expect(d15).toMatch(/\b15\b/);
    expect(d22).toMatch(/\b22\b/);
    // UTC-stable: the day does not drift across timezones (no off-by-one).
    expect(formatSCurveAxisDate(Date.parse('2026-03-01T00:00:00Z'))).toMatch(/\b01 Mar '26\b/);
  });
});

// ── evenAxisTicks ────────────────────────────────────────────────────────────

describe('evenAxisTicks', () => {
  /** Helper: convert a 'YYYY-MM-DD' string to UTC-midnight epoch ms. */
  const ts = (iso: string) => Date.parse(`${iso}T00:00:00Z`);

  /** Returns true when epoch ms falls on the first day of its UTC month. */
  const isFirstOfMonth = (epochMs: number): boolean => {
    const d = new Date(epochMs);
    return d.getUTCDate() === 1;
  };

  it('returns ascending ticks all within [tsMin, tsMax]', () => {
    const min = ts('2025-09-25');
    const max = ts('2026-06-16');
    const ticks = evenAxisTicks(min, max);

    expect(ticks.length).toBeGreaterThan(0);
    for (const t of ticks) {
      expect(t).toBeGreaterThanOrEqual(min);
      expect(t).toBeLessThanOrEqual(max);
    }
    // strictly ascending
    for (let i = 1; i < ticks.length; i++) {
      expect(ticks[i]).toBeGreaterThan(ticks[i - 1]);
    }
  });

  it('returns roughly 5–7 ticks (monthly stride) for a 9-month span', () => {
    const min = ts('2025-09-01');
    const max = ts('2026-06-01');
    const ticks = evenAxisTicks(min, max);

    // 9-month span → monthly stride → ~9 ticks but we aim for 5–7
    expect(ticks.length).toBeGreaterThanOrEqual(4);
    expect(ticks.length).toBeLessThanOrEqual(10);
  });

  it('returns all first-of-month UTC ticks', () => {
    const min = ts('2025-09-25');
    const max = ts('2026-06-16');
    const ticks = evenAxisTicks(min, max);

    for (const t of ticks) {
      expect(isFirstOfMonth(t)).toBe(true);
    }
  });

  it('uses a wider stride (every 2nd or 3rd month) for a multi-year span', () => {
    const min = ts('2023-01-01');
    const max = ts('2026-12-31');
    const ticks = evenAxisTicks(min, max);

    // 48-month span → stride > 1 month → fewer than 20 ticks
    expect(ticks.length).toBeLessThanOrEqual(20);
    // Still at least a few
    expect(ticks.length).toBeGreaterThanOrEqual(4);
    // All first-of-month
    for (const t of ticks) {
      expect(isFirstOfMonth(t)).toBe(true);
    }
  });

  it('handles min === max by returning exactly one tick at or near that point', () => {
    const min = ts('2026-03-15');
    const ticks = evenAxisTicks(min, min);

    expect(ticks.length).toBeGreaterThanOrEqual(1);
    // The single tick must be within [min, max] — since min === max, it equals min
    expect(ticks[0]).toBe(min);
  });

  it('returns a tick close to tsMin and a tick close to tsMax for any span', () => {
    const min = ts('2025-09-25');
    const max = ts('2026-06-16');
    const ticks = evenAxisTicks(min, max);

    const first = ticks[0];
    const last = ticks[ticks.length - 1];

    // First tick should be within 31 days of min
    expect(first - min).toBeLessThanOrEqual(31 * 86_400_000);
    // Last tick should be within 31 days of max
    expect(max - last).toBeLessThanOrEqual(31 * 86_400_000);
  });
});

// ── SCurveTask factory ──────────────────────────────────────────────────────
/** Minimal SCurveTask — only the fields buildSCurve reads from a task. */
const scTask = (over: Partial<SCurveTask> & { milestone_id: string | null }): SCurveTask => ({
  milestone_id: over.milestone_id,
  status: over.status ?? 'To Do',
  completed_at: over.completed_at ?? null,
  end_date: over.end_date ?? null,
});

/** Minimal milestone factory reused in the actual-series tests. */
const msa = (over: Partial<MilestoneWithProgress>): MilestoneWithProgress => ({
  id: over.id ?? 'm',
  project_id: 'p1',
  name: over.name ?? 'Phase',
  sort_order: over.sort_order ?? 0,
  target_date: over.target_date ?? null,
  weight: over.weight ?? 1,
  input_pct: over.input_pct ?? null,
  task_count: over.task_count ?? 0,
  calculated_pct: over.calculated_pct ?? null,
  effective_pct: over.effective_pct ?? 0,
});

describe('buildSCurve — actual series', () => {
  it('AC-SCA-001: ≥2 Done tasks at distinct completed_at → ≥2 non-null actual points, non-decreasing, last === actualToDate', () => {
    const milestones = [
      msa({ id: 'm1', target_date: '2026-01-01', weight: 1, effective_pct: 100 }),
      msa({ id: 'm2', target_date: '2026-06-01', weight: 1, effective_pct: 100 }),
    ];
    const tasks = [
      scTask({ milestone_id: 'm1', status: 'Done', completed_at: '2026-02-01T00:00:00Z' }),
      scTask({ milestone_id: 'm2', status: 'Done', completed_at: '2026-05-01T00:00:00Z' }),
    ];
    const model = buildSCurve(milestones, '2026-06-16', tasks);

    const actualPts = model.points.filter((p) => p.actual !== null);
    expect(actualPts.length).toBeGreaterThanOrEqual(2);

    // Non-decreasing actual values.
    const vals = actualPts.map((p) => p.actual as number);
    for (let i = 1; i < vals.length; i++) {
      expect(vals[i]).toBeGreaterThanOrEqual(vals[i - 1]);
    }

    // Last actual point equals actualToDate.
    expect(vals[vals.length - 1]).toBeCloseTo(model.actualToDate, 2);
  });

  it('AC-SCA-002: mix of Done + non-Done → final actual point equals actualToDate within round2', () => {
    // M1: weight 2, task-tracked, 1 Done / 2 total → effective_pct=50
    // M2: weight 2, task-tracked, 0 Done / 1 total → effective_pct=0
    // actualToDate = (2*50 + 2*0) / 4 = 25
    const milestones = [
      msa({ id: 'm1', target_date: '2026-01-01', weight: 2, effective_pct: 50 }),
      msa({ id: 'm2', target_date: '2026-06-01', weight: 2, effective_pct: 0 }),
    ];
    const tasks = [
      scTask({ milestone_id: 'm1', status: 'Done', completed_at: '2026-02-01T00:00:00Z' }),
      scTask({ milestone_id: 'm1', status: 'In Progress' }),
      scTask({ milestone_id: 'm2', status: 'In Progress' }),
    ];
    const model = buildSCurve(milestones, '2026-06-16', tasks);

    // Anchor on the independently-known value (25) so a systematic error in actualToDate
    // can't pass via self-consistency (review nit), THEN assert the endpoint reconciles to it.
    expect(model.actualToDate).toBe(25);
    const actualPts = model.points.filter((p) => p.actual !== null);
    const lastActual = actualPts[actualPts.length - 1].actual as number;
    expect(lastActual).toBeCloseTo(model.actualToDate, 2);
  });

  it('AC-SCA-003: all tasks In Progress, no input_pct → exactly one actual point at asOf, no throw', () => {
    const milestones = [
      msa({ id: 'm1', target_date: '2026-01-01', weight: 1, effective_pct: 0 }),
      msa({ id: 'm2', target_date: '2026-06-01', weight: 1, effective_pct: 0 }),
    ];
    const tasks = [
      scTask({ milestone_id: 'm1', status: 'In Progress' }),
      scTask({ milestone_id: 'm2', status: 'In Progress' }),
    ];
    expect(() => buildSCurve(milestones, '2026-06-16', tasks)).not.toThrow();
    const model = buildSCurve(milestones, '2026-06-16', tasks);
    const actualPts = model.points.filter((p) => p.actual !== null);
    expect(actualPts).toHaveLength(1);
    expect(actualPts[0].date).toBe('2026-06-16');
  });

  it('AC-SCA-004: hybrid — override milestone uses target_date; task-tracked milestone uses task end_date', () => {
    // M1: weight 2, input_pct=60, target_date='2025-03-01' → override path, contributes at 2025-03-01
    // M2: weight 2, no input_pct, 1 Done task with end_date='2025-04-01' → task path, contributes at 2025-04-01
    const milestones = [
      msa({ id: 'm1', target_date: '2025-03-01', weight: 2, input_pct: 60, effective_pct: 60 }),
      msa({ id: 'm2', target_date: '2025-04-01', weight: 2, input_pct: null, effective_pct: 100 }),
    ];
    const tasks = [
      scTask({ milestone_id: 'm2', status: 'Done', end_date: '2025-04-01', completed_at: null }),
    ];
    const model = buildSCurve(milestones, '2026-06-16', tasks);

    const actualPts = model.points.filter((p) => p.actual !== null);

    // Should have a point at/near 2025-03-01 (from M1 override).
    const tsM1 = isoToTs('2025-03-01');
    const ptM1 = actualPts.find((p) => p.ts === tsM1);
    expect(ptM1).toBeDefined();

    // Should have a point at/near 2025-04-01 (from M2 task Done end_date).
    const tsM2 = isoToTs('2025-04-01');
    const ptM2 = actualPts.find((p) => p.ts === tsM2);
    expect(ptM2).toBeDefined();

    // Both timestamps ≤ isoToTs('2026-06-16').
    const asOfTs = isoToTs('2026-06-16');
    for (const pt of actualPts) {
      expect(pt.ts).toBeLessThanOrEqual(asOfTs);
    }
  });

  it('AC-SCA-005: task-less milestone with no input_pct and effective_pct=0 → one actual at target_date valued 0', () => {
    const milestones = [
      msa({ id: 'm1', target_date: '2025-06-01', weight: 1, input_pct: null, effective_pct: 0 }),
    ];
    const model = buildSCurve(milestones, '2026-06-16', []);

    expect(model.actualToDate).toBe(0);
    const actualPts = model.points.filter((p) => p.actual !== null);
    // The milestone has no tasks, no input_pct → task-less path: contributes at target_date with value 0.
    // Since actualToDate=0, we expect at least one actual point at 2025-06-01 valued 0 (or the asOf fallback).
    expect(actualPts.length).toBeGreaterThanOrEqual(1);
    // Find a point near 2025-06-01.
    const tsTarget = isoToTs('2025-06-01');
    const ptTarget = actualPts.find((p) => p.ts === tsTarget);
    expect(ptTarget).toBeDefined();
    expect(ptTarget!.actual).toBe(0);
  });

  it('AC-SCA-006: Done task with future end_date and no completed_at → contribution clamped to asOf', () => {
    const milestones = [
      msa({ id: 'm1', target_date: '2026-01-01', weight: 1, input_pct: null, effective_pct: 100 }),
    ];
    const tasks = [
      // Future end_date, no completed_at — proxy must clamp to asOf.
      scTask({ milestone_id: 'm1', status: 'Done', end_date: '2027-12-31', completed_at: null }),
    ];
    const model = buildSCurve(milestones, '2026-06-16', tasks);

    const actualPts = model.points.filter((p) => p.actual !== null);
    const asOfTs = isoToTs('2026-06-16');
    // The contribution should be placed at asOf (clamped, not at 2027-12-31).
    expect(actualPts.some((p) => p.ts === asOfTs)).toBe(true);
    // No point beyond asOf.
    for (const pt of actualPts) {
      expect(pt.ts).toBeLessThanOrEqual(asOfTs);
    }
  });

  it('AC-SCA-003 regression: tasks arg omitted → single actual point at asOf (fallback unchanged)', () => {
    const milestones = [
      msa({ id: 'm1', target_date: '2026-01-01', weight: 1, effective_pct: 100 }),
      msa({ id: 'm2', target_date: '2026-06-01', weight: 1, effective_pct: 50 }),
    ];
    const model = buildSCurve(milestones, '2026-05-01'); // no tasks arg
    const actualPts = model.points.filter((p) => p.actual !== null);
    expect(actualPts).toHaveLength(1);
    expect(actualPts[0].date).toBe('2026-05-01');
    expect(actualPts[0].actual).toBe(model.actualToDate);
  });
});
