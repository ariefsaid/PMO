import { useQuery } from '@tanstack/react-query';
import { repositories } from '@/src/lib/repositories';
import { useAuth } from '@/src/auth/useAuth';

/**
 * Fetches delivery % for a batch of project ids in ONE call (no N+1, NFR-DEL-PERF-001).
 * Returns a Record<project_id, delivery_pct> map. An absent key means no milestones.
 * Disabled when ids is empty (skips the RPC).
 * queryKey: ['projects-delivery', orgId, sorted-ids-joined].
 */
export function useProjectsDelivery(ids: string[]) {
  const { currentUser } = useAuth();
  const orgId = currentUser?.org_id;
  // Stable key regardless of array reference equality.
  const key = [...ids].sort().join(',');
  return useQuery<Record<string, number>>({
    queryKey: ['projects-delivery', orgId, key],
    queryFn: () => repositories.milestone.deliveryForProjects(ids),
    enabled: Boolean(orgId) && ids.length > 0,
    staleTime: 15_000,
  });
}
