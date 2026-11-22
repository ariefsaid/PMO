import { useMutation, useQueryClient } from '@tanstack/react-query';
import { repositories } from '@/src/lib/repositories';
import type { EquipmentStatus } from '@/src/lib/equipmentMetrics';
import { useOrgQuery } from '@/src/hooks/useOrgQuery';

/** Equipment availability (#2526) over the repository seam (ADR-0017). Keys carry org_id (tenant scope). */
const KEY = 'equipment-availability';

export function useStatusDays(from: string, to: string, assetIds: string[]) {
  return useOrgQuery([KEY, 'status', from, to, assetIds], () => repositories.equipmentAvailability.listStatusDays(from, to, assetIds), { enabled: assetIds.length > 0 });
}
export function useLatestStatusDays(assetIds: string[], asOf: string) {
  return useOrgQuery([KEY, 'latest', assetIds, asOf], () => repositories.equipmentAvailability.listLatestStatusDays(assetIds, asOf), { enabled: assetIds.length > 0 });
}
export function useEquipmentProofs(assetIds: string[], date: string) {
  return useOrgQuery([KEY, 'proofs', assetIds, date], () => repositories.equipmentAvailability.listEquipmentProofs(assetIds, date), { enabled: Boolean(date) && assetIds.length > 0 });
}
export function useDowntimeFlags() {
  return useOrgQuery([KEY, 'flags'], () => repositories.equipmentAvailability.listDowntimeFlags());
}
export function useEquipmentMetrics(assetIds: string[], from: string, to: string, grain: 'day' | 'week' | 'month', enabled: boolean) {
  return useOrgQuery(
    [KEY, 'metrics', assetIds, from, to, grain],
    () => repositories.equipmentAvailability.getMetrics(assetIds, from, to, grain),
    { enabled: enabled && assetIds.length > 0 },
  );
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
export function useRentalTermHistory(assetId: string, enabled: boolean) {
  return useOrgQuery([KEY, 'terms', assetId], () => repositories.equipmentAvailability.listRentalTerms(assetId), { enabled: Boolean(assetId) && enabled });
}
export function useRentalTerms() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: repositories.equipmentAvailability.saveRentalTerm,
    onSuccess: async () => { await Promise.all([qc.invalidateQueries({ queryKey: [KEY] }), qc.invalidateQueries({ queryKey: ['equipment-assets'] })]); } });
}

export function useEquipmentOwnership() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (v: { assetId: string; ownership: 'owned' | 'rented'; inServiceOn: string | null }) => repositories.equipmentAvailability.setOwnership(v.assetId, v.ownership, v.inServiceOn),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['equipment-assets'] }) });
}
export function useChangeRentalRate() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (v: { assetId: string; date: string; rate: string }) => repositories.equipmentAvailability.changeRentalRate(v.assetId, v.date, v.rate),
    onSuccess: () => qc.invalidateQueries({ queryKey: [KEY] }) });
}

export function useEquipmentWorkingHours() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: repositories.equipmentAvailability.setWorkingHours, onSuccess: () => qc.invalidateQueries({ queryKey: [KEY] }) });
}

export function useRentalCheck() {
  return useMutation({ mutationFn: (v: { assetId: string; from: string; to: string; invoice?: string; reason?: string }) =>
    repositories.equipmentAvailability.rentalCheck(v.assetId, v.from, v.to, v.invoice || null, v.reason || null) });
}
