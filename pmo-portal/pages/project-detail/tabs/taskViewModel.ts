/**
 * Shared task-view vocabulary and view-model helpers (XG03-005 / T-44): the status
 * vocabulary every task view renders and the small ordering/lateness helpers the list,
 * board and grouped list all consume. TasksTab stays the owner of permissions, task
 * selection and mutation callbacks (ADR-0016/0056); this module only localizes what those
 * views share so their behavior tests have one home. Pure module — no React.
 */
import type { TaskWithRefs, TaskStatus } from '@/src/lib/db/tasks';
import { buildTaskRenderOrder } from '@/src/lib/tasks/taskTree';

// ── Status vocabulary ───────────────────────────────────────────────────────
// The four task_status enum values. The pill variant comes from the single status
// registry (`workflowVariant`): To Do = quiet neutral, In Progress = neutral grey
// `progress` (NOT the action-blue, per the Freed-Blue Status Rule), Done = green
// `won`, Blocked = red `lost`. The distinct LABEL always rides alongside (never
// colour-only — DESIGN.md Tinted-Status / color-not-only).
// ⛔ NOT TRANSLATED, deliberately: these ARE the task_status enum values, and they are used
// as both the option value and its label. They also render raw next to this control via
// <StatusPill>{task.status}</StatusPill>, so translating one side alone would show the same
// status in two languages side by side. Status vocabulary is one cross-cutting decision
// (it also covers doc status, procurement stages and pipeline stages) -- not this file's.
export type ViewMode = 'list' | 'board' | 'timeline' | 'calendar';
export type TaskScope = 'mine' | 'all';
export type BulkAction = 'status' | 'assignee' | 'due' | 'archive' | null;

export const STATUSES: TaskStatus[] = ['To Do', 'In Progress', 'Done', 'Blocked'];
export const BOARD_STATUSES: TaskStatus[] = ['To Do', 'In Progress', 'Blocked', 'Done'];
export const STATUS_OPTIONS = STATUSES.map((s) => ({ value: s, label: s }));

const DAY_MS = 24 * 60 * 60 * 1000;

export function daysLate(dueDate: string, today: string): number {
  return Math.floor((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${dueDate}T00:00:00Z`)) / DAY_MS);
}

/** The one late mark: an open task due before today (org-timezone `today`). */
export function isOverdue(task: Pick<TaskWithRefs, 'status' | 'end_date'>, today: string): boolean {
  return task.status !== 'Done' && !!task.end_date && task.end_date < today;
}

function compareTaskUrgency(a: TaskWithRefs, b: TaskWithRefs): number {
  const aDone = a.status === 'Done';
  const bDone = b.status === 'Done';
  if (aDone !== bDone) return aDone ? 1 : -1;
  if (a.end_date && b.end_date) return a.end_date.localeCompare(b.end_date);
  if (a.end_date) return -1;
  if (b.end_date) return 1;
  return 0;
}

/** Urgency-ordered rows (done last, then by due date), hierarchy order as the tiebreak. */
export function orderedTasks(tasks: TaskWithRefs[]): TaskWithRefs[] {
  return buildTaskRenderOrder(tasks)
    .map((entry, index) => ({ task: entry.task, index }))
    .sort((a, b) => compareTaskUrgency(a.task, b.task) || a.index - b.index)
    .map(({ task }) => task);
}
