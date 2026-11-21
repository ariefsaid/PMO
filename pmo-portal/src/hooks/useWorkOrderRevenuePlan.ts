import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/src/auth/useAuth';
import { workOrderRevenuePlanRepository as repo } from '@/src/lib/repositories/workOrderRevenuePlan';

/** #2671: the organisation's revenue-plan switch (off by default). Keys carry org_id (tenant scope). */
export function useRevenuePlanSettings() {
  const { currentUser } = useAuth();
  const orgId = currentUser?.org_id;
  return useQuery({ queryKey: ['revenue-plan-settings', orgId], queryFn: () => repo.settings(), enabled: Boolean(orgId) });
}

export function useSetRevenuePlanSettings() {
  const qc = useQueryClient();
  const { currentUser } = useAuth();
  return useMutation({
    mutationFn: ({ enabled, weekdays }: { enabled: boolean; weekdays: number[] }) => repo.setSettings(enabled, weekdays),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['revenue-plan-settings', currentUser?.org_id] }),
  });
}

export function useWorkOrderRevenuePlan(workOrderId: string, enabled = true) {
  const { currentUser } = useAuth();
  const orgId = currentUser?.org_id;
  return useQuery({
    queryKey: ['revenue-plan', orgId, 'work-order', workOrderId],
    queryFn: () => repo.forWorkOrder(workOrderId),
    enabled: enabled && Boolean(orgId) && Boolean(workOrderId),
  });
}

export function useProjectRevenuePlan(projectId: string, enabled = true) {
  const { currentUser } = useAuth();
  const orgId = currentUser?.org_id;
  return useQuery({
    queryKey: ['revenue-plan', orgId, 'project', projectId],
    queryFn: () => repo.forProject(projectId),
    enabled: enabled && Boolean(orgId) && Boolean(projectId),
  });
}

/** Every plan write refreshes both reads (the work-order page and the project roll-up show the same figures, AC-WRP-013). */
export function useRevenuePlanMutations() {
  const qc = useQueryClient();
  const { currentUser } = useAuth();
  const invalidate = () => qc.invalidateQueries({ queryKey: ['revenue-plan', currentUser?.org_id] });
  return {
    setDay: useMutation({ mutationFn: (v: { workOrderId: string; date: string; amount: string }) => repo.setDay(v.workOrderId, v.date, v.amount), onSuccess: invalidate }),
    setMonth: useMutation({ mutationFn: (v: { workOrderId: string; month: string; amount: string; keepEdited: boolean }) => repo.setMonth(v.workOrderId, v.month, v.amount, v.keepEdited), onSuccess: invalidate }),
    clear: useMutation({ mutationFn: (v: { workOrderId: string; from: string; to: string }) => repo.clear(v.workOrderId, v.from, v.to), onSuccess: invalidate }),
  };
}
