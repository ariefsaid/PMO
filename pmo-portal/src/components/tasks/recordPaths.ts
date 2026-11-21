import type { RecordLinkType } from '@/src/lib/db/tasks';

/** The page of a record a task follows. */
export function recordPath(type: RecordLinkType, id: string): string {
  if (type === 'procurement') return `/procurement/${id}`;
  if (type === 'expense_claim') return `/expenses/${id}`;
  return `/material-requests/${id}`;
}

/** Where an open task is read: its project's task list, or My tasks for a project-less one. */
export function openTaskPath(task: { id: string; name: string; project_id: string | null }): string {
  return task.project_id ? `/projects/${task.project_id}/tasks#task-${task.id}` : `/my-tasks?q=${encodeURIComponent(task.name)}`;
}
