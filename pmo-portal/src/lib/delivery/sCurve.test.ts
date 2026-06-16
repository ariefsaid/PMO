import { describe, it, expect } from 'vitest';
import { buildSCurve, formatSCurveAxisDate } from './sCurve';
import type { MilestoneWithProgress } from '@/src/lib/db/milestones';

/**
 * Test oracle for the pure S-curve math util (FR-SC-002/003, OBS-SC-001).
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
