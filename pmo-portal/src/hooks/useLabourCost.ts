import { useMutation, useQueryClient } from '@tanstack/react-query';
import { labourCostRepository, type LabourClassAssignmentInput, type LabourRateInput } from '@/src/lib/repositories/labourCost';
import { useOrgId } from '@/src/hooks/useOrgId';
import { useOrgQuery } from '@/src/hooks/useOrgQuery';

/** #2670: labour cost setup. Keys carry org_id (tenant scope). Money reads invalidate plan versus actual. */
const root = (orgId: string | undefined) => ['labour-cost', orgId] as const;

export function useLabourCostEnabled(enabled = true) {
  return useOrgQuery(['labour-cost', 'enabled'], labourCostRepository.enabled, { enabled, staleness: 'live' });
}
export function useLabourClasses(enabled = true) {
  return useOrgQuery(['labour-cost', 'classes'], labourCostRepository.classes, { enabled, staleness: 'live' });
}
export function useLabourRates(enabled = true) {
  return useOrgQuery(['labour-cost', 'rates'], labourCostRepository.rates, { enabled });
}

export function useLabourClassAssignments(enabled = true) {
  return useOrgQuery(['labour-cost', 'assignments'], labourCostRepository.assignments, { enabled });
}
/** People in the register with no login: the picker for a labour class assignment. */
export function usePeopleWithoutLogin(enabled = true) {
  return useOrgQuery(['labour-cost', 'people-without-login'], labourCostRepository.peopleWithoutLogin, { enabled });
}

export function useLabourCostMutations() {
  const qc = useQueryClient();
  const orgId = useOrgId();
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
    saveAssignment: useMutation({ mutationFn: (v: LabourClassAssignmentInput) => labourCostRepository.saveAssignment(v), onSuccess: refresh }),
    endAssignment: useMutation({ mutationFn: (v: { id: string; endDate: string }) => labourCostRepository.endAssignment(v.id, v.endDate), onSuccess: refresh }),
    archiveAssignment: useMutation({ mutationFn: (id: string) => labourCostRepository.archiveAssignment(id), onSuccess: refresh }),
  };
}
