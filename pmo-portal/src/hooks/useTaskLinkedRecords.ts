import { repositories } from '@/src/lib/repositories';
import type { TaskLinkedRecord } from '@/src/lib/db/tasks';
import { useOrgQuery } from '@/src/hooks/useOrgQuery';

/**
 * #2587: the live status of the records behind a page of tasks — ONE query for the page (NFR-RLT-001), keyed by the
 * sorted ids so a list that re-renders with the same tasks does not refetch. Pass only the ids of tasks that carry a
 * link; an empty list makes no request.
 */
export function useTaskLinkedRecords(linkedTaskIds: readonly string[]) {
  const ids = [...new Set(linkedTaskIds)].sort();
  return useOrgQuery<Map<string, TaskLinkedRecord>>(['task-linked-records', ids], () => repositories.task.linkedRecords(ids), { enabled: ids.length > 0 });
}
