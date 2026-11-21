/**
 * Milestone roll-up with task groups (#2679, spec docs/specs/task-group-milestone-rollup.spec.md §3).
 * The database is the authority (get_project_milestones / get_projects_delivery, migration 1396); this pure
 * function is the readable statement of the rule and is parity-tested against the same fixtures as the pgTAP proof.
 *
 * A task counts toward milestone M when it is top-level, not archived, and either its own milestone is M or its
 * group is active and linked to M. A task counts once per milestone. Calculated % is Done / counted, null when none.
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

/** Progress of one milestone: its direct tasks plus the tasks of its active linked groups, each counted once. */
export function milestoneProgress(milestoneId: string, tasks: RollupTask[], groups: RollupGroup[]): Progress {
  const linked = new Set(
    groups.filter((g) => g.milestone_id === milestoneId && g.archived_at === null).map((g) => g.id),
  );
  return progressOf(
    tasks.filter((t) => isLive(t) && (t.milestone_id === milestoneId || (t.task_group_id !== null && linked.has(t.task_group_id)))),
  );
}

/** Progress of one group itself: its top-level, non-archived tasks. */
export function groupProgress(groupId: string, tasks: RollupTask[]): Progress {
  return progressOf(tasks.filter((t) => isLive(t) && t.task_group_id === groupId));
}
