import { supabase } from '@/src/lib/supabase/client';
import { AppError } from '@/src/lib/appError';
import type { Tables, TablesUpdate, Enums } from '@/src/lib/supabase/database.types';
import { routeTaskWrite } from '@/src/lib/adapterSeam/ownershipCache';
import { dispatchTaskCommand } from '@/src/lib/adapterSeam/dispatchClient';

export type TaskRow = Tables<'tasks'>;
export type TaskStatus = Enums<'task_status'>;
export type TaskPriority = Enums<'task_priority'>;
export type TaskDependencyRow = Tables<'task_dependencies'>;

/** A task row joined with its assignee profile (name only) and its `depends_on` edges. */
export type TaskWithRefs = TaskRow & {
  assignee: { id: string; full_name: string } | null;
  /** The task_dependencies rows where this task depends on another (task_id = this row). */
  dependencies: { depends_on_id: string }[];
};

/** The fields a create form supplies. org_id is NEVER among them — RLS stamps it. */
export interface TaskInput {
  project_id: string;
  name: string;
  status: TaskStatus;
  assignee_id: string | null;
  start_date?: string | null;
  end_date?: string | null;
  /** Optional milestone grouping (FR-DEL-016). null = Ungrouped. */
  milestone_id?: string | null;
  /**
   * Optional parent task (OD-INT-9 subtask model). null = top-level (the default). A non-null
   * id makes this task a subtask; subtasks render nested under their parent and never
   * independently move a delivery percentage (rollup exclusion is server-side). The DB CHECK
   * blocks self-parent; the UI additionally blocks descendant-parent (cycle) via taskTree.
   */
  parent_task_id?: string | null;
  /** Optional free-text description (OD-INT-9). Maps to ClickUp `description`. null = none. */
  description?: string | null;
  /** Optional priority (OD-INT-9). Maps to ClickUp's integer priority via the fixed 4-value map.
   *  null = no priority set (the column is nullable — "no priority" stays expressible). */
  priority?: TaskPriority | null;
}

/** The structure fields an edit (PM/Exec/Admin) supplies. project_id/org_id are never patched. */
export interface TaskPatch {
  name?: string;
  status?: TaskStatus;
  assignee_id?: string | null;
  start_date?: string | null;
  end_date?: string | null;
  /** Milestone re-assignment (FR-DEL-016). null explicitly ungroups the task. */
  milestone_id?: string | null;
  /** Parent re-assignment (OD-INT-9). null explicitly promotes the subtask back to top-level. */
  parent_task_id?: string | null;
  /** Description edit (OD-INT-9). null explicitly clears it. */
  description?: string | null;
  /** Priority edit (OD-INT-9). null explicitly clears the priority back to "unset". */
  priority?: TaskPriority | null;
}

/** Shape of a PostgREST/Postgres error we surface (only the fields we read). */
interface PostgrestErrorLike {
  message: string;
  code?: string;
}

/**
 * Throws an `AppError` preserving the verbatim message AND the Postgres error `code`
 * (e.g. `42501` RLS/role-rejected, `23505` duplicate/self dependency) so the UI can
 * classify the toast via `classifyMutationError`.
 */
function throwWrite(error: PostgrestErrorLike): never {
  throw new AppError(error.message, error.code);
}

/** Joined select: the task + its assignee profile name + its outgoing dependency edges. */
const SELECT =
  '*, assignee:profiles!tasks_assignee_id_fkey(id, full_name), dependencies:task_dependencies!task_dependencies_task_id_fkey(depends_on_id)';

type RawTask = TaskRow & {
  assignee: { id: string; full_name: string } | null;
  dependencies: { depends_on_id: string }[] | null;
};

/**
 * List the tasks for one project (AC-TASK-001) with their assignee profile + dependency edges.
 * org_id is NEVER sent — RLS (tasks_select: org_id = auth_org_id()) scopes rows. Ordered by
 * created_at for a stable list/board. Excludes tombstoned rows (`.is('tombstoned_at', null)`,
 * AC-CUA-002/C5) — a ClickUp-native delete tombstones the mirror (C3) rather than removing it, so
 * this filter keeps a deleted-upstream task out of the active list/board/Gantt/S-curve (all consume
 * this same query — no separate filter needed elsewhere). Throws an `AppError` (code preserved) on
 * failure.
 */
export async function listTasks(projectId: string): Promise<TaskWithRefs[]> {
  const { data, error } = await supabase
    .from('tasks')
    .select(SELECT)
    .eq('project_id', projectId)
    .is('tombstoned_at', null)
    .order('created_at', { ascending: true });
  if (error) throwWrite(error);
  const rows = (data ?? []) as unknown as RawTask[];
  return rows.map((t) => ({
    ...t,
    assignee: t.assignee ?? null,
    dependencies: t.dependencies ?? [],
  }));
}

/**
 * Fetch a single task by id (AC-TASK-002), or null when not found / not readable / tombstoned
 * (`.is('tombstoned_at', null)`, AC-CUA-002/C5b — a ClickUp-native delete must not remain openable
 * by id). org_id is NEVER sent — RLS scopes the row. Throws an `AppError` (code preserved) on a
 * query error.
 */
export async function getTask(id: string): Promise<TaskWithRefs | null> {
  const { data, error } = await supabase
    .from('tasks')
    .select(SELECT)
    .eq('id', id)
    .is('tombstoned_at', null)
    .maybeSingle();
  if (error) throwWrite(error);
  if (!data) return null;
  const t = data as unknown as RawTask;
  return { ...t, assignee: t.assignee ?? null, dependencies: t.dependencies ?? [] };
}

/**
 * Create a task on a project (AC-TASK-003). org_id is NEVER sent — the column default + the
 * `tasks_write` WITH CHECK (org_id = auth_org_id() AND the delivery write-roles + parent-project
 * org guard) are the authority. Empty assignee/dates normalise to null. Returns the new row.
 * Throws an `AppError` (code preserved, e.g. `42501` when a non-write-role is denied) on failure.
 *
 * ADR-0056 / AC-CUA-001/030: when the org's `tasks` domain is externally-owned (routeTaskWrite()),
 * the write routes through `dispatchTaskCommand` instead of the direct insert — fail-closed to the
 * direct DAL (this branch) whenever the ownership cache is empty/never-loaded (FR-CUA-030/031).
 *
 * OD-INT-9: parent_task_id IS forwarded to the external dispatch; the dispatch factory resolves
 * it via `external_refs` to a ClickUp `parent` id. Unresolvable parents create a flat task
 * (reconciled later). milestone_id remains omitted (PMO-native grouping).
 */
export async function createTask(input: TaskInput): Promise<TaskRow> {
  if (routeTaskWrite(input.project_id) === 'external') {
    // OD-INT-9: parent_task_id IS forwarded to the external dispatch; the dispatch factory
    // resolves it via `external_refs` to a ClickUp `parent` id. Unresolvable parents create
    // a flat task (reconciled later by the sweep). milestone_id remains omitted (PMO-native
    // grouping).
    const res = await dispatchTaskCommand('create', {
      id: crypto.randomUUID(),
      project_id: input.project_id,
      name: input.name,
      status: input.status,
      assignee_id: input.assignee_id || null,
      start_date: input.start_date || null,
      end_date: input.end_date || null,
      parent_task_id: input.parent_task_id ?? null,
      // OD-INT-9: description + priority DO map to ClickUp (unlike milestone_id, a PMO-native
      // enhancement that stays excluded). Follow the parent_task_id precedent.
      description: input.description || null,
      priority: input.priority ?? null,
    });
    return res.canonical as unknown as TaskRow;
  }
  const { data, error } = await supabase
    .from('tasks')
    .insert({
      project_id: input.project_id,
      name: input.name,
      status: input.status,
      assignee_id: input.assignee_id || null,
      start_date: input.start_date || null,
      end_date: input.end_date || null,
      milestone_id: input.milestone_id ?? null,
      parent_task_id: input.parent_task_id ?? null,
      description: input.description || null, // OD-INT-9: "" normalises to null
      priority: input.priority ?? null,
    })
    .select()
    .single();
  if (error) throwWrite(error);
  return data as TaskRow;
}

/**
 * Update a task's STRUCTURE fields by id (AC-TASK-004) — name, assignee, dates, and (for managers)
 * status. project_id/org_id are NEVER patched — a task does not move project, and RLS stamps org.
 * Only the keys present in `patch` are sent. Throws an `AppError` (code preserved) on failure.
 *
 * ADR-0056 / AC-CUA-001/030: routes through `dispatchTaskCommand('update', ...)` when the org's
 * `tasks` domain is externally-owned; fail-closed to the direct DAL below otherwise.
 */
export async function updateTask(id: string, patch: TaskPatch, projectId?: string): Promise<void> {
  if (routeTaskWrite(projectId) === 'external') {
    // NOTE (OD-INT-9 gap): strip parent_task_id before dispatch — same exclusion + reason as
    // create above (ClickUp `parent` mapping is a separate issue). Forwarding an unhandled
    // field to the ClickUp edge function risks rejecting the whole write.
    const { parent_task_id: _omitted, ...rest } = patch;
    await dispatchTaskCommand('update', { id, ...rest });
    return;
  }
  const next: TablesUpdate<'tasks'> = {};
  if (patch.name !== undefined) next.name = patch.name;
  if (patch.status !== undefined) next.status = patch.status;
  if (patch.assignee_id !== undefined) next.assignee_id = patch.assignee_id || null;
  if (patch.start_date !== undefined) next.start_date = patch.start_date || null;
  if (patch.end_date !== undefined) next.end_date = patch.end_date || null;
  if (patch.milestone_id !== undefined) next.milestone_id = patch.milestone_id; // null ungroups
  if (patch.parent_task_id !== undefined) next.parent_task_id = patch.parent_task_id; // null promotes
  if (patch.description !== undefined) next.description = patch.description || null; // OD-INT-9: "" → null
  if (patch.priority !== undefined) next.priority = patch.priority; // null clears
  const { error } = await supabase.from('tasks').update(next).eq('id', id);
  if (error) throwWrite(error);
}

/**
 * Update ONLY a task's status by id (AC-TASK-005). This is the assignee path: an Engineer may set
 * status on their OWN task (migration 0016 widens tasks RLS with a column-pinned WITH CHECK that
 * mirrors the timesheets MED-TS-2 pattern). Managers (PM/Exec/Admin) also use this single-column
 * write. NOTHING but `status` is sent, so the column-pinned policy is satisfied. Throws an
 * `AppError` (code preserved — `42501` when an Engineer is not the assignee) on failure.
 *
 * ADR-0056 / AC-CUA-001/030: routes through `dispatchTaskCommand('transition', ...)` when the
 * org's `tasks` domain is externally-owned; fail-closed to the direct DAL below otherwise.
 */
export async function updateTaskStatus(id: string, status: TaskStatus, projectId?: string): Promise<void> {
  if (routeTaskWrite(projectId) === 'external') {
    await dispatchTaskCommand('transition', { id, status });
    return;
  }
  const { error } = await supabase.from('tasks').update({ status }).eq('id', id);
  if (error) throwWrite(error);
}

/**
 * Hard-delete a task by id (AC-TASK-006) — Admin/Exec/PM only (RLS). Cascades to its
 * task_dependencies rows (FK on delete cascade). org_id is NEVER sent. Throws an `AppError`
 * (code preserved) on failure.
 *
 * ADR-0056 / AC-CUA-001/038: routes through `dispatchTaskCommand('delete', ...)` when the org's
 * `tasks` domain is externally-owned (the dispatch tombstones the mirror, C3); fail-closed to the
 * direct hard-delete below otherwise.
 */
/** Set or clear PMO-owned task archive state. External domains are fail-closed: ClickUp is the
 * authoritative writer and this path must never attempt a guaranteed 42501 update. */
export async function archiveTask(id: string, projectId?: string): Promise<void> {
  if (routeTaskWrite(projectId) === 'external') {
    throw new AppError('Tasks are managed by the connected task system.', 'external-owned');
  }
  const { error } = await supabase
    .from('tasks')
    .update({ archived_at: new Date().toISOString() })
    .eq('id', id);
  if (error) throwWrite(error);
}

export async function unarchiveTask(id: string, projectId?: string): Promise<void> {
  if (routeTaskWrite(projectId) === 'external') {
    throw new AppError('Tasks are managed by the connected task system.', 'external-owned');
  }
  const { error } = await supabase.from('tasks').update({ archived_at: null }).eq('id', id);
  if (error) throwWrite(error);
}

export async function deleteTask(id: string, projectId?: string): Promise<void> {
  if (routeTaskWrite(projectId) === 'external') {
    await dispatchTaskCommand('delete', { id });
    return;
  }
  const { error } = await supabase.from('tasks').delete().eq('id', id);
  if (error) throwWrite(error);
}

/**
 * Add a dependency edge: `taskId` depends on `dependsOnId` (AC-TASK-007). org_id is NEVER sent —
 * the column default + the `task_dependencies_write` WITH CHECK (delivery roles + both endpoint
 * tasks in-org) are the authority. The DB CHECK (task_id <> depends_on_id) + the composite PK reject
 * self/duplicate edges as `23505`-class errors. Throws an `AppError` (code preserved) on failure.
 */
export async function addDependency(taskId: string, dependsOnId: string): Promise<void> {
  const { error } = await supabase
    .from('task_dependencies')
    .insert({ task_id: taskId, depends_on_id: dependsOnId });
  if (error) throwWrite(error);
}

/**
 * Remove a dependency edge (AC-TASK-007). org_id is NEVER sent — RLS scopes the delete. Throws an
 * `AppError` (code preserved) on failure.
 */
export async function removeDependency(taskId: string, dependsOnId: string): Promise<void> {
  const { error } = await supabase
    .from('task_dependencies')
    .delete()
    .match({ task_id: taskId, depends_on_id: dependsOnId });
  if (error) throwWrite(error);
}