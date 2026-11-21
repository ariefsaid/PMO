import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/src/auth/useAuth';
import { workOrderDailyTargetRepository as repo } from '@/src/lib/repositories/workOrderDailyTarget';

/**
 * #2672. Keys carry org_id (tenant scope) and sit under the `revenue-plan` prefix, so every plan write of #2671
 * (`useRevenuePlanMutations`) refreshes the daily target too: the day view, the roll-up and the plan always agree.
 */
export function useWorkOrderDailyTarget(workOrderId: string, asOf: string | null, enabled = true) {
  const { currentUser } = useAuth();
  const orgId = currentUser?.org_id;
  return useQuery({
    queryKey: ['revenue-plan', orgId, 'daily-target', 'work-order', workOrderId, asOf],
    queryFn: () => repo.forWorkOrder(workOrderId, asOf),
    enabled: enabled && Boolean(orgId) && Boolean(workOrderId),
  });
}

export function useProjectDailyTarget(projectId: string, enabled = true) {
  const { currentUser } = useAuth();
  const orgId = currentUser?.org_id;
  return useQuery({
    queryKey: ['revenue-plan', orgId, 'daily-target', 'project', projectId],
    queryFn: () => repo.forProject(projectId),
    enabled: enabled && Boolean(orgId) && Boolean(projectId),
  });
}

export function useNonWorkingDates(enabled = true) {
  const { currentUser } = useAuth();
  const orgId = currentUser?.org_id;
  return useQuery({ queryKey: ['non-working-dates', orgId], queryFn: () => repo.nonWorkingDates(), enabled: enabled && Boolean(orgId) });
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
