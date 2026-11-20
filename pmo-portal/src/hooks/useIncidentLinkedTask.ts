import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/src/auth/useAuth';
import { repositories } from '@/src/lib/repositories';

/** Resolve the task itself: its project may differ if the issue has since moved. */
export function useIncidentLinkedTask(taskId: string) {
  const { currentUser } = useAuth();
  return useQuery({
    queryKey: ['task', currentUser?.org_id, taskId],
    queryFn: () => repositories.task.get(taskId),
    enabled: Boolean(currentUser?.org_id && taskId),
  });
}
