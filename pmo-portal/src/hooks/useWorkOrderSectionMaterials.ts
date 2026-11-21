import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/src/auth/useAuth';
import { workOrderSectionMaterialRepository as repo } from '@/src/lib/repositories/workOrderSectionMaterials';

const useOrgId = (): string | undefined => useAuth().currentUser?.org_id;

/** The work order's live sections for the request form's picker (#2576). */
export function useLiveSections(workOrderId: string | undefined) {
  const orgId = useOrgId();
  return useQuery({
    queryKey: ['work-order-sections', orgId, workOrderId, 'live'],
    queryFn: () => repo.liveSections(workOrderId as string),
    enabled: Boolean(orgId) && Boolean(workOrderId),
  });
}

/** FR-WOS-009: the section's allocation and prior requests per item, shown beside the work order's plan. */
export function useSectionLinePlans(workOrderId: string | undefined, sectionId: string | undefined, itemIds: string[], excludeRequestId?: string | null) {
  const orgId = useOrgId();
  const key = [...itemIds].sort();
  return useQuery({
    queryKey: ['work-order-sections', orgId, workOrderId, 'line-plans', sectionId, key, excludeRequestId ?? null],
    queryFn: () => repo.linePlans(workOrderId as string, sectionId as string, key, excludeRequestId),
    enabled: Boolean(orgId) && Boolean(workOrderId) && Boolean(sectionId) && key.length > 0,
  });
}

export function useSectionAllocations(workOrderId: string | undefined) {
  const orgId = useOrgId();
  return useQuery({
    queryKey: ['work-order-sections', orgId, workOrderId, 'allocations'],
    queryFn: () => repo.allocations(workOrderId as string),
    enabled: Boolean(orgId) && Boolean(workOrderId),
  });
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
