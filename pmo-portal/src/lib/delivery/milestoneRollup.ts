/**
 * Milestone roll-up with task groups (#2679, spec docs/specs/task-group-milestone-rollup.spec.md §3).
 * The database is the authority (get_project_milestones / get_projects_delivery, migration 1396): a phase's own
 * percentage comes from that read, and the screen computes only a group's progress here (#2753).
 *
 * groupProgress counts a group's top-level, non-archived tasks. Calculated % is Done / counted, null when none.
 */

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

const isLive = (t: RollupTask): boolean => t.parent_task_id === null && t.archived_at === null;

function progressOf(tasks: RollupTask[]): Progress {
  const doneCount = tasks.filter((t) => t.status === 'Done').length;
  return {
    taskCount: tasks.length,
    doneCount,
    calculatedPct: tasks.length === 0 ? null : (doneCount * 100) / tasks.length,
  };
}

/** Progress of one group itself: its top-level, non-archived tasks. */
export function groupProgress(groupId: string, tasks: RollupTask[]): Progress {
  return progressOf(tasks.filter((t) => isLive(t) && t.task_group_id === groupId));
}
