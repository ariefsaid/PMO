import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { workOrderSectionMaterialRepository as repo } from '@/src/lib/repositories/workOrderSectionMaterials';
import { useOrgId } from '@/src/hooks/useOrgId';
import { useOrgQuery } from '@/src/hooks/useOrgQuery';

/** The work order's live sections for the request form's picker (#2576). */
export function useLiveSections(workOrderId: string | undefined) {
  return useOrgQuery(['work-order-sections', workOrderId, 'live'], () => repo.liveSections(workOrderId as string), { enabled: Boolean(workOrderId) });
}

/** FR-WOS-009: the section's allocation and prior requests per item, shown beside the work order's plan. */
export function useSectionLinePlans(workOrderId: string | undefined, sectionId: string | undefined, itemIds: string[], excludeRequestId?: string | null) {
  const key = [...itemIds].sort();
  return useOrgQuery(
    ['work-order-sections', workOrderId, 'line-plans', sectionId, key, excludeRequestId ?? null],
    () => repo.linePlans(workOrderId as string, sectionId as string, key, excludeRequestId),
    { enabled: Boolean(workOrderId) && Boolean(sectionId) && key.length > 0 },
  );
}

export function useSectionAllocations(workOrderId: string | undefined) {
  return useOrgQuery(['work-order-sections', workOrderId, 'allocations'], () => repo.allocations(workOrderId as string), { enabled: Boolean(workOrderId) });
}

/** FR-WOS-014: plan, requested and remaining per section and item, and for the unsectioned remainder. */
export function useSectionMaterialCheck(workOrderId: string | undefined) {
  const orgId = useOrgId();
  return useQuery({
    queryKey: ['work-order-sections', orgId, workOrderId, 'material-check'],
    queryFn: () => repo.check(workOrderId as string),
    enabled: Boolean(orgId) && Boolean(workOrderId),
    retry: false,
  });
}

export function useSetAllocation(workOrderId: string) {
  const qc = useQueryClient();
  const orgId = useOrgId();
  return useMutation({
    mutationFn: (a: { sectionId: string; itemId: string; quantity: string | null }) => repo.setAllocation(workOrderId, a.sectionId, a.itemId, a.quantity),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['work-order-sections', orgId, workOrderId] }),
  });
}
