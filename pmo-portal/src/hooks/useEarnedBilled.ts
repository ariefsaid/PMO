import { useQueries, useQuery } from '@tanstack/react-query';
import { useAuth } from '@/src/auth/useAuth';
import { earnedBilledRepository } from '@/src/lib/repositories/earnedBilled';
import { workOrderFinanceRepository } from '@/src/lib/repositories/workOrderFinance';
import { useOrgQuery } from '@/src/hooks/useOrgQuery';

/** #2733: earned and billed per work order; only asked for while the organisation setting is on. */
export const workOrderEarnedBilledQuery = (orgId: string | undefined, projectId: string, enabled = true) => ({
  queryKey: ['earned-billed', orgId, projectId],
  queryFn: () => earnedBilledRepository.workOrders(projectId),
  enabled: enabled && Boolean(orgId) && Boolean(projectId),
});

export function useWorkOrderEarnedBilled(projectId: string, enabled: boolean) {
  return useQuery(workOrderEarnedBilledQuery(useAuth().currentUser?.org_id, projectId, enabled));
}

/** #2733: earned revenue per project for the management pack. */
export function usePackEarned(enabled: boolean) {
  return useOrgQuery(['pack-earned'], () => earnedBilledRepository.packEarned(), { enabled });
}

/**
 * The pack's margin cost is the project's own plan-versus-actual roll-up (the same query, the same cache key as the project
 * tab), so the pack and the tab never disagree. One query per project that has earned revenue.
 */
export function usePackRollups(projectIds: readonly string[], enabled: boolean) {
  const { currentUser } = useAuth();
  const orgId = currentUser?.org_id;
  return useQueries({
    queries: projectIds.map((projectId) => ({
      queryKey: ['work-order-plan-vs-actual', orgId, projectId],
      queryFn: () => workOrderFinanceRepository.projectPlanVsActual(projectId),
      enabled: enabled && Boolean(orgId),
    })),
  });
}
