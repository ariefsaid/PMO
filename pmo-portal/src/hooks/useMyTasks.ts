import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/src/lib/supabase/client';
import { useAuth } from '@/src/auth/useAuth';
import { updateTaskStatus, type TaskStatus } from '@/src/lib/db/tasks';
import { toAppError } from '@/src/lib/appError';

/**
 * A task row joined with its project name — the shape the My Tasks page consumes.
 * This is a cross-project, assignee-scoped read: the RLS `tasks_select` policy
 * already gates to the org; the client-side `assignee_id = self` filter scopes to own.
 * No new RLS migration is needed — org-scoped rows are already returned, and we filter
 * on assignee_id client-side (a simple equality filter on a column we own).
 *
 * The plan (B-1) notes: "only add a small DAL helper if needed — do NOT add a new RLS
 * migration". RLS already scopes to the org; the assignee filter is a client-side WHERE.
 */
export interface MyTask {
  id: string;
  name: string;
  status: TaskStatus;
  assignee_id: string | null;
  project_id: string;
  project_name: string;
  start_date: string | null;
  end_date: string | null;
}

/**
 * Fetch all tasks assigned to the signed-in user across projects.
 * org_id is NEVER sent — RLS (tasks_select) scopes to the org. The assignee_id
 * filter is applied client-side after the RLS-scoped result set (no new policy needed).
 * The project name is joined via `projects(name)` in the select. Excludes tombstoned rows
 * (`.is('tombstoned_at', null)`, AC-CUA-002/C5c) — a ClickUp-native delete (C3) must not
 * remain in the cross-project My Tasks list either.
 */
async function listMyTasks(userId: string): Promise<MyTask[]> {
  const { data, error } = await supabase
    .from('tasks')
    .select('id, name, status, assignee_id, project_id, start_date, end_date, project:projects!tasks_project_id_fkey(name)')
    .eq('assignee_id', userId)
    .is('tombstoned_at', null)
    .order('created_at', { ascending: true });
  if (error) throw toAppError(error);
  // Map the joined `project` shape onto `project_name`.
  return ((data ?? []) as unknown as Array<{
    id: string;
    name: string;
    status: string;
    assignee_id: string | null;
    project_id: string;
    start_date: string | null;
    end_date: string | null;
    project: { name: string } | null;
  }>).map((t) => ({
    id: t.id,
    name: t.name,
    status: t.status as TaskStatus,
    assignee_id: t.assignee_id,
    project_id: t.project_id,
    project_name: t.project?.name ?? '—',
    start_date: t.start_date,
    end_date: t.end_date,
  }));
}

/**
 * B-1: own-assigned cross-project task list.
 * Org-scoped by RLS (no org_id needed client-side); assignee-scoped by the
 * server-side eq('assignee_id', userId) filter. Disabled until userId is known.
 */
export function useMyTasks() {
  const { currentUser } = useAuth();
  const userId = currentUser?.id;
  const orgId = currentUser?.org_id;
  return useQuery<MyTask[]>({
    queryKey: ['my-tasks', orgId, userId],
    queryFn: () => listMyTasks(userId!),
    enabled: Boolean(userId) && Boolean(orgId),
  });
}

/**
 * Status mutation for an Engineer's own task — routed through the `updateTaskStatus` DAL helper
 * (`db/tasks.ts`), not a raw `supabase.from('tasks').update(...)` call, so this quick-status write
 * inherits the ADR-0056 `routeTaskWrite()` seam + pending-push behavior instead of bypassing
 * `dispatchTaskCommand` when the org's `tasks` domain is externally-owned (AC-CUA-001/060/061).
 * PMO-owned orgs (the fail-closed default) keep the exact pre-P1 direct-DAL path (assignee-only
 * column-pinned RLS, migration 0016).
 */
export function useMyTaskMutations() {
  const qc = useQueryClient();
  const { currentUser } = useAuth();
  const orgId = currentUser?.org_id;
  const userId = currentUser?.id;
  const invalidate = () => qc.invalidateQueries({ queryKey: ['my-tasks', orgId, userId] });

  const updateStatus = useMutation({
    mutationFn: async ({ id, status, projectId }: { id: string; status: TaskStatus; projectId?: string }) => {
      try {
        await updateTaskStatus(id, status, projectId);
      } catch (err) {
        throw toAppError(err);
      }
    },
    onSuccess: invalidate,
  });

  return { updateStatus };
}
