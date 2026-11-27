import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/src/auth/useAuth';
import { useOrgQuery } from '@/src/hooks/useOrgQuery';
import { ownerMaterialRepository as repo } from '@/src/lib/repositories/ownerMaterial';

/** Owner-supplied material (#3010). Keys carry org_id; one root so a save invalidates the stage table and the rollup together. */
const ROOT = 'owner-material';

export function useMaterialLines(workOrderId: string | undefined, sectionId: string | null, page: number) {
  return useOrgQuery([ROOT, 'lines', workOrderId, sectionId, page], () => repo.lines(workOrderId as string, sectionId, page), { enabled: Boolean(workOrderId && sectionId), staleness: 'live' });
}
export function useMaterialRollup(projectId: string | undefined, page: number) {
  return useOrgQuery([ROOT, 'rollup', projectId, page], () => repo.rollup(projectId as string, page), { enabled: Boolean(projectId), staleness: 'live' });
}
/** The owner's order number and ours for the work orders on one rollup page. */
export function useOrderNumbers(ids: string[]) {
  return useOrgQuery([ROOT, 'order-numbers', ids.join(',')], () => repo.orderNumbers(ids), { enabled: ids.length > 0, staleness: 'live' });
}
export function useMaterialConfig() {
  return useOrgQuery([ROOT, 'config'], () => repo.config(), { staleness: 'session' });
}
/** Each location of one work order: its stage percentages and current reconciliation step (one read). */
export function useSectionStages(workOrderId: string | undefined) {
  return useOrgQuery([ROOT, 'sections', workOrderId], () => repo.sectionStages(workOrderId as string), { enabled: Boolean(workOrderId), staleness: 'live' });
}
export function useSetReconciliation() {
  const qc = useQueryClient();
  const orgId = useAuth().currentUser?.org_id;
  return useMutation({
    mutationFn: ({ sectionId, stepId, reason }: { sectionId: string; stepId: string; reason: string | null }) => repo.setReconciliation(sectionId, stepId, reason),
    // The stage table and the Work Orders rollup read the same step: both go stale together.
    onSuccess: () => qc.invalidateQueries({ queryKey: [ROOT, orgId] }),
  });
}
