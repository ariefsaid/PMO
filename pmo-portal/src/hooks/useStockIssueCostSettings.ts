import { useMutation, useQueryClient } from '@tanstack/react-query';
import { invalidateAfterOrgCostSetting } from '@/src/lib/invalidateOrgSettings';
import { stockIssueCostSettingsRepository as repo } from '@/src/lib/repositories/stockIssueCostSettings';
import { useOrgQuery } from './useOrgQuery';
export function useStockIssueCostSettings() {
  return useOrgQuery(['stock-issue-cost-settings'], () => repo.get());
}
export function useSetStockIssueCostSettings() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (date: string | null) => repo.set(date), onSuccess: () => invalidateAfterOrgCostSetting(qc) });
}
