/**
 * Milestone roll-up with task groups (#2679, spec docs/specs/task-group-milestone-rollup.spec.md §3).
 * A phase's overall percentage comes from get_project_milestones or get_projects_delivery.
 * The phase row and progress curve use the same direct and active group links.
 *
 * groupProgress counts a group's counted tasks (countedTasks: live, no live child). Calculated % is Done / counted, null when none.
 */

import { countedTasks } from '@/src/lib/tasks/taskTree';

export interface TaskPhaseLinks {
  milestone_id: string | null;
  task_group?: { milestone_id: string | null; archived_at: string | null } | null;
}

/** A phase counts direct assignments and assignments through active groups. */
export function taskMilestoneIds(task: TaskPhaseLinks): string[] {
  const ids = task.milestone_id ? [task.milestone_id] : [];
  const group = task.task_group;
  if (group?.archived_at === null && group.milestone_id && group.milestone_id !== task.milestone_id) {
    ids.push(group.milestone_id);
  }
  return ids;
}

export interface RollupTask {
  id: string;
  status: string;
  milestone_id: string | null;
  task_group_id: string | null;
  parent_task_id: string | null;
  archived_at: string | null;
}

export interface RollupGroup {
  id: string;
  milestone_id: string | null;
  archived_at: string | null;
}

export interface Progress {
  taskCount: number;
  doneCount: number;
  /** null when nothing is counted (no signal), never 0. */
  calculatedPct: number | null;
}


function progressOf(tasks: RollupTask[]): Progress {
  const doneCount = tasks.filter((t) => t.status === 'Done').length;
  return {
    taskCount: tasks.length,
    doneCount,
    calculatedPct: tasks.length === 0 ? null : (doneCount * 100) / tasks.length,
  };
}

/** Progress of one group itself: its counted tasks. */
export function groupProgress(groupId: string, tasks: RollupTask[]): Progress {
  return progressOf(countedTasks(tasks).filter((t) => t.task_group_id === groupId));
}
