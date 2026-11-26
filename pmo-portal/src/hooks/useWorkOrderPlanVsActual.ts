import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/src/auth/useAuth';
import { workOrderFinanceRepository, type PlanChange } from '@/src/lib/repositories/workOrderFinance';
import type { SplitPercent } from '@/src/lib/workOrderPlanVsActual';

/** #2519: one project's plan versus actual per work order and discipline. Keys carry org_id (tenant scope). */
export function useProjectPlanVsActual(projectId: string, enabled = true) {
  const { currentUser } = useAuth();
  const orgId = currentUser?.org_id;
  return useQuery({
    queryKey: ['work-order-plan-vs-actual', orgId, projectId],
    queryFn: () => workOrderFinanceRepository.projectPlanVsActual(projectId),
    enabled: enabled && Boolean(orgId) && Boolean(projectId),
  });
}

function useInvalidate() {
  const qc = useQueryClient();
  const { currentUser } = useAuth();
  return () => qc.invalidateQueries({ queryKey: ['work-order-plan-vs-actual', currentUser?.org_id] });
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
