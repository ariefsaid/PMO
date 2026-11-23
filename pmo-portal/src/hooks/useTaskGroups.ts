import { useMutation, useQueryClient } from '@tanstack/react-query';
import { repositories } from '@/src/lib/repositories';
import type { TaskGroupInput, TaskGroupPatch } from '@/src/lib/db/taskGroups';
import { useAuth } from '@/src/auth/useAuth';
import { useOrgQuery } from '@/src/hooks/useOrgQuery';

/** Org-scoped, per-project task groups over the repository seam (#2679). */
export function useTaskGroups(projectId: string) {
  return useOrgQuery(['task-groups', projectId], () => repositories.milestone.listTaskGroups(projectId), { enabled: Boolean(projectId) });
}

/**
 * Create / update / delete a group. A group change can move a phase percentage, so each write also refreshes the
 * milestones, the tasks and the project delivery chips (same invalidation set as the milestone mutations).
 */
export function useTaskGroupMutations(projectId: string) {
  const qc = useQueryClient();
  const { currentUser } = useAuth();
  const orgId = currentUser?.org_id;
  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ['task-groups', orgId, projectId] });
    void qc.invalidateQueries({ queryKey: ['milestones', orgId, projectId] });
    void qc.invalidateQueries({ queryKey: ['tasks', orgId, projectId] });
    void qc.invalidateQueries({ predicate: q => q.queryKey[0] === 'projects-delivery' && q.queryKey[2] === orgId });
  };
  const create = useMutation({
    mutationFn: (input: TaskGroupInput) => repositories.milestone.createTaskGroup(input, projectId),
    onSuccess: invalidate,
  });
  const update = useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: TaskGroupPatch }) => repositories.milestone.updateTaskGroup(id, patch),
    onSuccess: invalidate,
  });
  const remove = useMutation({
    mutationFn: (id: string) => repositories.milestone.deleteTaskGroup(id),
    onSuccess: invalidate,
  });
  return { create, update, remove };
}
