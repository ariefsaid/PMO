import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/src/auth/useAuth';
import { workOrderDailyTargetRepository as repo } from '@/src/lib/repositories/workOrderDailyTarget';
import { useOrgQuery } from '@/src/hooks/useOrgQuery';

/**
 * #2672. Keys carry org_id (tenant scope) and sit under the `revenue-plan` prefix, so every plan write of #2671
 * (`useRevenuePlanMutations`) refreshes the daily target too: the day view, the roll-up and the plan always agree.
 */
export function useWorkOrderDailyTarget(workOrderId: string, asOf: string | null, enabled = true) {
  return useOrgQuery(['revenue-plan', 'daily-target', 'work-order', workOrderId, asOf], () => repo.forWorkOrder(workOrderId, asOf), { enabled: enabled && Boolean(workOrderId) });
}

export function useProjectDailyTarget(projectId: string, enabled = true) {
  return useOrgQuery(['revenue-plan', 'daily-target', 'project', projectId], () => repo.forProject(projectId), { enabled: enabled && Boolean(projectId) });
}

export function useNonWorkingDates(enabled = true) {
  return useOrgQuery(['non-working-dates'], () => repo.nonWorkingDates(), { enabled });
}

/** Editing the list refreshes the list and every daily-target read (the day markers and working-day counts change). */
export function useNonWorkingDateMutations() {
  const qc = useQueryClient();
  const { currentUser } = useAuth();
  const invalidate = () => Promise.all([
    qc.invalidateQueries({ queryKey: ['non-working-dates', currentUser?.org_id] }),
    qc.invalidateQueries({ queryKey: ['revenue-plan', currentUser?.org_id] }),
  ]);
  return {
    add: useMutation({ mutationFn: (v: { date: string; label: string }) => repo.addNonWorkingDate(v.date, v.label), onSuccess: invalidate }),
    remove: useMutation({ mutationFn: (v: { date: string }) => repo.removeNonWorkingDate(v.date), onSuccess: invalidate }),
  };
}
