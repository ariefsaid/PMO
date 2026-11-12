import type { TaskDueRow } from '@/src/lib/db/tasks';

const OVERDUE_TASK_STATUSES = new Set(['To Do', 'In Progress', 'Blocked']);

/** Owner input is the database's already-filtered task count; PM input is its existing due-row read. */
export function selectOverdueTaskCount(
  source: number | readonly TaskDueRow[],
  organizationToday: string | null,
  projectId?: string,
): number | null {
  if (typeof source === 'number') return source;
  if (!organizationToday) return null;
  return source.filter((task) =>
    OVERDUE_TASK_STATUSES.has(task.status) && task.end_date !== null && task.end_date < organizationToday &&
    (projectId === undefined || task.project_id === projectId),
  ).length;
}
