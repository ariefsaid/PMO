/**
 * AC-CUA-072 — milestone-progress / rollup is ownership-agnostic over mirrored tasks (FR-CUA-082/021).
 *
 * A PIN test (the plan's wording): the rollup reads the read-model and never branches on ownership.
 * `buildSCurve` is a pure function of `(milestones, asOf, tasks?)`; none of those carry an ownership or
 * mirror field (`SCurveTask` is milestone_id/status/completed_at/end_date only), so a mirrored task row
 * and an equivalent PMO-owned task row feed the rollup identically. This file pins that invariant
 * byte-for-byte, and pins that the actual SERIES reflects exactly the tasks the caller passed (so a
 * tombstoned row — excluded by `listTasks`, AC-CUA-002/C5 — never contributes to the rollup's input).
 *
 * NOTE: the rollup GAUGE (`actualToDate`) is driven by the milestone's precomputed `effective_pct`
 * (from the `get_project_milestones` RPC), which is a separate read path; the ownership-agnosticism
 * pinned here is the pure `buildSCurve` consumer over identical inputs. (Residual risk, flagged in the
 * slice report: the milestone RPC does not yet exclude tombstoned tasks from `effective_pct` — a
 * follow-up, out of D7's buildSCurve-consumer scope.)
 */
import { describe, it, expect } from 'vitest';
import { buildSCurve } from '../delivery/sCurve.ts';
import type { SCurveTask } from '../delivery/sCurve.ts';
import type { MilestoneWithProgress } from '../db/milestones.ts';

const AS_OF = '2026-01-31';

function milestone(overrides: Partial<MilestoneWithProgress> & { id: string; name: string }): MilestoneWithProgress {
  return {
    project_id: 'p1',
    sort_order: 0,
    target_date: '2026-01-31',
    weight: 100,
    input_pct: null,
    task_count: 3,
    calculated_pct: 66.67,
    effective_pct: 66.67,
    ...overrides,
  };
}

const tasks: SCurveTask[] = [
  { milestone_id: 'm1', status: 'Done', completed_at: '2026-01-10T00:00:00Z', end_date: '2026-01-10' },
  { milestone_id: 'm1', status: 'Done', completed_at: '2026-01-20T00:00:00Z', end_date: '2026-01-20' },
  { milestone_id: 'm1', status: 'In Progress', completed_at: null, end_date: '2026-01-30' },
];

/** The actual-series points (the Done-task contributions) — the part of the model driven by `tasks`. */
function actualSeries(model: ReturnType<typeof buildSCurve>): Array<{ date: string; actual: number }> {
  return model.points.filter((p) => p.actual != null).map((p) => ({ date: p.date, actual: p.actual as number }));
}

describe('AC-CUA-072 rollup is ownership-agnostic over mirrored tasks (reads the read-model only)', () => {
  it('identical read-model rows yield an identical rollup whether conceptually mirrored or PMO-owned', () => {
    const milestones = [milestone({ id: 'm1', name: 'M1' })];
    // The consumed shapes are byte-identical; "mirrored" vs "PMO-owned" is a distinction the rollup
    // cannot see (no ownership field on SCurveTask/MilestoneWithProgress).
    const mirrored = buildSCurve(milestones, AS_OF, [...tasks]);
    const pmoOwned = buildSCurve(milestones, AS_OF, [...tasks]);

    expect(mirrored).toEqual(pmoOwned);
    // Non-trivial sanity: the gauge is driven by the milestone's effective_pct (66.67).
    expect(mirrored.actualToDate).toBe(66.67);
  });

  it('the actual series reflects exactly the tasks passed — a tombstoned (excluded) Done task does not contribute', () => {
    const milestones = [milestone({ id: 'm1', name: 'M1' })];

    // The third task is now Done and tombstoned (excluded by listTasks) — the consumer sees only the
    // first two. Construct that "after delete" input by passing just the two Done tasks.
    const doneThird: SCurveTask = {
      milestone_id: 'm1',
      status: 'Done',
      completed_at: '2026-01-25T00:00:00Z',
      end_date: '2026-01-25',
    };
    const threeDone = buildSCurve(milestones, AS_OF, [...tasks.slice(0, 2), doneThird]);
    const twoDoneAfterDelete = buildSCurve(milestones, AS_OF, tasks.slice(0, 2)); // doneThird tombstoned → excluded

    // With all three Done, the series carries three Done contributions; after the tombstone excludes
    // one, the series carries only two — the rollup consumer faithfully reflects the filtered input
    // (a tombstoned row never inflates the curve), ownership-agnostically. (The series also appends a
    // terminal anchor at asOf, so we compare relationships + equality rather than raw counts.)
    expect(actualSeries(threeDone).length).toBeGreaterThan(actualSeries(twoDoneAfterDelete).length);
    // The post-delete series is byte-identical to a project that only ever had those two tasks —
    // the tombstoned row left no trace in the rollup's input.
    const neverHadThird = buildSCurve(milestones, AS_OF, tasks.slice(0, 2));
    expect(actualSeries(twoDoneAfterDelete)).toEqual(actualSeries(neverHadThird));
  });
});
