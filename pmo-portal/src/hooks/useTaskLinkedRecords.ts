import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/src/auth/useAuth';
import { repositories } from '@/src/lib/repositories';
import type { TaskLinkedRecord } from '@/src/lib/db/tasks';

/**
 * #2587: the live status of the records behind a page of tasks — ONE query for the page (NFR-RLT-001), keyed by the
 * sorted ids so a list that re-renders with the same tasks does not refetch. Pass only the ids of tasks that carry a
 * link; an empty list makes no request.
 */
export function useTaskLinkedRecords(linkedTaskIds: readonly string[]) {
  const { currentUser } = useAuth();
  const orgId = currentUser?.org_id;
  const ids = [...new Set(linkedTaskIds)].sort();
  return useQuery<Map<string, TaskLinkedRecord>>({
    queryKey: ['task-linked-records', orgId, ids],
    queryFn: () => repositories.task.linkedRecords(ids),
    enabled: Boolean(orgId) && ids.length > 0,
  });
}
