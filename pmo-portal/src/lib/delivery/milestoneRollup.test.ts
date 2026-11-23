import { describe, it, expect } from 'vitest';
import { groupProgress, type RollupTask } from './milestoneRollup';

// The same fixture as supabase/tests/1395_task_group_milestone_rollup.test.sql (AC-TGM-009 parity).
const task = (id: string, status: string, o: Partial<RollupTask> = {}): RollupTask => ({
  id, status, milestone_id: null, task_group_id: null, parent_task_id: null, archived_at: null, ...o,
});
const grouped = [
  task('g1', 'Done', { task_group_id: 'G1' }),
  task('g2', 'Done', { task_group_id: 'G1' }),
  task('g3', 'To Do', { task_group_id: 'G1' }),
];
const direct = [task('d1', 'Done', { milestone_id: 'M1' }), task('d2', 'To Do', { milestone_id: 'M1' })];

// A phase's own percentage is the database's (get_project_milestones, migration 1396); the screen computes only a
// group's progress here, so this file pins groupProgress (#2753).
describe('groupProgress (#2679)', () => {
  it('counts only the group\'s live top-level tasks', () => {
    const noise = [task('s', 'Done', { task_group_id: 'G1', parent_task_id: 'g1' }), task('a', 'Done', { task_group_id: 'G1', archived_at: 'x' })];
    expect(groupProgress('G1', [...grouped, ...noise, ...direct])).toEqual({ taskCount: 3, doneCount: 2, calculatedPct: (2 * 100) / 3 });
    expect(groupProgress('G9', grouped).calculatedPct).toBeNull();
  });
});
