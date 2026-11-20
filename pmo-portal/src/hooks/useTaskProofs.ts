import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/src/auth/useAuth';
import { repositories } from '@/src/lib/repositories';
import type { TaskProofRow } from '@/src/lib/db/taskProofs';

/** #2531: the live proof attachments of one task, and the add/remove writes over the repository seam. */
export function useTaskProofs(taskId: string | null | undefined, enabled = true) {
  const { currentUser } = useAuth();
  const orgId = currentUser?.org_id;
  return useQuery<TaskProofRow[]>({
    queryKey: ['task-proofs', orgId, taskId],
    queryFn: () => repositories.taskProof.list(taskId as string),
    enabled: enabled && Boolean(orgId) && Boolean(taskId),
  });
}

export function useTaskProofMutations(taskId: string) {
  const qc = useQueryClient();
  const { currentUser } = useAuth();
  const orgId = currentUser?.org_id;
  const refresh = () => void qc.invalidateQueries({ queryKey: ['task-proofs', orgId, taskId] });
  const add = useMutation({
    mutationFn: ({ file, liveCount }: { file: File; liveCount: number }) =>
      repositories.taskProof.add(taskId, file, liveCount),
    onSuccess: refresh,
  });
  const remove = useMutation({
    mutationFn: (proofId: string) => repositories.taskProof.remove(proofId),
    onSuccess: refresh,
  });
  return { add, remove };
}
