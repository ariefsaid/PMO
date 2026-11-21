import { describe, it, expect } from 'vitest';
import { milestoneProgress, groupProgress, type RollupGroup, type RollupTask } from './milestoneRollup';

// The same fixture as supabase/tests/1395_task_group_milestone_rollup.test.sql (AC-TGM-009 parity).
const task = (id: string, status: string, o: Partial<RollupTask> = {}): RollupTask => ({
  id, status, milestone_id: null, task_group_id: null, parent_task_id: null, archived_at: null, ...o,
});
const direct = [task('d1', 'Done', { milestone_id: 'M1' }), task('d2', 'To Do', { milestone_id: 'M1' })];
const grouped = [
  task('g1', 'Done', { task_group_id: 'G1' }),
  task('g2', 'Done', { task_group_id: 'G1' }),
  task('g3', 'To Do', { task_group_id: 'G1' }),
];
const unlinked: RollupGroup = { id: 'G1', milestone_id: null, archived_at: null };
const linked: RollupGroup = { id: 'G1', milestone_id: 'M1', archived_at: null };

describe('milestoneProgress (#2679)', () => {
  it('AC-TGM-008: with no linked group it equals today (direct tasks only)', () => {
    expect(milestoneProgress('M1', [...direct, ...grouped], [unlinked])).toEqual({ taskCount: 2, doneCount: 1, calculatedPct: 50 });
    expect(milestoneProgress('M1', direct, [])).toEqual({ taskCount: 2, doneCount: 1, calculatedPct: 50 });
  });

  it('AC-TGM-008 / AC-TGM-009: a linked group adds its tasks (5 tasks, 3 Done, 60%)', () => {
    expect(milestoneProgress('M1', [...direct, ...grouped], [linked])).toEqual({ taskCount: 5, doneCount: 3, calculatedPct: 60 });
  });

  it('AC-TGM-008: a task both direct and in the linked group counts once', () => {
    const overlap = [task('d1', 'Done', { milestone_id: 'M1' }), task('d2', 'To Do', { milestone_id: 'M1', task_group_id: 'G1' }), ...grouped];
    expect(milestoneProgress('M1', overlap, [linked]).taskCount).toBe(5);
  });

  it('AC-TGM-008: subtasks, archived tasks, an archived group and an unlinked group never count', () => {
    const noise = [
      task('s', 'Done', { task_group_id: 'G1', parent_task_id: 'g1' }),
      task('a', 'Done', { task_group_id: 'G1', archived_at: '2026-11-01' }),
    ];
    expect(milestoneProgress('M1', [...direct, ...grouped, ...noise], [linked]).taskCount).toBe(5);
    expect(milestoneProgress('M1', [...direct, ...grouped], [{ ...linked, archived_at: '2026-11-01' }]).taskCount).toBe(2);
    expect(milestoneProgress('M1', [...direct, ...grouped], [unlinked]).taskCount).toBe(2);
  });

  it('AC-TGM-008: a task directly on another milestone but in this one\'s group counts for both (union rule)', () => {
    const t = [task('x', 'Done', { milestone_id: 'M2', task_group_id: 'G1' })];
    expect(milestoneProgress('M1', t, [linked]).taskCount).toBe(1);
    expect(milestoneProgress('M2', t, [linked]).taskCount).toBe(1);
  });

  it('AC-TGM-008: nothing counted is null (no signal), all Done is 100', () => {
    expect(milestoneProgress('M1', [], [linked]).calculatedPct).toBeNull();
    expect(milestoneProgress('M1', [task('a', 'Done', { milestone_id: 'M1' })], []).calculatedPct).toBe(100);
  });
});

describe('groupProgress (#2679)', () => {
  it('counts only the group\'s live top-level tasks', () => {
    const noise = [task('s', 'Done', { task_group_id: 'G1', parent_task_id: 'g1' }), task('a', 'Done', { task_group_id: 'G1', archived_at: 'x' })];
    expect(groupProgress('G1', [...grouped, ...noise, ...direct])).toEqual({ taskCount: 3, doneCount: 2, calculatedPct: (2 * 100) / 3 });
    expect(groupProgress('G9', grouped).calculatedPct).toBeNull();
  });
});
