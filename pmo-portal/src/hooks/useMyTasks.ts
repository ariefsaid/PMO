import { invalidateTaskProjections } from './taskQueryKeys';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/src/auth/useAuth';
import type { MyTask, TaskStatus } from '@/src/lib/db/tasks';
import { repositories } from '@/src/lib/repositories';
import { toAppError } from '@/src/lib/appError';
export type { MyTask } from '@/src/lib/db/tasks';

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
    queryFn: () => repositories.task.listByAssignee(userId!),
    enabled: Boolean(userId) && Boolean(orgId),
  });
}

/**
 * Status mutation for an Engineer's own task — routed through the task repository so this write
 * inherits the ADR-0056 `routeTaskWrite()` seam + pending-push behavior instead of bypassing
 * `dispatchTaskCommand` when the org's `tasks` domain is externally-owned (AC-CUA-001/060/061).
 * PMO-owned orgs (the fail-closed default) keep the exact pre-P1 direct-DAL path (assignee-only
 * column-pinned RLS, migration 0016).
 */
export function useMyTaskMutations() {
  const qc = useQueryClient();
  const { currentUser } = useAuth();
  const orgId = currentUser?.org_id;
  const invalidate = (_data: unknown, vars: { projectId?: string | null }) => invalidateTaskProjections(qc, orgId, vars.projectId);

  const updateStatus = useMutation({
    mutationFn: async ({ id, status, projectId }: { id: string; status: TaskStatus; projectId?: string | null }) => {
      try {
        await repositories.task.updateStatus(id, status, projectId);
      } catch (err) {
        throw toAppError(err);
      }
    },
    onSuccess: invalidate,
  });

  return { updateStatus };
}
