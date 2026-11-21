import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/src/auth/useAuth';
import { disciplineProfitRepository } from '@/src/lib/repositories/disciplineProfit';
import { SESSION_QUERY_OPTIONS } from '@/src/lib/queryPolicies';

/** #2669: the organisation setting. Off unless an Admin turned it on; keys carry org_id (tenant scope). */
export function useDisciplineProfitEnabled(enabled = true) {
  const { currentUser } = useAuth();
  const orgId = currentUser?.org_id;
  return useQuery({
    queryKey: ['discipline-profit-enabled', orgId],
    queryFn: () => disciplineProfitRepository.isEnabled(),
    enabled: enabled && Boolean(orgId),
    ...SESSION_QUERY_OPTIONS,
  });
}

export function useSetDisciplineProfitEnabled() {
  const qc = useQueryClient();
  const { currentUser } = useAuth();
  return useMutation({
    mutationFn: (value: boolean) => disciplineProfitRepository.setEnabled(value),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['discipline-profit-enabled', currentUser?.org_id] }),
  });
}

/** Validated revenue per discipline; only asked for while the setting is on. */
export function useDisciplineRevenue(projectId: string, enabled: boolean) {
  const { currentUser } = useAuth();
  const orgId = currentUser?.org_id;
  return useQuery({
    queryKey: ['discipline-revenue', orgId, projectId],
    queryFn: () => disciplineProfitRepository.revenue(projectId),
    enabled: enabled && Boolean(orgId) && Boolean(projectId),
  });
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
