import { useContext } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AuthContext } from '@/src/auth/AuthContext';
import { repositories } from '@/src/lib/repositories';
import { queryClient } from '@/src/lib/queryClient';

/**
 * #520 — the ERP company's enabled Purchase Taxes and Charges Templates for the flipped-org vendor-invoice
 * picker. Read live from ERPNext (it owns the list); `enabled` keeps a PMO-owned org from ever reading it. The server
 * scopes the read to the caller's org; the org id only keys the cache.
 */
export function usePurchaseTaxTemplates(enabled: boolean) {
  const orgId = useContext(AuthContext)?.currentUser?.org_id;
  return useQuery(
    {
      queryKey: ['integrations', 'purchase-tax-templates', orgId],
      queryFn: () => repositories.integrations.listPurchaseTaxTemplates(),
      enabled,
      staleTime: 30_000,
      retry: false,
    },
    queryClient,
  );
}
