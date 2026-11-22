import { useMutation, useQueryClient } from '@tanstack/react-query';
import { equipmentPlanRepository as repo } from '@/src/lib/repositories/equipmentPlans';
import type { PlanCategoryInput, PlanSettings } from '@/src/lib/repositories/equipmentPlans';
import { useOrgId } from '@/src/hooks/useOrgId';
import { useOrgQuery } from '@/src/hooks/useOrgQuery';

/** The monthly equipment plan (#2700) over the repository seam. Keys carry org_id (tenant scope); every write refreshes the root. */
export const EQUIPMENT_PLAN_QUERY_ROOT = 'equipment-plans';

/** FR-EQP-001: whether the organisation turned the plan on. While loading or off, no plan affordance is shown. */
export function useEquipmentPlanSettings() {
  return useOrgQuery([EQUIPMENT_PLAN_QUERY_ROOT, 'settings'], () => repo.settings());
}

export function usePlanCategories() {
  return useOrgQuery([EQUIPMENT_PLAN_QUERY_ROOT, 'categories'], () => repo.categories());
}

export function usePlansForMonth(month: string, enabled: boolean) {
  return useOrgQuery([EQUIPMENT_PLAN_QUERY_ROOT, 'month', month], () => repo.plansForMonth(month), { enabled });
}

/** UX only: may the caller approve this Submitted plan. The database decides again on approve. */
export function useCanApprovePlan(planId: string | undefined, enabled: boolean) {
  return useOrgQuery([EQUIPMENT_PLAN_QUERY_ROOT, 'can-approve', planId], () => repo.canApprove(planId as string), { enabled: Boolean(planId) && enabled });
}

export function usePlanSettingsMutations() {
  const qc = useQueryClient();
  const orgId = useOrgId();
  const refresh = () => qc.invalidateQueries({ queryKey: [EQUIPMENT_PLAN_QUERY_ROOT, orgId] });
  return {
    setSettings: useMutation({ mutationFn: (s: PlanSettings) => repo.setSettings(s), onSuccess: refresh }),
    upsertCategory: useMutation({ mutationFn: (i: PlanCategoryInput) => repo.upsertCategory(i), onSuccess: refresh }),
    setCategoryActive: useMutation({ mutationFn: (a: { id: string; active: boolean }) => repo.setCategoryActive(a.id, a.active), onSuccess: refresh }),
  };
}

/** Plan writes. Approving creates purchases, so the purchase lists refresh too. */
export function usePlanMutations() {
  const qc = useQueryClient();
  const orgId = useOrgId();
  const refresh = () => qc.invalidateQueries({ queryKey: [EQUIPMENT_PLAN_QUERY_ROOT, orgId] });
  return {
    save: useMutation({ mutationFn: (i: Parameters<typeof repo.save>[0]) => repo.save(i), onSuccess: refresh }),
    submit: useMutation({ mutationFn: (id: string) => repo.submit(id), onSuccess: refresh }),
    reopen: useMutation({ mutationFn: (id: string) => repo.reopen(id), onSuccess: refresh }),
    reject: useMutation({ mutationFn: (a: { id: string; reason: string }) => repo.reject(a.id, a.reason), onSuccess: refresh }),
    approve: useMutation({
      mutationFn: (id: string) => repo.approve(id),
      onSuccess: () => Promise.all([refresh(), qc.invalidateQueries({ queryKey: ['procurements'] })]),
    }),
  };
}
