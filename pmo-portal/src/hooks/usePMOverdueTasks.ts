import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/src/auth/useAuth';
import { repositories } from '@/src/lib/repositories';

/** Observe the shared batched overdue-task read so the PM tile can use its own loading/error state. */
export function usePMOverdueTasks(projectIds: string[], projectsLoaded: boolean) {
  const { currentUser } = useAuth();
  const orgId = currentUser?.org_id;

  return useQuery({
    queryKey: ['pm-overdue-tasks', orgId, projectIds],
    queryFn: () => repositories.task.listDueRows(projectIds),
    enabled: Boolean(orgId && projectsLoaded),
  });
}
