import { useQuery } from '@tanstack/react-query';
import { repositories } from '@/src/lib/repositories';
import { useAuth } from '@/src/auth/useAuth';
import type { ProjectDeliverySummary } from '@/src/lib/db/milestones';

/**
 * Fetches delivery data for a batch of project ids in ONE call (no N+1, NFR-DEL-PERF-001).
 * The `variant` discriminator (`'pct'` | `'summary'`) is included in the query key so that
 * `useProjectsDelivery` (Record<string,number>) and `useProjectsDeliverySummary`
 * (Record<string,ProjectDeliverySummary>) never collide in the React-Query cache —
 * they return different shapes but previously shared the same key (B-0.1 cache-key bug).
 * queryKey: ['projects-delivery', variant, orgId, sorted-ids-joined].
 */
function useProjectsDeliveryQuery<T>(
  variant: 'pct' | 'summary',
  ids: string[],
  queryFn: () => Promise<T>,
) {
  const { currentUser } = useAuth();
  const orgId = currentUser?.org_id;
  const key = [...ids].sort().join(',');
  return useQuery<T>({
    queryKey: ['projects-delivery', variant, orgId, key],
    queryFn,
    enabled: Boolean(orgId) && ids.length > 0,
    staleTime: 15_000,
  });
}

export function useProjectsDelivery(ids: string[]) {
  return useProjectsDeliveryQuery<Record<string, number>>(
    'pct',
    ids,
    () => repositories.milestone.deliveryForProjects(ids),
  );
}

export function useProjectsDeliverySummary(ids: string[]) {
  return useProjectsDeliveryQuery<Record<string, ProjectDeliverySummary>>(
    'summary',
    ids,
    () => repositories.milestone.deliverySummaryForProjects(ids),
  );
}
