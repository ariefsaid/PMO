import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { repositories } from '@/src/lib/repositories';
import { useAuth } from '@/src/auth/useAuth';
import { useExternalDomainOwnership } from '@/src/hooks/useExternalDomainOwnership';
import type { AssetMatchPair, CostingDraft, EquipmentCommandOperation, UsageInput, UsageStatus } from '@/src/lib/db/equipment';

/**
 * Equipment usage and allocation (#1519 S5) over the repository seam (ADR-0017). Keys carry org_id (tenant scope).
 *
 * Every write invalidates every equipment read AND `project-finances` — a logged hour, an approval or a costing setting
 * moves what a project's actuals say (OQ-3), and the two screens sit side by side. `useProjectFinances` exports no root
 * constant, so the literal first key segment is the prefix we invalidate.
 */
export const EQUIPMENT_QUERY_ROOTS = ['equipment-assets', 'equipment-usage', 'equipment-usage-totals', 'equipment-costing',
  'equipment-allocations', 'equipment-register', 'equipment-maintenance', 'equipment-pickers', 'equipment-pending',
  'equipment-asset-matches'] as const;
const PROJECT_FINANCES_ROOT = 'project-finances';

const useOrgId = (): string | undefined => useAuth().currentUser?.org_id;
/** A totals/allocations read names an asset OR a project: the RPCs require one and refuse a bare range (22023). */
const namesOne = (q: { assetId?: string; projectId?: string }): boolean => Boolean(q.assetId || q.projectId);

export function useEquipmentAssets() {
  const orgId = useOrgId();
  return useQuery({ queryKey: ['equipment-assets', orgId], queryFn: () => repositories.equipment.listAssets(), enabled: Boolean(orgId) });
}

/** The register screen pages through every asset instead of treating its 200-row sentinel as the whole list. */
export function useEquipmentAssetPages() {
  const orgId = useOrgId();
  const pages = useInfiniteQuery({
    queryKey: ['equipment-assets', orgId, 'pages'],
    queryFn: ({ pageParam }) => repositories.equipment.listAssets(pageParam),
    initialPageParam: 0,
    getNextPageParam: (lastPage, pages) => lastPage.truncated
      ? pages.reduce((loaded, page) => loaded + page.rows.length, 0)
      : undefined,
    enabled: Boolean(orgId),
  });
  const count = useQuery({
    queryKey: ['equipment-assets', orgId, 'count'],
    queryFn: async () => {
      try {
        return await repositories.equipment.countAssets();
      } catch {
        return undefined;
      }
    },
    enabled: Boolean(orgId),
  });
  return { ...pages, total: count.data };
}

export function useEquipmentUsage(range: { from: string; to: string; assetId?: string; projectId?: string; status?: UsageStatus }) {
  const orgId = useOrgId();
  return useQuery({
    queryKey: ['equipment-usage', orgId, range],
    queryFn: () => repositories.equipment.listUsage(range),
    enabled: Boolean(orgId && range.from && range.to),
  });
}
export function useEquipmentUsageTotals(q: { projectId?: string; assetId?: string; from: string; to: string }) {
  const orgId = useOrgId();
  return useQuery({
    queryKey: ['equipment-usage-totals', orgId, q],
    queryFn: () => repositories.equipment.listUsageTotals(q),
    enabled: Boolean(orgId && q.from && q.to) && namesOne(q),
  });
}
export function useEquipmentCosting(includeHistory = false) {
  const orgId = useOrgId();
  return useQuery({
    queryKey: ['equipment-costing', orgId, includeHistory],
    queryFn: () => repositories.equipment.listCosting(includeHistory),
    enabled: Boolean(orgId),
  });
}
export function useEquipmentAllocations(q: { assetId?: string; projectId?: string; from: string; to: string }) {
  const orgId = useOrgId();
  return useQuery({
    queryKey: ['equipment-allocations', orgId, q],
    queryFn: () => repositories.equipment.listAllocations(q),
    enabled: Boolean(orgId && q.from && q.to) && namesOne(q),
  });
}

// ── the Odoo register and maintenance reads (#1511 F5; Odoo owns the register while the org employs equipment) ──

export function useRegister() {
  const orgId = useOrgId();
  return useQuery({
    queryKey: ['equipment-register', orgId],
    queryFn: () => repositories.equipment.listRegister(),
    enabled: Boolean(orgId),
  });
}
/** An asset's maintenance records newest first — `ref` is the asset's `external_ref` (`equipment:42`, `vehicle:7`). */
export function useAssetMaintenance(ref: string | undefined) {
  const orgId = useOrgId();
  return useQuery({
    queryKey: ['equipment-maintenance', orgId, ref],
    queryFn: () => repositories.equipment.listMaintenance(ref as string),
    enabled: Boolean(orgId && ref),
  });
}
/** Picker sources for the register/maintenance forms; `kind` names one mirrored picker kind. */
export function useEquipmentPickers(kind: Parameters<typeof repositories.equipment.listPickers>[0] | undefined) {
  const orgId = useOrgId();
  return useQuery({
    queryKey: ['equipment-pickers', orgId, kind],
    queryFn: () => repositories.equipment.listPickers(kind as Parameters<typeof repositories.equipment.listPickers>[0]),
    enabled: Boolean(orgId && kind),
  });
}
/** The outbox rows still waiting on Odoo for the handed PMO records (the asset page's waiting/held strips). */
export function usePendingEquipmentChanges(recordIds: string[]) {
  const orgId = useOrgId();
  return useQuery({
    queryKey: ['equipment-pending', orgId, recordIds],
    queryFn: () => repositories.equipment.listPendingChanges(recordIds),
    enabled: Boolean(orgId && recordIds.length > 0),
  });
}
/** The Admin match screen's proposals; `enabled=false` keeps the read off until the screen asks for it. */
export function useAssetMatches(enabled = true) {
  const orgId = useOrgId();
  return useQuery({
    queryKey: ['equipment-asset-matches', orgId],
    queryFn: () => repositories.equipment.listAssetMatches(),
    enabled: Boolean(orgId && enabled),
  });
}
/** True while the org employs `equipment` under Odoo — the screens' ownership switch (D12). */
export function useOdooEquipmentOwned(enabled = true) {
  const ownership = useExternalDomainOwnership(enabled);
  const rows = ownership.data ?? [];
  return { ...ownership, owned: rows.some((r) => r.externalTier === 'odoo' && r.domain === 'equipment') };
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
  useEquipmentMutation((input: { code: string; name: string; default_unit: 'hours' | 'days' }) => repositories.equipment.createAsset(input));
export const useUpdateAsset = () =>
  useEquipmentMutation((a: { id: string; patch: Parameters<typeof repositories.equipment.updateAsset>[1] }) => repositories.equipment.updateAsset(a.id, a.patch));
export const useDeleteAsset = () => useEquipmentMutation((id: string) => repositories.equipment.deleteAsset(id));
export const useSaveUsage = () => useEquipmentMutation((input: UsageInput) => repositories.equipment.saveUsage(input));
export const useTransitionUsage = () =>
  useEquipmentMutation((a: { id: string; to: UsageStatus; notes?: string }) => repositories.equipment.transitionUsage(a.id, a.to, a.notes));
export const useApproveWeek = () =>
  useEquipmentMutation((a: { assetId: string; weekStart: string }) => repositories.equipment.approveWeek(a.assetId, a.weekStart));
export const useArchiveUsage = () => useEquipmentMutation((id: string) => repositories.equipment.archiveUsage(id));
export const useSaveCosting = () => useEquipmentMutation((draft: CostingDraft) => repositories.equipment.saveCosting(draft));
export const useEndCosting = () =>
  useEquipmentMutation((a: { settingKey: string; effectiveTo: string; expectedVersion: number }) =>
    repositories.equipment.endCosting(a.settingKey, a.effectiveTo, a.expectedVersion));
/** Preview is a READ the screen fires on demand; kept in a mutation so nothing is cached or invalidated (the DB computes it). */
export const usePreviewCosting = () =>
  useMutation({ mutationFn: (draft: CostingDraft) => repositories.equipment.previewCosting(draft) });

// ── the register/maintenance writes (#1511 F5): through the outbox, Odoo confirms before PMO shows it ──

export const useAcceptAssetMatches = () =>
  useEquipmentMutation((pairs: AssetMatchPair[]) => repositories.equipment.acceptAssetMatches(pairs));
export const useSendEquipmentCommand = () =>
  useEquipmentMutation((a: { operation: EquipmentCommandOperation; record: { id: string } & Record<string, unknown>; idempotencyKey: string }) =>
    repositories.equipment.sendEquipmentCommand(a.operation, a.record, a.idempotencyKey));
