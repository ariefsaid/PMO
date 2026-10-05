import { useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/src/auth/useAuth';
import { repositories } from '@/src/lib/repositories';
import { queryClient } from '@/src/lib/queryClient';
import { routeDomainWrite } from '@/src/lib/adapterSeam/ownershipCache';
import type { ComboboxOption } from '@/src/components/ui/Combobox';

/** Reuse the integration binding query and session-scoped React Query catalog cache. */
export function useErpItemOptions(purpose: 'sales' | 'purchase') {
  const { currentUser } = useAuth();
  const orgId = currentUser?.org_id;
  const binding = useQuery(
    {
      queryKey: ['integrations', 'binding', orgId, 'erpnext'],
      queryFn: () => repositories.integrations.getBinding(orgId!, 'erpnext'),
      enabled: Boolean(orgId),
    },
    queryClient,
  );
  const connected =
    binding.data?.status === 'active' ||
    routeDomainWrite(purpose === 'sales' ? 'revenue' : 'procurement') === 'external';
  const loadOptions = useCallback(async (): Promise<ComboboxOption[]> => {
    if (!orgId) throw new Error('Sign in to select an ERP item');
    const items = await queryClient.fetchQuery({
      queryKey: ['integrations', 'items', orgId, purpose],
      queryFn: () => repositories.integrations.listItems(purpose),
      staleTime: 30_000,
    });
    return items.map((item) => ({ value: item.code, label: item.code, sub: item.name }));
  }, [orgId, purpose]);
  return { connected, loadOptions };
}
