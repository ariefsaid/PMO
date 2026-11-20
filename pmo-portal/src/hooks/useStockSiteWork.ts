import { useQuery } from '@tanstack/react-query';
import { stockSiteWorkRepository } from '@/src/lib/repositories/stockSiteWork';
import { useAuth } from '@/src/auth/useAuth';

/** The org's stock tags (#2523). The tag's name is data: screens render it, never a hardcoded word for client-supplied stock. */
export function useStockTags(includeArchived = false, enabled = true) {
  const orgId = useAuth().currentUser?.org_id;
  return useQuery({ queryKey: ['stock-tags', orgId, includeArchived], queryFn: () => stockSiteWorkRepository.tags.list(includeArchived), enabled: Boolean(orgId) && enabled });
}
/** Stock held for one work order (or every bucket of a project). An empty array is "nothing moved yet". */
export function useWorkOrderStockBalance(f: { workOrderId?: string; projectId?: string }) {
  const orgId = useAuth().currentUser?.org_id;
  return useQuery({
    queryKey: ['wo-stock-balance', orgId, f.workOrderId ?? null, f.projectId ?? null],
    queryFn: () => stockSiteWorkRepository.balance(f),
    enabled: Boolean(orgId) && Boolean(f.workOrderId || f.projectId),
  });
}
