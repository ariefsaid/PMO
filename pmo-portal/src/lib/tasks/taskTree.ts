import type { TaskWithRefs } from '@/src/lib/db/tasks';

/** The fields the counting rule reads. */
export interface CountableTask {
  id: string;
  parent_task_id: string | null;
  archived_at?: string | null;
}

/**
 * THE progress counting rule (#2807; SQL twin `public.task_counts_toward_progress`, migration 1970): a task counts
 * toward milestone %, delivery %, the S-curve and every task figure when it is not archived and has no live child.
 * A parent is a display-only roll-up of its leaves, so regrouping work never moves a figure. An archived child does
 * not make its parent a parent. Pass the project's whole task list: a child missing from `tasks` is not seen.
 */
export function countedTasks<T extends CountableTask>(tasks: readonly T[]): T[] {
  const parents = new Set<string>();
  for (const t of tasks) if (t.parent_task_id && t.archived_at == null) parents.add(t.parent_task_id);
  return tasks.filter((t) => t.archived_at == null && !parents.has(t.id));
}

/**
 * OD-INT-9 subtask model — pure tree helpers for the Tasks list view + the parent-picker's
 * cycle guard. Subtasks (parent_task_id != null) render NESTED under their parent; they never
 * move a percentage on their own (the rollup exclusion lives in the RPCs + sCurve + gantt).
 *
 * These helpers are pure (no React, no network) so they unit-test at the lowest sufficient layer.
 * The Tasks list view consumes `buildTaskRenderOrder` to indent subtasks under their parent, and
 * the parent-picker consumes `collectDescendants` to refuse making a task its own ancestor.
 */

/** A node in the flattened render order: the task + its nesting depth (0 = top-level). */
export interface TaskTreeNode {
  task: TaskWithRefs;
  depth: number;
}

/**
 * Flatten `tasks` into parent-then-children render order.
 *
 * - A task with `parent_task_id == null` is top-level (depth 0).
 * - A subtask renders immediately after its parent at depth = parent.depth + 1, recursively
 *   (deep chains supported).
 * - A subtask whose parent is NOT in `tasks` (filtered out of the current view, or sitting in
 *   another milestone group) is an ORPHAN: it renders at depth 0 so the user never loses sight
 *   of it. The brief calls this state out explicitly.
 *
 * Order is stable: roots (top-level + orphans) keep their input order; children follow their
 * parent in input order. O(tasks) time.
 */
export function buildTaskRenderOrder(tasks: TaskWithRefs[]): TaskTreeNode[] {
  if (tasks.length === 0) return [];

  // Index of which tasks are present in this slice (to detect orphans).
  const present = new Set(tasks.map((t) => t.id));

  // childrenByParent: parent_task_id → its direct children (input order preserved).
  const childrenByParent = new Map<string, TaskWithRefs[]>();
  const roots: TaskWithRefs[] = [];
  for (const t of tasks) {
    const pid = t.parent_task_id;
    if (pid === null || !present.has(pid)) {
      // Top-level, or an orphan whose parent isn't in this slice → render at depth 0.
      roots.push(t);
    } else {
      const arr = childrenByParent.get(pid);
      if (arr) arr.push(t);
      else childrenByParent.set(pid, [t]);
    }
  }

  const out: TaskTreeNode[] = [];

  // DFS from each root. Cycle-safe via a visited set (the DB only blocks self-parent, not
  // cycles, so malformed data must not send this into an infinite loop).
  const walk = (task: TaskWithRefs, depth: number, seen: Set<string>): void => {
    if (seen.has(task.id)) return; // defensive: cycle in the data
    seen.add(task.id);
    out.push({ task, depth });
    const kids = childrenByParent.get(task.id);
    if (kids) for (const k of kids) walk(k, depth + 1, seen);
  };

  for (const r of roots) walk(r, 0, new Set());
  return out;
}

/**
 * Collect ALL descendant task ids of `taskId` over `tasks` (children, grandchildren, …).
 *
 * Used by the parent-picker to PREVENT making a task its own ancestor (cycle guard): a task
 * must not become its own parent OR the parent of any of its descendants, or it would create a
 * cycle. The DB only blocks self-parent (CHECK `parent_task_id <> id`); cycle prevention is the
 * UI's job per the task brief ("guard this in the UI, not only in the DB").
 *
 * Cycle-safe (visits each reachable id once). Returns the empty set for an unknown id or a leaf.
 */
export function collectDescendants(taskId: string, tasks: TaskWithRefs[]): Set<string> {
  const childrenByParent = new Map<string, TaskWithRefs[]>();
  for (const t of tasks) {
    if (t.parent_task_id === null) continue;
    const arr = childrenByParent.get(t.parent_task_id);
    if (arr) arr.push(t);
    else childrenByParent.set(t.parent_task_id, [t]);
  }

  const out = new Set<string>();
  const stack = [...(childrenByParent.get(taskId) ?? [])];
  while (stack.length > 0) {
    const node = stack.pop()!;
    if (out.has(node.id)) continue; // defensive: cycle in the data
    out.add(node.id);
    for (const kid of childrenByParent.get(node.id) ?? []) stack.push(kid);
  }
  // The task itself is never its own descendant.
  out.delete(taskId);
  return out;
}

/** What a parent row shows instead of its own status and dates (#2807): a roll-up of its live leaves. */
export interface TaskRollup {
  leafCount: number;
  doneCount: number;
  /** Done leaves / leaves, 0-100. */
  pct: number;
  start: string | null;
  end: string | null;
  /** All leaves Done → Done; any Blocked → Blocked; any started → In Progress; else To Do. */
  status: 'To Do' | 'In Progress' | 'Blocked' | 'Done';
}

interface RollupInput extends CountableTask {
  status: string;
  start_date: string | null;
  end_date: string | null;
}

/**
 * The roll-up of every task that has a live child, keyed by task id, over the project's WHOLE task list (never a
 * filtered view, so a filter cannot change a parent's figures). Leaves are the counted tasks under it, at any depth.
 */
export function buildRollups<T extends RollupInput>(tasks: readonly T[]): Map<string, TaskRollup> {
  const live = tasks.filter((t) => t.archived_at == null);
  const kids = new Map<string, T[]>();
  for (const t of live) if (t.parent_task_id) kids.set(t.parent_task_id, [...(kids.get(t.parent_task_id) ?? []), t]);
  const out = new Map<string, TaskRollup>();
  const leavesOf = (id: string, seen: Set<string>): T[] => {
    if (seen.has(id)) return []; // defensive: a cycle in old data
    seen.add(id);
    return (kids.get(id) ?? []).flatMap((c) => (kids.has(c.id) ? leavesOf(c.id, seen) : [c]));
  };
  for (const id of kids.keys()) {
    const leaves = leavesOf(id, new Set());
    const done = leaves.filter((l) => l.status === 'Done').length;
    const starts = leaves.map((l) => l.start_date ?? l.end_date).filter((d): d is string => !!d).sort();
    const ends = leaves.map((l) => l.end_date ?? l.start_date).filter((d): d is string => !!d).sort();
    out.set(id, {
      leafCount: leaves.length,
      doneCount: done,
      pct: leaves.length ? (done * 100) / leaves.length : 0,
      start: starts[0] ?? null,
      end: ends[ends.length - 1] ?? null,
      status: leaves.length > 0 && done === leaves.length ? 'Done'
        : leaves.some((l) => l.status === 'Blocked') ? 'Blocked'
          : leaves.some((l) => l.status === 'In Progress' || l.status === 'Done') ? 'In Progress' : 'To Do',
    });
  }
  return out;
}
