import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/src/auth/useAuth';
import { disciplineProfitRepository } from '@/src/lib/repositories/disciplineProfit';
import { useOrgQuery } from '@/src/hooks/useOrgQuery';

/** #2669: the organisation setting. Off unless an Admin turned it on; keys carry org_id (tenant scope). */
export function useDisciplineProfitEnabled(enabled = true) {
  return useOrgQuery(['discipline-profit-enabled'], () => disciplineProfitRepository.isEnabled(), { enabled, staleness: 'session' });
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
  return useOrgQuery(['discipline-revenue', projectId], () => disciplineProfitRepository.revenue(projectId), { enabled: enabled && Boolean(projectId) });
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
