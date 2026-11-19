import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { repositories } from '@/src/lib/repositories';
import { useAuth } from '@/src/auth/useAuth';
import type { EquipmentStatus } from '@/src/lib/equipmentMetrics';

/** Equipment availability (#2526) over the repository seam (ADR-0017). Keys carry org_id (tenant scope). */
const useOrgId = (): string | undefined => useAuth().currentUser?.org_id;
const KEY = 'equipment-availability';

export function useStatusDays(from: string, to: string) {
  const orgId = useOrgId();
  return useQuery({ queryKey: [KEY, orgId, 'status', from, to], queryFn: () => repositories.equipmentAvailability.listStatusDays(from, to), enabled: Boolean(orgId) });
}
export function useDowntimeFlags() {
  const orgId = useOrgId();
  return useQuery({ queryKey: [KEY, orgId, 'flags'], queryFn: () => repositories.equipmentAvailability.listDowntimeFlags(), enabled: Boolean(orgId) });
}
export function useEquipmentMetrics(assetIds: string[], from: string, to: string, grain: 'day' | 'week' | 'month', enabled: boolean) {
  const orgId = useOrgId();
  return useQuery({
    queryKey: [KEY, orgId, 'metrics', assetIds, from, to, grain],
    queryFn: () => repositories.equipmentAvailability.getMetrics(assetIds, from, to, grain),
    enabled: Boolean(orgId) && enabled && assetIds.length > 0,
  });
}
export function useSetStatusBulk() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { date: string; items: { asset_id: string; status: EquipmentStatus; note?: string }[] }) =>
      repositories.equipmentAvailability.setStatusBulk(v.date, v.items),
    onSuccess: () => qc.invalidateQueries({ queryKey: [KEY] }),
  });
}
export function useAttachProof() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (v: { assetId: string; date: string; file: File; note?: string }) => {
      const { path } = await repositories.equipmentAvailability.addProof(v.assetId, v.date, v.file.name, v.note);
      await repositories.equipmentAvailability.uploadProof(path, v.file);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: [KEY] }),
  });
}
export function useRentalCheck() {
  return useMutation({
    mutationFn: (v: { assetId: string; from: string; to: string; invoice?: string; reason?: string }) =>
      repositories.equipmentAvailability.rentalCheck(v.assetId, v.from, v.to, v.invoice || null, v.reason || null),
  });
}
