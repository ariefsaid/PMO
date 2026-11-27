import { workOrderEarnedBilledQuery } from '@/src/lib/routeQueries/useEarnedBilled';
export { workOrderEarnedBilledQuery } from '@/src/lib/routeQueries/useEarnedBilled';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/src/auth/useAuth';
import { earnedBilledRepository } from '@/src/lib/repositories/earnedBilled';
import { workOrderFinanceRepository } from '@/src/lib/repositories/workOrderFinance';
import { useOrgQuery } from '@/src/hooks/useOrgQuery';

/** #2733: earned and billed per work order; only asked for while the organisation setting is on. */

export function useWorkOrderEarnedBilled(projectId: string, enabled: boolean) {
  return useQuery(workOrderEarnedBilledQuery(useAuth().currentUser?.org_id, projectId, enabled));
}

/** #2733: earned revenue per project for the management pack. */
export function usePackEarned(enabled: boolean) {
  return useOrgQuery(['pack-earned'], () => earnedBilledRepository.packEarned(), { enabled });
}

/** One source read; every project still uses the project tab's parsers and rollup. */
export function usePackRollups(projectIds: readonly string[], enabled: boolean) {
  const { currentUser } = useAuth();
  const query = useQuery({
    queryKey: ['work-order-plan-vs-actual', currentUser?.org_id, 'pack', projectIds],
    queryFn: () => workOrderFinanceRepository.projectsPlanVsActual(projectIds),
    enabled: enabled && Boolean(currentUser?.org_id) && projectIds.length > 0,
  });
  return projectIds.map((id) => {
    const value = query.data?.[id];
    const localError = value instanceof Error;
    return { ...query, data: localError ? undefined : value, isError: query.isError || localError,
      isSuccess: query.isSuccess && !localError, isBatchError: query.isError };
  });
}
