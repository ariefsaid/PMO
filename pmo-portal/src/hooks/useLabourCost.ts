import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/src/auth/useAuth';
import { labourCostRepository, type LabourRateInput } from '@/src/lib/repositories/labourCost';

/** #2670: labour cost setup. Keys carry org_id (tenant scope). Money reads invalidate plan versus actual. */
const root = (orgId: string | undefined) => ['labour-cost', orgId] as const;

export function useLabourCostEnabled(enabled = true) {
  const orgId = useAuth().currentUser?.org_id;
  return useQuery({ queryKey: [...root(orgId), 'enabled'], queryFn: labourCostRepository.enabled, enabled: enabled && Boolean(orgId), staleTime: 60_000 });
}
export function useLabourClasses(enabled = true) {
  const orgId = useAuth().currentUser?.org_id;
  return useQuery({ queryKey: [...root(orgId), 'classes'], queryFn: labourCostRepository.classes, enabled: enabled && Boolean(orgId), staleTime: 60_000 });
}
export function useLabourRates(enabled = true) {
  const orgId = useAuth().currentUser?.org_id;
  return useQuery({ queryKey: [...root(orgId), 'rates'], queryFn: labourCostRepository.rates, enabled: enabled && Boolean(orgId) });
}

export function useLabourCostMutations() {
  const qc = useQueryClient();
  const orgId = useAuth().currentUser?.org_id;
  const refresh = async () => {
    await qc.invalidateQueries({ queryKey: root(orgId) });
    await qc.invalidateQueries({ queryKey: ['work-order-plan-vs-actual', orgId] });
  };
  return {
    setEnabled: useMutation({ mutationFn: (on: boolean) => labourCostRepository.setEnabled(on), onSuccess: refresh }),
    addClass: useMutation({ mutationFn: (v: { code: string; name: string }) => labourCostRepository.addClass(v.code, v.name), onSuccess: refresh }),
    renameClass: useMutation({ mutationFn: (v: { id: string; name: string }) => labourCostRepository.renameClass(v.id, v.name), onSuccess: refresh }),
    archiveClass: useMutation({ mutationFn: (v: { id: string; archived: boolean }) => labourCostRepository.archiveClass(v.id, v.archived), onSuccess: refresh }),
    saveRate: useMutation({ mutationFn: (v: LabourRateInput) => labourCostRepository.saveRate(v), onSuccess: refresh }),
    endRate: useMutation({ mutationFn: (v: { id: string; endDate: string }) => labourCostRepository.endRate(v.id, v.endDate), onSuccess: refresh }),
    archiveRate: useMutation({ mutationFn: (id: string) => labourCostRepository.archiveRate(id), onSuccess: refresh }),
  };
}
