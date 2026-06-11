import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { repositories } from '@/src/lib/repositories';
import type { MilestoneInput, MilestonePatch } from '@/src/lib/db/milestones';
import { useAuth } from '@/src/auth/useAuth';

/**
 * Org-scoped, per-project milestone list over the repository seam (ADR-0017).
 * queryKey includes org_id (tenant scope) + project_id (the parent).
 * Disabled until both org + project are known.
 */
export function useMilestones(projectId: string) {
  const { currentUser } = useAuth();
  const orgId = currentUser?.org_id;
  return useQuery({
    queryKey: ['milestones', orgId, projectId],
    queryFn: () => repositories.milestone.list(projectId),
    enabled: Boolean(orgId) && Boolean(projectId),
  });
}

interface CreateMilestoneArgs {
  input: MilestoneInput;
}
interface UpdateMilestoneArgs {
  id: string;
  patch: MilestonePatch;
}
interface SetTaskMilestoneArgs {
  taskId: string;
  milestoneId: string | null;
}

/**
 * Milestone create / update / delete + task-milestone assignment mutations.
 * Each mutation invalidates: milestones, tasks (milestone change re-groups tasks),
 * projects (list cache), and projects-delivery (chip refresh).
 */
export function useMilestoneMutations(projectId: string) {
  const qc = useQueryClient();
  const { currentUser } = useAuth();
  const orgId = currentUser?.org_id;

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ['milestones', orgId, projectId] });
    void qc.invalidateQueries({ queryKey: ['tasks', orgId, projectId] });
    void qc.invalidateQueries({ queryKey: ['projects'] });
    void qc.invalidateQueries({ queryKey: ['projects-delivery'] });
  };

  const create = useMutation({
    mutationFn: ({ input }: CreateMilestoneArgs) =>
      repositories.milestone.create(input, projectId),
    onSuccess: invalidate,
  });

  const update = useMutation({
    mutationFn: ({ id, patch }: UpdateMilestoneArgs) =>
      repositories.milestone.update(id, patch),
    onSuccess: invalidate,
  });

  const remove = useMutation({
    mutationFn: (id: string) => repositories.milestone.delete(id),
    onSuccess: invalidate,
  });

  const setTaskMilestone = useMutation({
    mutationFn: ({ taskId, milestoneId }: SetTaskMilestoneArgs) =>
      repositories.milestone.setTaskMilestone(taskId, milestoneId),
    onSuccess: invalidate,
  });

  return { create, update, remove, setTaskMilestone };
}
