import { useQuery } from '@tanstack/react-query';
import { repositories } from '@/src/lib/repositories';
import { useAuth } from '@/src/auth/useAuth';

/** One work order by id for its record page (#2518); null = absent / another org / unreadable (RLS). */
export function useWorkOrder(id: string | undefined) {
  const orgId = useAuth().currentUser?.org_id;
  return useQuery({
    queryKey: ['work-order', orgId, id],
    queryFn: () => repositories.workOrder.get(id as string),
    enabled: Boolean(orgId) && Boolean(id),
  });
}

/** This work order's BoQ allocations. */
export function useWorkOrderAllocations(id: string | undefined) {
  const orgId = useAuth().currentUser?.org_id;
  return useQuery({
    queryKey: ['work-order-lines', orgId, 'wo', id],
    queryFn: () => repositories.workOrderAcceptance.listLines(id as string),
    enabled: Boolean(orgId) && Boolean(id),
  });
}
