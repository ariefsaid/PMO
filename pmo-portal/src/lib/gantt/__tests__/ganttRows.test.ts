/**
 * Unit tests for the Gantt flat-row seam (XG03-003 / T-44): the flattening selector shared
 * by the task table and the timeline so both views align on ONE row model.
 * Pure module — no React, no DOM.
 */
import { describe, it, expect } from 'vitest';
import { flattenGanttRows, taskRowKeys } from '../ganttRows';
import { buildGanttModel, type GanttLayoutConfig } from '../ganttLayout';
import type { TaskWithRefs } from '@/src/lib/db/tasks';
import type { MilestoneWithProgress } from '@/src/lib/db/milestones';

const CFG: GanttLayoutConfig = { scale: 'month', rowHeight: 40, laneHeaderHeight: 36 };

function makeTask(overrides: Partial<TaskWithRefs> & { id: string; name: string }): TaskWithRefs {
  return {
    org_id: 'org-1',
    project_id: 'p1',
    status: 'To Do',
    assignee_id: null,
    milestone_id: null,
    created_at: '2026-01-01T00:00:00Z',
    completed_at: null,
    created_by: null,
    tombstoned_at: null,
    meeting_id: null,
    source_updated_at: null,
    description: null,
    priority: null,
    parent_task_id: null,
    archived_at: null,
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

describe('flattenGanttRows (the shared table/timeline row seam)', () => {
  it('emits a lane-header row before each lane\u2019s task rows, with the ungrouped lane keyed `__ungrouped__`', () => {
    const tasks: TaskWithRefs[] = [
      makeTask({ id: 'a', name: 'Grouped', start_date: '2026-01-01', end_date: '2026-01-05', milestone_id: 'ms1' }),
      makeTask({ id: 'b', name: 'Free', start_date: '2026-01-02', end_date: '2026-01-06' }),
    ];
    const milestones: MilestoneWithProgress[] = [
      makeMilestone({ id: 'ms1', name: 'Phase 1' }),
    ];
    const model = buildGanttModel(tasks, milestones, '2026-01-01', CFG);
    const rows = flattenGanttRows(model.lanes, tasks);

    expect(rows.map((r) => r.kind)).toEqual(['lane', 'task', 'lane', 'task']);
    expect(rows[0]).toMatchObject({ kind: 'lane', key: 'lane:ms1', label: 'Phase 1' });
    expect(rows[1]).toMatchObject({ kind: 'task', key: 'task:a' });
    expect(rows[2]).toMatchObject({ kind: 'lane', key: 'lane:__ungrouped__', label: 'Ungrouped' });
    expect(rows[3]).toMatchObject({ kind: 'task', key: 'task:b' });
  });

  it('resolves each task row\u2019s predecessor names from the dependency edges, dropping unknown ids', () => {
    const tasks: TaskWithRefs[] = [
      makeTask({ id: 'x', name: 'Upstream', start_date: '2026-01-01', end_date: '2026-01-05' }),
      makeTask({
        id: 'a',
        name: 'Successor',
        start_date: '2026-01-06',
        end_date: '2026-01-11',
        dependencies: [{ depends_on_id: 'x' }, { depends_on_id: 'ghost' }],
      }),
    ];
    const model = buildGanttModel(tasks, [], '2026-01-01', CFG);
    const rows = flattenGanttRows(model.lanes, tasks);
    const successor = rows.find((r) => r.kind === 'task' && r.key === 'task:a');
    expect(successor && successor.kind === 'task' ? successor.predecessorNames : null).toEqual(['Upstream']);
  });

  it('skips the subtasks the Gantt never renders (parent_task_id set) even when named as predecessors', () => {
    // A subtask is filtered out of the model (OD-INT-9), so naming it as a predecessor yields no row.
    const tasks: TaskWithRefs[] = [
      makeTask({ id: 'parent', name: 'Parent', start_date: '2026-01-01', end_date: '2026-01-05' }),
      makeTask({ id: 'kid', name: 'Kid', start_date: '2026-01-02', end_date: '2026-01-03', parent_task_id: 'parent' }),
    ];
    const model = buildGanttModel(tasks, [], '2026-01-01', CFG);
    const rows = flattenGanttRows(model.lanes, tasks);
    expect(rows.filter((r) => r.kind === 'task').map((r) => (r.kind === 'task' ? r.bar.id : ''))).toEqual(['parent']);
  });
});

describe('taskRowKeys', () => {
  it('lists task-row keys in flat order, skipping lane headers', () => {
    const tasks: TaskWithRefs[] = [
      makeTask({ id: 'a', name: 'A', start_date: '2026-01-01', end_date: '2026-01-05', milestone_id: 'ms1' }),
      makeTask({ id: 'b', name: 'B', start_date: '2026-01-02', end_date: '2026-01-06', milestone_id: 'ms1' }),
    ];
    const milestones: MilestoneWithProgress[] = [makeMilestone({ id: 'ms1', name: 'Phase 1' })];
    const model = buildGanttModel(tasks, milestones, '2026-01-01', CFG);
    const rows = flattenGanttRows(model.lanes, tasks);
    expect(taskRowKeys(rows)).toEqual(['task:a', 'task:b']);
  });
});
