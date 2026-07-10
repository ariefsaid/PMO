import { supabase } from '@/src/lib/supabase/client';
import { AppError } from '@/src/lib/appError';
import type { Tables, TablesUpdate, Enums } from '@/src/lib/supabase/database.types';
import { routeTaskWrite } from '@/src/lib/adapterSeam/ownershipCache';
import { dispatchTaskCommand } from '@/src/lib/adapterSeam/dispatchClient';

export type TaskRow = Tables<'tasks'>;
export type TaskStatus = Enums<'task_status'>;
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
 */
export async function createTask(input: TaskInput): Promise<TaskRow> {
  if (routeTaskWrite() === 'external') {
    const res = await dispatchTaskCommand('create', {
      id: crypto.randomUUID(),
      project_id: input.project_id,
      name: input.name,
      status: input.status,
      assignee_id: input.assignee_id || null,
      start_date: input.start_date || null,
      end_date: input.end_date || null,
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
export async function updateTask(id: string, patch: TaskPatch): Promise<void> {
  if (routeTaskWrite() === 'external') {
    await dispatchTaskCommand('update', { id, ...patch });
    return;
  }
  const next: TablesUpdate<'tasks'> = {};
  if (patch.name !== undefined) next.name = patch.name;
  if (patch.status !== undefined) next.status = patch.status;
  if (patch.assignee_id !== undefined) next.assignee_id = patch.assignee_id || null;
  if (patch.start_date !== undefined) next.start_date = patch.start_date || null;
  if (patch.end_date !== undefined) next.end_date = patch.end_date || null;
  if (patch.milestone_id !== undefined) next.milestone_id = patch.milestone_id; // null ungroups
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
export async function updateTaskStatus(id: string, status: TaskStatus): Promise<void> {
  if (routeTaskWrite() === 'external') {
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
export async function deleteTask(id: string): Promise<void> {
  if (routeTaskWrite() === 'external') {
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
