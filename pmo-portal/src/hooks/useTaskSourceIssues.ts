import { repositories } from '@/src/lib/repositories';
import { useOrgQuery } from '@/src/hooks/useOrgQuery';

/**
 * JOB-F17: the issue each of a page of tasks was made from — ONE read for the page (the linked-status idiom,
 * useTaskLinkedRecords), keyed by the sorted ids so a list that re-renders with the same tasks does not refetch.
 * Pass only the ids the page renders; an empty list makes no request. A task with no source issue is absent.
 */
export function useTaskSourceIssues(taskIds: readonly string[]) {
  const ids = [...new Set(taskIds)].sort();
  return useOrgQuery<Map<string, string>>(['task-source-issues', ids], () => repositories.task.sourceIssues(ids), { enabled: ids.length > 0 });
}
