import { useMutation, useQueryClient } from '@tanstack/react-query';
import { repositories } from '@/src/lib/repositories';
import { useOrgQuery } from '@/src/hooks/useOrgQuery';

/** Per-organisation opt-in for the work-order import and opening-balances overview. */
export function useSetupWorkflows() {
  const queryClient = useQueryClient();
  const query = useOrgQuery(['orgSetupWorkflows'], () => repositories.orgSettings.getSetupWorkflowsEnabled(), { staleness: 'session' });
  const mutation = useMutation({
    mutationFn: (enabled: boolean) => repositories.orgSettings.setSetupWorkflowsEnabled(enabled),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['orgSetupWorkflows'] }),
  });

  return {
    enabled: query.data === true,
    isLoading: query.isLoading,
    isError: query.isError || mutation.isError,
    isSaving: mutation.isPending,
    setEnabled: mutation.mutate,
    refetch: query.refetch,
  };
}
