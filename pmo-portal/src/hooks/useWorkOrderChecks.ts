import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/src/auth/useAuth';
import { repositories } from '@/src/lib/repositories';

/** Every live task on one work order (Done included), oldest first: the checks before it is issued (#2898). */
export function useWorkOrderChecks(projectId: string, workOrderId: string) {
  const orgId = useAuth().currentUser?.org_id;
  return useQuery({
    // Under ['tasks', org, project] so every task write on the project refreshes it.
    queryKey: ['tasks', orgId, projectId, 'work-order-checks', workOrderId],
    queryFn: async () => (await repositories.task.list(projectId, { workOrderId })).filter((task) => !task.archived_at),
    enabled: Boolean(orgId) && Boolean(projectId) && Boolean(workOrderId),
  });
}
