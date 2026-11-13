import { projectDisplayName } from '@/src/lib/projectDisplayName';
import { fetchAllPages } from '@/src/lib/pagedRead';
import { supabase } from '@/src/lib/supabase/client';
import { AppError, assertWriteLanded } from '@/src/lib/appError';
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
  /** Nullable since 0199 (first-class tasks): a meeting-born action item may belong to no
   *  project (DD-TASK-1). null = project-less. */
  project_id: string | null;
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
  /**
   * Optional parent meeting (migration 0206, the /action seam): a task minuted out of a meeting
   * carries the meeting's id. The 0206 trigger enforces org + same-project agreement server-side.
   * PMO-native (like milestone_id) — never forwarded on the external ClickUp dispatch.
   */
  meeting_id?: string | null;
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
  const rows = await fetchAllPages((from, to) => supabase
    .from('tasks')
    .select(SELECT)
    .eq('project_id', projectId)
    .is('tombstoned_at', null)
    .order('created_at', { ascending: true })
    .order('id', { ascending: true })
    .range(from, to)) as unknown as RawTask[];
  return rows.map((t) => ({
    ...t,
    assignee: t.assignee ?? null,
    dependencies: t.dependencies ?? [],
  }));
}

/** Narrow task row for dashboard overdue counts: no joins, no description. */
export type TaskDueRow = Pick<TaskRow, 'project_id' | 'status' | 'end_date'>;

const DUE_CHUNK = 100;

/**
 * Status + due date of every live task across `projectIds`, in `.in(project_id)` chunks (one read
 * per chunk, not one per project). Narrow select: the PM dashboard only counts overdue tasks.
 * Excludes tombstoned rows like listTasks. Throws on any chunk failure (never a partial set).
 */
export async function listTaskDueRows(projectIds: readonly string[]): Promise<TaskDueRow[]> {
  const unique = [...new Set(projectIds)];
  const out: TaskDueRow[] = [];
  for (let i = 0; i < unique.length; i += DUE_CHUNK) {
    const chunk = unique.slice(i, i + DUE_CHUNK);
    out.push(...(await fetchAllPages((from, to) => supabase
      .from('tasks')
      .select('id, project_id, status, end_date')
      .in('project_id', chunk)
      .is('tombstoned_at', null)
      .is('archived_at', null)
      .order('id', { ascending: true })
      .range(from, to)) as unknown as TaskDueRow[]));
  }
  return out;
}

/** A dated task as the calendar needs it: no joins beyond the project name, no description. */
export interface CalendarTask {
  id: string;
  name: string;
  status: TaskStatus;
  project_id: string | null;
  project_name: string | null;
  start_date: string | null;
  end_date: string;
  assignee_id: string | null;
  /**
   * C13 (DS calendar #4): the assignee's name, so a chip can say whose task it is. Absent/null is a
   * real state (unassigned, or a caller that did not join the profile) and is never rendered as an
   * empty separator.
   */
  assignee_name?: string | null;
  created_by: string | null;
}

/**
 * Live, unarchived tasks due in `[from, to)` (YYYY-MM-DD) for the calendar views. ONE query for the
 * whole org window (RLS scopes rows; org_id is never sent), or one project when `projectId` is given.
 * Throws on any page failure (never a partial set).
 */
export async function listCalendarTasks(
  opts: { from: string; to: string; projectId?: string },
): Promise<CalendarTask[]> {
  const rows = await fetchAllPages((from, to) => {
    let q = supabase
      .from('tasks')
      .select('id, name, status, project_id, start_date, end_date, assignee_id, created_by, assignee:profiles!tasks_assignee_id_fkey(full_name), project:projects!tasks_project_id_fkey(name, short_name)')
      .gte('end_date', opts.from)
      .lt('end_date', opts.to)
      .is('tombstoned_at', null)
      .is('archived_at', null);
    if (opts.projectId) q = q.eq('project_id', opts.projectId);
    return q.order('end_date', { ascending: true }).order('id', { ascending: true }).range(from, to);
  }) as unknown as Array<Omit<CalendarTask, 'project_name' | 'assignee_name'> & {
    assignee: { full_name: string } | null;
    project: { name: string; short_name?: string | null } | null;
  }>;
  return rows.map(({ project, assignee, ...t }) => ({
    ...t,
    project_name: project ? projectDisplayName(project) : null,
    assignee_name: assignee?.full_name ?? null,
  }));
}

/**
 * List the tasks minuted out of one meeting (the /action seam, migration 0206) with their
 * assignee — the meeting detail's "Action items" list. Excludes tombstoned rows, mirrors
 * listTasks. RLS scopes rows; ordered by created_at so items read in the order they were minuted.
 */
export async function listTasksByMeeting(meetingId: string): Promise<TaskWithRefs[]> {
  const rows = await fetchAllPages((from, to) => supabase
    .from('tasks')
    .select(SELECT)
    .eq('meeting_id', meetingId)
    .is('tombstoned_at', null)
    .order('created_at', { ascending: true })
    .order('id', { ascending: true })
    .range(from, to)) as unknown as RawTask[];
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
 * it via `external_refs` to a ClickUp `parent` id. An unmapped parent refuses the dispatch
 * (commit-rejected — nothing is created). milestone_id is forwarded too: ClickUp has no such field and ignores it, but the
 * dispatch's mirror write stamps it so the task lands in the chosen group.
 */
export async function createTask(input: TaskInput): Promise<TaskRow> {
  if (routeTaskWrite(input.project_id) === 'external') {
    // OD-INT-9: parent_task_id IS forwarded to the external dispatch; the dispatch factory
    // resolves it via `external_refs` to a ClickUp `parent` id. An unmapped parent refuses
    // the dispatch (commit-rejected — nothing is created).
    const res = await dispatchTaskCommand('create', {
      id: crypto.randomUUID(),
      project_id: input.project_id,
      name: input.name,
      status: input.status,
      assignee_id: input.assignee_id || null,
      start_date: input.start_date || null,
      end_date: input.end_date || null,
      parent_task_id: input.parent_task_id ?? null,
      milestone_id: input.milestone_id ?? null, // PMO-native: stamped on the mirror, never sent to ClickUp
      // OD-INT-9: description + priority DO map to ClickUp. Follow the parent_task_id precedent.
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
      meeting_id: input.meeting_id ?? null, // 0206: the /action seam (PMO-native, like milestone_id)
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
    // parent_task_id (re-parent, or null = promote) and milestone_id ride along: the dispatch maps the
    // parent to ClickUp's `parent` and stamps both on the mirror. Absent keys stay absent.
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
  if (patch.parent_task_id !== undefined) next.parent_task_id = patch.parent_task_id; // null promotes
  if (patch.description !== undefined) next.description = patch.description || null; // OD-INT-9: "" → null
  if (patch.priority !== undefined) next.priority = patch.priority; // null clears
  const { data, error } = await supabase.from('tasks').update(next).eq('id', id).select('id');
  if (error) throwWrite(error);
  assertWriteLanded(data, 'Task not found or you do not have permission to edit it.');
}

/**
 * Update ONLY a task's status by id (AC-TASK-005). This is the assignee path: an Engineer may set
 * status on their OWN task (migration 0016 widens tasks RLS with a column-pinned WITH CHECK that
 * mirrors the timesheets MED-TS-2 pattern). Managers (PM/Exec/Admin) also use this single-column
 * write. NOTHING but `status` is sent, so the column-pinned policy is satisfied. Throws an
 * `AppError` (code preserved — `42501` when an Engineer is not the assignee, #534) on failure: a
 * `using`-denied RLS update is a silent 0-row no-op, so this asserts the row actually came back
 * (`.select('id')`) rather than trusting the absence of `error`.
 *
 * ADR-0056 / AC-CUA-001/030: routes through `dispatchTaskCommand('transition', ...)` when the
 * org's `tasks` domain is externally-owned; fail-closed to the direct DAL below otherwise.
 */
export async function updateTaskStatus(id: string, status: TaskStatus, projectId?: string | null): Promise<void> {
  if (routeTaskWrite(projectId) === 'external') {
    await dispatchTaskCommand('transition', { id, status });
    return;
  }
  const { data, error } = await supabase.from('tasks').update({ status }).eq('id', id).select('id');
  if (error) throwWrite(error);
  assertWriteLanded(data, 'Task not found or you do not have permission to change its status.');
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
  const { data, error } = await supabase
    .from('tasks')
    .update({ archived_at: new Date().toISOString() })
    .eq('id', id)
    .select('id');
  if (error) throwWrite(error);
  assertWriteLanded(data, 'Task not found or you do not have permission to archive it.');
}

export async function unarchiveTask(id: string, projectId?: string): Promise<void> {
  if (routeTaskWrite(projectId) === 'external') {
    throw new AppError('Tasks are managed by the connected task system.', 'external-owned');
  }
  const { data, error } = await supabase.from('tasks').update({ archived_at: null }).eq('id', id).select('id');
  if (error) throwWrite(error);
  assertWriteLanded(data, 'Task not found or you do not have permission to restore it.');
}

export async function deleteTask(id: string, projectId?: string): Promise<void> {
  if (routeTaskWrite(projectId) === 'external') {
    await dispatchTaskCommand('delete', { id });
    return;
  }
  const { data, error } = await supabase.from('tasks').delete().eq('id', id).select('id');
  if (error) throwWrite(error);
  assertWriteLanded(data, 'Task not found or you do not have permission to delete it.');
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
  const { data, error } = await supabase
    .from('task_dependencies')
    .delete()
    .match({ task_id: taskId, depends_on_id: dependsOnId })
    .select('task_id');
  if (error) throwWrite(error);
  assertWriteLanded(data, 'Dependency not found or you do not have permission to remove it.');
}
/**
 * A task row joined with its project name — the shape the My Tasks page consumes.
 * This is a cross-project, assignee-scoped read: the RLS `tasks_select` policy
 * already gates to the org; the server-side `assignee_id = self` filter scopes to own.
 *
 * The plan (B-1) notes: "only add a small DAL helper if needed — do NOT add a new RLS
 * migration". RLS already scopes to the org; the assignee filter is a client-side WHERE.
 */
export interface MyTask {
  id: string;
  name: string;
  status: TaskStatus;
  assignee_id: string | null;
  /** #525: NULL for a task that was never given a project — it is a real state, not missing data. */
  project_id: string | null;
  /** NULL exactly when `project_id` is; the UI renders a heading, not a project link (FR-FCT-041). */
  project_name: string | null;
  /** The contractual title behind a short `project_name` (hover + search). */
  project_contractual_name?: string | null;
  /** Meeting-linked tasks without a project still have a canonical record doorway. */
  meeting_id?: string | null;
  start_date: string | null;
  end_date: string | null;
  /**
   * C13 (DS my-tasks #4): the priority the record already holds — the queue shows it, so two tasks
   * due the same day can be ordered by what the record knows. NULL = no priority set (a real state,
   * never rendered as a made-up "Normal").
   */
  priority: TaskPriority | null;
  /**
   * C13 (DS my-tasks #1): an archived task stays in the assignee's queue (its project hides it), so
   * the row must SAY it is archived instead of looking like ordinary open work.
   */
  archived_at: string | null;
}

/**
 * Fetch all tasks assigned to the signed-in user across projects.
 * org_id is NEVER sent — RLS (tasks_select) scopes to the org. The assignee_id
 * filter is applied by the server along with RLS.
 * The project name is joined via `projects(name)` in the select. Excludes tombstoned rows
 * (`.is('tombstoned_at', null)`, AC-CUA-002/C5c) — a ClickUp-native delete (C3) must not
 * remain in the cross-project My Tasks list either.
 */
export async function listMyTasks(userId: string): Promise<MyTask[]> {
  const data = await fetchAllPages((from, to) => supabase
    .from('tasks')
    .select('id, name, status, assignee_id, project_id, meeting_id, start_date, end_date, priority, archived_at, project:projects!tasks_project_id_fkey(name, short_name)')
    .eq('assignee_id', userId)
    .is('tombstoned_at', null)
    .order('created_at', { ascending: true })
    .order('id', { ascending: true })
    .range(from, to));
  // Map the joined `project` shape onto `project_name`.
  return ((data ?? []) as unknown as Array<{
    id: string;
    name: string;
    status: string;
    assignee_id: string | null;
    project_id: string | null;
    meeting_id: string | null;
    start_date: string | null;
    end_date: string | null;
    priority: TaskPriority | null;
    archived_at: string | null;
    project: { name: string; short_name?: string | null } | null;
  }>).map((t) => ({
    id: t.id,
    name: t.name,
    status: t.status as TaskStatus,
    assignee_id: t.assignee_id,
    project_id: t.project_id,
    meeting_id: t.meeting_id,
    // ⚑ NOT `?? '—'`. A project-less task has no project NAME either, and collapsing that to a dash
    // would make it indistinguishable from a project whose name failed to load — the UI needs to
    // tell them apart to decide between a link and a plain heading (FR-FCT-041).
    project_name: t.project ? projectDisplayName(t.project) : null,
    ...(t.project && projectDisplayName(t.project) !== t.project.name ? { project_contractual_name: t.project.name } : {}),
    start_date: t.start_date,
    end_date: t.end_date,
    priority: t.priority ?? null,
    archived_at: t.archived_at ?? null,
  }));
}
