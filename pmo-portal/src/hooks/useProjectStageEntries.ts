import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/src/auth/useAuth';
import { invalidateProjectProjections } from '@/src/hooks/projectQueryKeys';
import { repositories } from '@/src/lib/repositories';
import type { ProjectStatus } from '@/src/lib/db/projectTransitions';

export function useProjectStageEntries(projectId: string) {
  const { currentUser } = useAuth();
  const orgId = currentUser?.org_id;
  return useQuery({
    queryKey: ['project-stage-entries', orgId, projectId],
    queryFn: () => repositories.projectStage.list(projectId),
    enabled: Boolean(orgId && projectId),
  });
}

export function useStageEntryMutations() {
  const qc = useQueryClient();
  const { currentUser } = useAuth();
  // A re-date can move contract_date / decided_at (Signed / Lost), so every project projection refreshes.
  const settle = () => invalidateProjectProjections(qc, currentUser?.org_id);
  return {
    redate: useMutation({
      mutationFn: (v: { entryId: string; enteredOn: string }) => repositories.projectStage.redate(v.entryId, v.enteredOn),
      onSuccess: settle,
    }),
    addSkipped: useMutation({
      mutationFn: (v: { beforeEntryId: string; stage: ProjectStatus; enteredOn: string }) =>
        repositories.projectStage.addSkipped(v.beforeEntryId, v.stage, v.enteredOn),
      onSuccess: settle,
    }),
  };
}
