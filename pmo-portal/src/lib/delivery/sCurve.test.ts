import { describe, it, expect } from 'vitest';
import { buildSCurve } from './sCurve';
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
});
