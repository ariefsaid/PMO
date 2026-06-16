/**
 * Unit tests for buildGanttModel (ganttLayout.ts).
 * All ACs at this layer (ADR-0010): AC-GANTT-001, 002, 003, 004, 006.
 */
import { describe, it, expect } from 'vitest';
import { buildGanttModel, type GanttLayoutConfig } from '../ganttLayout';
import type { TaskWithRefs } from '@/src/lib/db/tasks';
import type { MilestoneWithProgress } from '@/src/lib/db/milestones';

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeTask(
  overrides: Partial<TaskWithRefs> & { id: string; name: string },
): TaskWithRefs {
  return {
    org_id: 'org-1',
    project_id: 'p1',
    status: 'To Do',
    assignee_id: null,
    milestone_id: null,
    created_at: '2026-01-01T00:00:00Z',
    assignee: null,
    dependencies: [],
    start_date: null,
    end_date: null,
    ...overrides,
  };
}

function makeMilestone(
  overrides: Partial<MilestoneWithProgress> & { id: string; name: string },
): MilestoneWithProgress {
  return {
    project_id: 'p1',
    sort_order: 0,
    target_date: null,
    weight: 10,
    input_pct: null,
    task_count: 0,
    calculated_pct: null,
    effective_pct: 0,
    ...overrides,
  };
}

const EPS = 1e-9;

// ── AC-GANTT-001: bar positioning ────────────────────────────────────────────

describe('AC-GANTT-001: tasks with start+end become proportional bars', () => {
  it('positions two bars over a 10-day span with correct left/width fractions', () => {
    /**
     * Span: 2026-01-01 .. 2026-01-11 (10 days).
     * Task A: 2026-01-01 .. 2026-01-11 → left 0, width 1.
     * Task B: 2026-01-06 .. 2026-01-11 → left 0.5, width 0.5.
     */
    const tasks: TaskWithRefs[] = [
      makeTask({ id: 'a', name: 'Task A', start_date: '2026-01-01', end_date: '2026-01-11' }),
      makeTask({ id: 'b', name: 'Task B', start_date: '2026-01-06', end_date: '2026-01-11' }),
    ];
    const model = buildGanttModel(tasks, [], '2026-01-05');

    expect(model.isEmpty).toBe(false);
    expect(model.span).toEqual({ startIso: '2026-01-01', endIso: '2026-01-11' });

    // Collect all bars from all lanes
    const bars = model.lanes.flatMap((l) => l.bars);
    const barA = bars.find((b) => b.id === 'a')!;
    const barB = bars.find((b) => b.id === 'b')!;

    expect(barA).toBeDefined();
    expect(barA.kind).toBe('bar');
    expect(barA.left).toBeCloseTo(0, 9);
    expect(barA.width).toBeCloseTo(1, 9);

    expect(barB).toBeDefined();
    expect(barB.kind).toBe('bar');
    expect(barB.left).toBeCloseTo(0.5, 9);
    expect(barB.width).toBeCloseTo(0.5, 9);
  });

  it('returns isEmpty true when no tasks and no milestones', () => {
    const model = buildGanttModel([], [], '2026-01-01');
    expect(model.isEmpty).toBe(true);
    expect(model.span).toBeNull();
    expect(model.lanes.every((l) => l.bars.length === 0)).toBe(true);
  });
});

// ── AC-GANTT-002: milestone markers ──────────────────────────────────────────

describe('AC-GANTT-002: dated milestone yields a positioned marker', () => {
  it('places a milestone marker at the correct fraction', () => {
    /**
     * Span comes from the task dates (2026-01-01..2026-01-11, 10 days).
     * Milestone target_date = 2026-01-06 → fraction 0.5.
     */
    const tasks: TaskWithRefs[] = [
      makeTask({ id: 'a', name: 'Task A', start_date: '2026-01-01', end_date: '2026-01-11', milestone_id: 'ms1' }),
    ];
    const milestones: MilestoneWithProgress[] = [
      makeMilestone({ id: 'ms1', name: 'Phase 1', target_date: '2026-01-06', sort_order: 0 }),
    ];

    const model = buildGanttModel(tasks, milestones, '2026-01-03');

    const lane = model.lanes.find((l) => l.milestoneId === 'ms1');
    expect(lane).toBeDefined();
    expect(lane!.marker).not.toBeNull();
    expect(lane!.marker!.left).toBeCloseTo(0.5, 9);
    expect(lane!.marker!.name).toBe('Phase 1');
  });

  it('puts a task with no milestone_id in the Ungrouped lane', () => {
    const tasks: TaskWithRefs[] = [
      makeTask({ id: 'a', name: 'Ungrouped', start_date: '2026-01-01', end_date: '2026-01-11' }),
    ];
    const milestones: MilestoneWithProgress[] = [
      makeMilestone({ id: 'ms1', name: 'Phase 1', target_date: null, sort_order: 0 }),
    ];

    const model = buildGanttModel(tasks, milestones, '2026-01-05');
    const ungrouped = model.lanes.find((l) => l.milestoneId === null);
    expect(ungrouped).toBeDefined();
    expect(ungrouped!.bars.find((b) => b.id === 'a')).toBeDefined();
  });
});

// ── AC-GANTT-003: today line ──────────────────────────────────────────────────
//
// Drift fix (round-2): when today falls OUTSIDE the data span, the today line was
// clamped off-canvas and invisible. The fix extends spanStart/spanEnd to always
// include today, so the line always renders at its true proportion.

describe('AC-GANTT-003: today line always renders — span is extended to include today', () => {
  const tasks: TaskWithRefs[] = [
    makeTask({ id: 'a', name: 'Task A', start_date: '2026-01-01', end_date: '2026-01-11' }),
  ];

  it('todayLeft is the correct fraction when today is inside the span', () => {
    // today = 2026-01-06 → 5 days into a 10-day span → 0.5
    const model = buildGanttModel(tasks, [], '2026-01-06');
    expect(model.todayLeft).not.toBeNull();
    expect(model.todayLeft!).toBeCloseTo(0.5, 9);
  });

  it('AC-GANTT-TODAY-BEFORE: todayLeft is not null when today is BEFORE the data span (span extends left)', () => {
    // today = 2025-12-01, data span 2026-01-01..2026-01-11.
    // After fix: spanStart = 2025-12-01, spanEnd = 2026-01-11.
    // todayLeft = 0 (at left edge of the expanded axis).
    const model = buildGanttModel(tasks, [], '2025-12-01');
    expect(model.todayLeft).not.toBeNull();
    expect(model.todayLeft!).toBeCloseTo(0, 9);
    // Data bars must still be positioned further right (not clamped off-canvas)
    const bars = model.lanes.flatMap((l) => l.bars);
    const barA = bars.find((b) => b.id === 'a')!;
    expect(barA.left).toBeGreaterThan(0);
  });

  it('AC-GANTT-TODAY-AFTER: todayLeft is not null when today is AFTER the data span (span extends right)', () => {
    // today = 2026-02-01, data span 2026-01-01..2026-01-11.
    // After fix: spanStart = 2026-01-01, spanEnd = 2026-02-01.
    // todayLeft = 1 (at right edge of the expanded axis).
    const model = buildGanttModel(tasks, [], '2026-02-01');
    expect(model.todayLeft).not.toBeNull();
    expect(model.todayLeft!).toBeCloseTo(1, 9);
    // Data bars must end before the right edge (Task A ends before today)
    const bars = model.lanes.flatMap((l) => l.bars);
    const barA = bars.find((b) => b.id === 'a')!;
    expect(barA.left + barA.width).toBeLessThan(1);
  });

  it('AC-GANTT-TODAY-WITHIN: todayLeft is 0.5 when today is exactly mid-span', () => {
    const model = buildGanttModel(tasks, [], '2026-01-06');
    expect(model.todayLeft).not.toBeNull();
    expect(model.todayLeft!).toBeCloseTo(0.5, 9);
  });
});

// ── AC-GANTT-004: points + undated ────────────────────────────────────────────

describe('AC-GANTT-004: one-sided dates become points; no-date tasks land in undated', () => {
  it('a task with only end_date is kind:point with width:0', () => {
    const tasks: TaskWithRefs[] = [
      makeTask({ id: 'a', name: 'Due only', end_date: '2026-01-06', start_date: null }),
      // another dated task to ensure a span exists
      makeTask({ id: 'b', name: 'Both', start_date: '2026-01-01', end_date: '2026-01-11' }),
    ];
    const model = buildGanttModel(tasks, [], '2026-01-05');
    const bars = model.lanes.flatMap((l) => l.bars);
    const pointBar = bars.find((b) => b.id === 'a')!;
    expect(pointBar).toBeDefined();
    expect(pointBar.kind).toBe('point');
    expect(pointBar.width).toBeCloseTo(0, 9);
  });

  it('a task with only start_date is kind:point with width:0', () => {
    const tasks: TaskWithRefs[] = [
      makeTask({ id: 'a', name: 'Start only', start_date: '2026-01-06', end_date: null }),
      makeTask({ id: 'b', name: 'Both', start_date: '2026-01-01', end_date: '2026-01-11' }),
    ];
    const model = buildGanttModel(tasks, [], '2026-01-05');
    const bars = model.lanes.flatMap((l) => l.bars);
    const pointBar = bars.find((b) => b.id === 'a')!;
    expect(pointBar).toBeDefined();
    expect(pointBar.kind).toBe('point');
    expect(pointBar.width).toBeCloseTo(0, 9);
  });

  it('a task with no dates lands in undated and not in any lane', () => {
    const tasks: TaskWithRefs[] = [
      makeTask({ id: 'a', name: 'No dates' }),
      makeTask({ id: 'b', name: 'Both', start_date: '2026-01-01', end_date: '2026-01-11' }),
    ];
    const model = buildGanttModel(tasks, [], '2026-01-05');
    expect(model.undated.find((u) => u.id === 'a')).toBeDefined();
    const bars = model.lanes.flatMap((l) => l.bars);
    expect(bars.find((b) => b.id === 'a')).toBeUndefined();
  });

  it('isEmpty is true when all tasks have no dates and no milestones are dated', () => {
    const tasks: TaskWithRefs[] = [
      makeTask({ id: 'a', name: 'No dates A' }),
      makeTask({ id: 'b', name: 'No dates B' }),
    ];
    const model = buildGanttModel(tasks, [], '2026-01-01');
    expect(model.isEmpty).toBe(true);
    expect(model.undated.length).toBe(2);
  });
});

// ── AC-GANTT-006: milestone-grouped lanes ─────────────────────────────────────

describe('AC-GANTT-006: bars appear under milestone lanes ordered by sort_order with Ungrouped last', () => {
  it('orders milestone lanes by sort_order then name, Ungrouped last', () => {
    const tasks: TaskWithRefs[] = [
      makeTask({ id: 'u', name: 'Ungrouped task', start_date: '2026-01-01', end_date: '2026-01-11', milestone_id: null }),
      makeTask({ id: 'b', name: 'B task', start_date: '2026-01-01', end_date: '2026-01-11', milestone_id: 'ms2' }),
      makeTask({ id: 'a', name: 'A task', start_date: '2026-01-01', end_date: '2026-01-11', milestone_id: 'ms1' }),
    ];
    const milestones: MilestoneWithProgress[] = [
      makeMilestone({ id: 'ms1', name: 'Alpha', sort_order: 2 }),
      makeMilestone({ id: 'ms2', name: 'Beta', sort_order: 1 }),
    ];

    const model = buildGanttModel(tasks, milestones, '2026-01-05');

    // Lanes should be: Beta (sort_order 1), Alpha (sort_order 2), then Ungrouped
    const milestoneIds = model.lanes.map((l) => l.milestoneId);
    const betaIdx = milestoneIds.indexOf('ms2');
    const alphaIdx = milestoneIds.indexOf('ms1');
    const ungroupedIdx = milestoneIds.indexOf(null);

    expect(betaIdx).toBeLessThan(alphaIdx);
    expect(alphaIdx).toBeLessThan(ungroupedIdx);
    expect(ungroupedIdx).toBe(model.lanes.length - 1);
  });

  it('places tasks under the correct milestone lane', () => {
    const tasks: TaskWithRefs[] = [
      makeTask({ id: 'a', name: 'A task', start_date: '2026-01-01', end_date: '2026-01-11', milestone_id: 'ms1' }),
    ];
    const milestones: MilestoneWithProgress[] = [
      makeMilestone({ id: 'ms1', name: 'Phase 1', sort_order: 0 }),
    ];

    const model = buildGanttModel(tasks, milestones, '2026-01-05');
    const lane = model.lanes.find((l) => l.milestoneId === 'ms1');
    expect(lane!.bars.find((b) => b.id === 'a')).toBeDefined();
  });

  it('dependsOnCount reflects the number of dependency edges', () => {
    const tasks: TaskWithRefs[] = [
      makeTask({
        id: 'a',
        name: 'Task with deps',
        start_date: '2026-01-01',
        end_date: '2026-01-11',
        dependencies: [{ depends_on_id: 'x' }, { depends_on_id: 'y' }],
      }),
    ];
    const model = buildGanttModel(tasks, [], '2026-01-05');
    const bars = model.lanes.flatMap((l) => l.bars);
    expect(bars.find((b) => b.id === 'a')!.dependsOnCount).toBe(2);
  });
});

// ── AC-GANTT-011: pixel geometry ──────────────────────────────────────────────

const MONTH_CFG: GanttLayoutConfig = {
  scale: 'month',
  rowHeight: 40,
  laneHeaderHeight: 36,
  axisHeight: 32,
};

describe('AC-GANTT-011: pixel geometry (config yields absolute px boxes)', () => {
  it('AC-GANTT-011: config yields px geometry with correct contentWidth and bar boxes', () => {
    // Span 2026-01-01..2026-01-11 (10 days). month scale → 6px/day.
    // Task A: full span → xStart 0, xEnd 60. Task B: 2026-01-06..2026-01-11 → xStart 30, xEnd 60.
    const tasks: TaskWithRefs[] = [
      makeTask({ id: 'a', name: 'Task A', start_date: '2026-01-01', end_date: '2026-01-11' }),
      makeTask({ id: 'b', name: 'Task B', start_date: '2026-01-06', end_date: '2026-01-11' }),
    ];
    const model = buildGanttModel(tasks, [], '2026-01-05', MONTH_CFG);

    expect(model.geometry).not.toBeNull();
    const geo = model.geometry!;
    expect(geo.pxPerDay).toBe(6);
    expect(geo.contentWidth).toBeCloseTo(10 * 6, 6); // 60

    const boxA = geo.bars.find((b) => b.id === 'a')!;
    const boxB = geo.bars.find((b) => b.id === 'b')!;
    expect(boxA).toBeDefined();
    expect(boxA.xStart).toBeCloseTo(0, 6);
    expect(boxA.xEnd).toBeCloseTo(60, 6);
    expect(boxB.xStart).toBeCloseTo(30, 6);
    expect(boxB.xEnd).toBeCloseTo(60, 6);
    // Each bar has a positive row height and a distinct y.
    expect(boxA.h).toBeGreaterThan(0);
    expect(boxB.y).toBeGreaterThan(boxA.y);
  });

  it('AC-GANTT-011: omitting config keeps geometry null (v1 back-compat)', () => {
    const tasks: TaskWithRefs[] = [
      makeTask({ id: 'a', name: 'Task A', start_date: '2026-01-01', end_date: '2026-01-11' }),
      makeTask({ id: 'b', name: 'Task B', start_date: '2026-01-06', end_date: '2026-01-11' }),
    ];
    const withCfg = buildGanttModel(tasks, [], '2026-01-05', MONTH_CFG);
    const noCfg = buildGanttModel(tasks, [], '2026-01-05');
    expect(noCfg.geometry).toBeNull();
    // The v1 fraction lanes are identical whether or not a config is passed.
    expect(noCfg.lanes).toEqual(withCfg.lanes);
    expect(noCfg.span).toEqual(withCfg.span);
    expect(noCfg.ticks).toEqual(withCfg.ticks);
  });
});

// ── Axis ticks ────────────────────────────────────────────────────────────────

describe('axis ticks', () => {
  it('generates month-boundary ticks within the span', () => {
    const tasks: TaskWithRefs[] = [
      makeTask({ id: 'a', name: 'Long task', start_date: '2026-01-01', end_date: '2026-03-31' }),
    ];
    const model = buildGanttModel(tasks, [], '2026-02-15');
    // Should have at least Jan, Feb, Mar tick labels
    const labels = model.ticks.map((t) => t.label);
    expect(labels.some((l) => l.includes('Jan'))).toBe(true);
    expect(labels.some((l) => l.includes('Feb') || l.includes('Mar'))).toBe(true);
    // All fractions should be in [0,1]
    for (const tick of model.ticks) {
      expect(tick.left).toBeGreaterThanOrEqual(0 - EPS);
      expect(tick.left).toBeLessThanOrEqual(1 + EPS);
    }
  });
});
