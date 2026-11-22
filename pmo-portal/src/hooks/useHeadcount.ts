import { useMutation, useQueryClient } from '@tanstack/react-query';
import { headcountRepository, type HeadcountInput } from '@/src/lib/repositories/headcount';
import { useOrgId } from '@/src/hooks/useOrgId';
import { useOrgQuery } from '@/src/hooks/useOrgQuery';

/** Daily head counts (guard-headcount) over the repository seam (ADR-0017). Keys carry org_id (tenant scope). */
export function useHeadcountDay(workOrderId: string | null, date: string | null) {
  return useOrgQuery(['headcount-day', workOrderId, date], () => headcountRepository.day(workOrderId as string, date as string),
    { enabled: Boolean(workOrderId && date) });
}

/** Every write refreshes the day's lines and the money reads (an approved line changes work-order cost). */
export function useHeadcountMutations() {
  const qc = useQueryClient();
  const orgId = useOrgId();
  const refresh = async () => {
    await qc.invalidateQueries({ queryKey: ['headcount-day'] });
    await qc.invalidateQueries({ queryKey: ['work-order-plan-vs-actual', orgId] });
  };
  return {
    record: useMutation({ mutationFn: (v: HeadcountInput) => headcountRepository.record(v), onSuccess: refresh }),
    approve: useMutation({ mutationFn: (id: string) => headcountRepository.approve(id), onSuccess: refresh }),
    clear: useMutation({ mutationFn: (id: string) => headcountRepository.clear(id), onSuccess: refresh }),
  };
}
