import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/src/auth/useAuth';
import { disciplineProfitRepository } from '@/src/lib/repositories/disciplineProfit';

/** Validated revenue per discipline; only asked for while the setting is on. */
export const disciplineRevenueQuery = (orgId: string | undefined, projectId: string, enabled = true) => ({
  queryKey: ['discipline-revenue', orgId, projectId],
  queryFn: () => disciplineProfitRepository.revenue(projectId),
  enabled: enabled && Boolean(orgId) && Boolean(projectId),
});

export function useDisciplineRevenue(projectId: string, enabled: boolean) {
  return useQuery(disciplineRevenueQuery(useAuth().currentUser?.org_id, projectId, enabled));
}

export function useSetItemDiscipline(projectId: string) {
  const qc = useQueryClient();
  const { currentUser } = useAuth();
  return useMutation({
    mutationFn: ({ itemId, disciplineId }: { itemId: string; disciplineId: string | null }) =>
      disciplineProfitRepository.setItemDiscipline(itemId, disciplineId),
    onSuccess: async () => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['discipline-revenue', currentUser?.org_id, projectId] }),
        qc.invalidateQueries({ queryKey: ['boq-items'] }),
      ]);
    },
  });
}
