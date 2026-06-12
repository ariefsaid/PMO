import { useQuery } from '@tanstack/react-query';
import { repositories } from '@/src/lib/repositories';
import { useAuth } from '@/src/auth/useAuth';
import type { ProjectDeliverySummary } from '@/src/lib/db/milestones';

/**
 * Fetches delivery % for a batch of project ids in ONE call (no N+1, NFR-DEL-PERF-001).
 * Returns a Record<project_id, delivery_pct> map. An absent key means no milestones.
 * Disabled when ids is empty (skips the RPC).
 * queryKey: ['projects-delivery', orgId, sorted-ids-joined].
 */
function useProjectsDeliveryQuery<T>(
  ids: string[],
  queryFn: () => Promise<T>,
) {
  const { currentUser } = useAuth();
  const orgId = currentUser?.org_id;
  const key = [...ids].sort().join(',');
  return useQuery<T>({
    queryKey: ['projects-delivery', orgId, key],
    queryFn,
    enabled: Boolean(orgId) && ids.length > 0,
    staleTime: 15_000,
  });
}

export function useProjectsDelivery(ids: string[]) {
  return useProjectsDeliveryQuery<Record<string, number>>(
    ids,
    () => repositories.milestone.deliveryForProjects(ids),
  );
}

export function useProjectsDeliverySummary(ids: string[]) {
  return useProjectsDeliveryQuery<Record<string, ProjectDeliverySummary>>(
    ids,
    () => repositories.milestone.deliverySummaryForProjects(ids),
  );
}
