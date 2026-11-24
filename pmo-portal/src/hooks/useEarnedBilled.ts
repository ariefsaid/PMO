import { earnedBilledRepository } from '@/src/lib/repositories/earnedBilled';
import { useOrgQuery } from '@/src/hooks/useOrgQuery';

/** #2733: earned and billed per work order; only asked for while the organisation setting is on. */
export function useWorkOrderEarnedBilled(projectId: string, enabled: boolean) {
  return useOrgQuery(['earned-billed', projectId], () => earnedBilledRepository.workOrders(projectId), { enabled: enabled && Boolean(projectId) });
}

/** #2733: earned revenue per project for the management pack. */
export function usePackEarned(enabled: boolean) {
  return useOrgQuery(['work-order-plan-vs-actual', 'pack-earned'], () => earnedBilledRepository.packEarned(), { enabled });
}
