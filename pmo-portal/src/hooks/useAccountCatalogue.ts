import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/src/auth/useAuth';
import { useErpnextBinding } from '@/src/hooks/useErpnextBinding';
import { listBudgetPostingAccountCatalogue } from '@/src/lib/repositories/budgetProjection';

/**
 * The ERP account catalogue, one cache entry per org for every Accounting panel. The read starts only for a
 * caller who may manage the setting and an org with an active ERP binding: anyone else could only see it fail.
 */
export function useAccountCatalogue(canManage: boolean) {
  const orgId = useAuth().currentUser?.org_id;
  const binding = useErpnextBinding();
  const hasActiveBinding = binding.data?.status === 'active' && !binding.isError;
  return useQuery({
    queryKey: ['uxs11', 'account-catalogue', orgId],
    queryFn: listBudgetPostingAccountCatalogue,
    enabled: Boolean(canManage && orgId && hasActiveBinding),
  });
}
