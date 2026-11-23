/**
 * Shared task-view vocabulary and view-model helpers (XG03-005 / T-44): the status
 * vocabulary every task view renders and the small ordering/lateness helpers the list,
 * board and grouped list all consume. TasksTab stays the owner of permissions, task
 * selection and mutation callbacks (ADR-0016/0056); this module only localizes what those
 * views share so their behavior tests have one home. Pure module — no React.
 */
import type { TaskWithRefs, TaskStatus } from '@/src/lib/db/tasks';
import { buildTaskRenderOrder, type TaskRollup } from '@/src/lib/tasks/taskTree';

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

/**
 * #2807 outline: the visible rows of one list section in tree order. Roots (a task whose parent is not in `tasks`)
 * and each parent's children are ordered by urgency; a parent ranks by its roll-up (status and latest due date).
 * A collapsed parent hides its descendants. `depths` covers every task in `tasks`, shown or hidden.
 */
export function outlineRows(
  tasks: TaskWithRefs[],
  rollups: Map<string, TaskRollup>,
  collapsed: ReadonlySet<string>,
): { roots: TaskWithRefs[]; rowsUnder: (root: TaskWithRefs) => TaskWithRefs[]; depths: Map<string, number> } {
  const present = new Set(tasks.map((t) => t.id));
  const kids = new Map<string, TaskWithRefs[]>();
  const roots: TaskWithRefs[] = [];
  for (const t of tasks) {
    if (t.parent_task_id && present.has(t.parent_task_id)) kids.set(t.parent_task_id, [...(kids.get(t.parent_task_id) ?? []), t]);
    else roots.push(t);
  }
  const shown = (t: TaskWithRefs): TaskWithRefs => {
    const r = rollups.get(t.id);
    return r ? { ...t, status: r.status, end_date: r.end } : t;
  };
  const sort = (rows: TaskWithRefs[]) => rows
    .map((task, index) => ({ task, index, key: shown(task) }))
    .sort((a, b) => compareTaskUrgency(a.key, b.key) || a.index - b.index)
    .map(({ task }) => task);
  const depths = new Map<string, number>();
  const walk = (t: TaskWithRefs, depth: number, out: TaskWithRefs[] | null, seen: Set<string>) => {
    if (seen.has(t.id)) return;
    seen.add(t.id);
    depths.set(t.id, depth);
    out?.push(t);
    const open = out && !collapsed.has(t.id);
    for (const k of sort(kids.get(t.id) ?? [])) walk(k, depth + 1, open ? out : null, seen);
  };
  const sortedRoots = sort(roots);
  const cache = new Map<string, TaskWithRefs[]>();
  for (const r of sortedRoots) {
    const out: TaskWithRefs[] = [];
    walk(r, 0, out, new Set());
    cache.set(r.id, out);
  }
  return { roots: sortedRoots, rowsUnder: (root) => cache.get(root.id) ?? [root], depths };
}

/** The status a row shows: a parent's roll-up, else its own. */
export const shownStatus = (task: TaskWithRefs, rollups: Map<string, TaskRollup>): string =>
  rollups.get(task.id)?.status ?? task.status;
