import { projectPlanVsActualQuery } from '@/src/lib/routeQueries/useWorkOrderPlanVsActual';
export { projectPlanVsActualQuery } from '@/src/lib/routeQueries/useWorkOrderPlanVsActual';
import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useAuth } from '@/src/auth/useAuth';
import { workOrderFinanceRepository, type PlanChange } from '@/src/lib/repositories/workOrderFinance';
import type { SplitPercent } from '@/src/lib/workOrderPlanVsActual';

/** #2519: one project's plan versus actual per work order and discipline. Keys carry org_id (tenant scope). */

export function useProjectPlanVsActual(projectId: string, enabled = true) {
  return useQuery(projectPlanVsActualQuery(useAuth().currentUser?.org_id, projectId, enabled));
}

/** Refresh every project-money consumer in this organisation. */
export function invalidateProjectPlanVsActual(qc: QueryClient, orgId: string | undefined) {
  return qc.invalidateQueries({ queryKey: ['work-order-plan-vs-actual', orgId] });
}

function useInvalidate() {
  const qc = useQueryClient();
  const { currentUser } = useAuth();
  return () => invalidateProjectPlanVsActual(qc, currentUser?.org_id);
}

export function useSaveWorkOrderPlan(projectId: string) {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: ({ workOrderId, changes }: { workOrderId: string; changes: PlanChange[] }) =>
      workOrderFinanceRepository.setPlan(projectId, workOrderId, changes),
    onSuccess: invalidate,
  });
}

export function useSetSharedSplit(projectId: string) {
  const invalidate = useInvalidate();
  return useMutation({ mutationFn: (split: SplitPercent[]) => workOrderFinanceRepository.setSplit(projectId, split), onSuccess: invalidate });
}

export function useClearSharedSplit(projectId: string) {
  const invalidate = useInvalidate();
  return useMutation({ mutationFn: () => workOrderFinanceRepository.clearSplit(projectId), onSuccess: invalidate });
}
