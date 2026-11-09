import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { equipmentRepository } from '@/src/lib/repositories/equipment';
import { useAuth } from '@/src/auth/useAuth';
import type { CostingDraft, UsageInput, UsageStatus } from '@/src/lib/db/equipment';

/**
 * Equipment usage and allocation (#1519 S5) over the repository seam (ADR-0017). Keys carry org_id (tenant scope).
 *
 * Every write invalidates every equipment read AND `project-finances` — a logged hour, an approval or a costing setting
 * moves what a project's actuals say (OQ-3), and the two screens sit side by side. `useProjectFinances` exports no root
 * constant, so the literal first key segment is the prefix we invalidate.
 */
export const EQUIPMENT_QUERY_ROOTS = ['equipment-assets', 'equipment-usage', 'equipment-usage-totals', 'equipment-costing',
  'equipment-allocations'] as const;
const PROJECT_FINANCES_ROOT = 'project-finances';

const useOrgId = (): string | undefined => useAuth().currentUser?.org_id;
/** A totals/allocations read names an asset OR a project: the RPCs require one and refuse a bare range (22023). */
const namesOne = (q: { assetId?: string; projectId?: string }): boolean => Boolean(q.assetId || q.projectId);

export function useEquipmentAssets() {
  const orgId = useOrgId();
  return useQuery({ queryKey: ['equipment-assets', orgId], queryFn: () => equipmentRepository.listAssets(), enabled: Boolean(orgId) });
}
export function useEquipmentUsage(range: { from: string; to: string; assetId?: string; projectId?: string; status?: UsageStatus }) {
  const orgId = useOrgId();
  return useQuery({
    queryKey: ['equipment-usage', orgId, range],
    queryFn: () => equipmentRepository.listUsage(range),
    enabled: Boolean(orgId && range.from && range.to),
  });
}
export function useEquipmentUsageTotals(q: { projectId?: string; assetId?: string; from: string; to: string }) {
  const orgId = useOrgId();
  return useQuery({
    queryKey: ['equipment-usage-totals', orgId, q],
    queryFn: () => equipmentRepository.listUsageTotals(q),
    enabled: Boolean(orgId && q.from && q.to) && namesOne(q),
  });
}
export function useEquipmentCosting(includeHistory = false) {
  const orgId = useOrgId();
  return useQuery({
    queryKey: ['equipment-costing', orgId, includeHistory],
    queryFn: () => equipmentRepository.listCosting(includeHistory),
    enabled: Boolean(orgId),
  });
}
export function useEquipmentAllocations(q: { assetId?: string; projectId?: string; from: string; to: string }) {
  const orgId = useOrgId();
  return useQuery({
    queryKey: ['equipment-allocations', orgId, q],
    queryFn: () => equipmentRepository.listAllocations(q),
    enabled: Boolean(orgId && q.from && q.to) && namesOne(q),
  });
}

/** Every write refreshes every equipment read plus the project's finances: one set of facts on screens that sit side by side. */
function useEquipmentMutation<A, R>(fn: (a: A) => Promise<R>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      for (const root of [...EQUIPMENT_QUERY_ROOTS, PROJECT_FINANCES_ROOT]) void qc.invalidateQueries({ queryKey: [root] });
    },
  });
}

export const useCreateAsset = () =>
  useEquipmentMutation((input: { code: string; name: string; default_unit: 'hours' | 'days' }) => equipmentRepository.createAsset(input));
export const useUpdateAsset = () =>
  useEquipmentMutation((a: { id: string; patch: Parameters<typeof equipmentRepository.updateAsset>[1] }) => equipmentRepository.updateAsset(a.id, a.patch));
export const useDeleteAsset = () => useEquipmentMutation((id: string) => equipmentRepository.deleteAsset(id));
export const useSaveUsage = () => useEquipmentMutation((input: UsageInput) => equipmentRepository.saveUsage(input));
export const useTransitionUsage = () =>
  useEquipmentMutation((a: { id: string; to: UsageStatus; notes?: string }) => equipmentRepository.transitionUsage(a.id, a.to, a.notes));
export const useApproveWeek = () =>
  useEquipmentMutation((a: { assetId: string; weekStart: string }) => equipmentRepository.approveWeek(a.assetId, a.weekStart));
export const useArchiveUsage = () => useEquipmentMutation((id: string) => equipmentRepository.archiveUsage(id));
export const useSaveCosting = () => useEquipmentMutation((draft: CostingDraft) => equipmentRepository.saveCosting(draft));
export const useEndCosting = () =>
  useEquipmentMutation((a: { settingKey: string; effectiveTo: string; expectedVersion: number }) =>
    equipmentRepository.endCosting(a.settingKey, a.effectiveTo, a.expectedVersion));
/** Preview is a READ the screen fires on demand; kept in a mutation so nothing is cached or invalidated (the DB computes it). */
export const usePreviewCosting = () =>
  useMutation({ mutationFn: (draft: CostingDraft) => equipmentRepository.previewCosting(draft) });
