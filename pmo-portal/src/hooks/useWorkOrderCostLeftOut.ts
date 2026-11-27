import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/src/auth/useAuth';
import { getWorkOrderCostLeftOut } from '@/src/lib/db/workOrderCostLeftOut';

export function useWorkOrderCostLeftOut(workOrderId: string | undefined, enabled = true) {
  const orgId = useAuth().currentUser?.org_id;
  return useQuery({
    queryKey: ['work-order-cost-left-out', orgId, workOrderId],
    queryFn: () => getWorkOrderCostLeftOut(workOrderId as string),
    enabled: enabled && Boolean(orgId) && Boolean(workOrderId),
  });
}
