import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/src/auth/useAuth';
import { workOrderCostRepository } from '@/src/lib/repositories/workOrderCosts';

/** The org's live discipline list (#2517) — the cost forms' discipline picker. */
export function useCostDisciplines(enabled = true) {
  const { currentUser } = useAuth();
  const orgId = currentUser?.org_id;
  return useQuery({
    queryKey: ['cost-disciplines', orgId],
    queryFn: () => workOrderCostRepository.disciplines(),
    enabled: enabled && Boolean(orgId),
    staleTime: 5 * 60 * 1000,
  });
}

/** One work order's cost lines grouped by source (#2517 read seam; #2518/#2519/#2523 build on it). */
export function useWorkOrderCostLines(workOrderId: string | null) {
  const { currentUser } = useAuth();
  const orgId = currentUser?.org_id;
  return useQuery({
    queryKey: ['work-order-cost-lines', orgId, workOrderId],
    queryFn: () => workOrderCostRepository.costLinesBySource(workOrderId as string),
    enabled: Boolean(orgId) && Boolean(workOrderId),
  });
}
