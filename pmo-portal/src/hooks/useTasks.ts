import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { repositories } from '@/src/lib/repositories';
import type { TaskWithRefs, TaskInput, TaskPatch, TaskStatus } from '@/src/lib/db/tasks';
import type { ProfileRow } from '@/src/lib/db/profiles';
import { useAuth } from '@/src/auth/useAuth';

/**
 * Org-scoped, per-project Tasks list over the repository seam (ADR-0017). queryKey includes
 * org_id (tenant scope) + project_id (the parent). Disabled until both org + project are known.
 */
export function useTasks(projectId: string) {
  const { currentUser } = useAuth();
  const orgId = currentUser?.org_id;
  return useQuery<TaskWithRefs[]>({
    queryKey: ['tasks', orgId, projectId],
    queryFn: () => repositories.task.list(projectId),
    enabled: Boolean(orgId) && Boolean(projectId),
  });
}

/**
 * The assignee-picker source: all profiles in the org. Org-scoped query key; lightly cached
 * (people change rarely). Consumed by the Tasks assignee `<Combobox>`.
 */
export function useAssignableProfiles() {
  const { currentUser } = useAuth();
  const orgId = currentUser?.org_id;
  return useQuery<ProfileRow[]>({
    queryKey: ['org-profiles', orgId],
    queryFn: () => repositories.profile.listOrgProfiles(),
    enabled: Boolean(orgId),
    staleTime: 5 * 60_000,
  });
}

export interface UpdateTaskArgs {
  id: string;
  patch: TaskPatch;
}
export interface UpdateTaskStatusArgs {
  id: string;
  status: TaskStatus;
}
export interface DependencyArgs {
  taskId: string;
  dependsOnId: string;
}

/**
 * Task create / update-structure / update-status / delete + dependency add/remove mutations over
 * the repository seam, scoped to one project. Each invalidates the exact `['tasks', org, project]`
 * query on success so the list/board refetches. Errors propagate as `AppError` (code preserved)
 * for the caller to classify via `classifyMutationError`.
 */
export function useTaskMutations(projectId: string) {
  const qc = useQueryClient();
  const { currentUser } = useAuth();
  const orgId = currentUser?.org_id;
  const invalidate = () => qc.invalidateQueries({ queryKey: ['tasks', orgId, projectId] });

  const create = useMutation({
    mutationFn: (input: TaskInput) => repositories.task.create(input),
    onSuccess: invalidate,
  });

  const update = useMutation({
    mutationFn: ({ id, patch }: UpdateTaskArgs) => repositories.task.update(id, patch),
    onSuccess: invalidate,
  });

  const updateStatus = useMutation({
    mutationFn: ({ id, status }: UpdateTaskStatusArgs) => repositories.task.updateStatus(id, status),
    onSuccess: invalidate,
  });

  const remove = useMutation({
    mutationFn: (id: string) => repositories.task.delete(id),
    onSuccess: invalidate,
  });

  const addDependency = useMutation({
    mutationFn: ({ taskId, dependsOnId }: DependencyArgs) =>
      repositories.task.addDependency(taskId, dependsOnId),
    onSuccess: invalidate,
  });

  const removeDependency = useMutation({
    mutationFn: ({ taskId, dependsOnId }: DependencyArgs) =>
      repositories.task.removeDependency(taskId, dependsOnId),
    onSuccess: invalidate,
  });

  return { create, update, updateStatus, remove, addDependency, removeDependency };
}
