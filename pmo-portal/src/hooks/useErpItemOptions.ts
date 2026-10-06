import { useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/src/auth/useAuth';
import { repositories } from '@/src/lib/repositories';
import { queryClient } from '@/src/lib/queryClient';
import { routeDomainWrite } from '@/src/lib/adapterSeam/ownershipCache';
import { listOwnExternalDomainOwnership } from '@/src/lib/db/externalDomainOwnership';
import type { ComboboxOption } from '@/src/components/ui/Combobox';

/**
 * ERP item picker for invoice/purchase lines. ADR-0055: the ERP is the source of truth per DOMAIN,
 * so lines pick an ERP item only when ERPNext owns the line's domain (revenue for sales lines,
 * procurement for purchase lines) — those are the only lines that are ever pushed. A connected org
 * that still runs the domain natively keeps free-text lines. Shares the shell's ownership query
 * (`useExternalDomainOwnership`'s key) and a session-scoped React Query catalog cache.
 */
export function useErpItemOptions(purpose: 'sales' | 'purchase') {
  const { currentUser } = useAuth();
  const orgId = currentUser?.org_id;
  const domain = purpose === 'sales' ? 'revenue' : 'procurement';
  const ownership = useQuery(
    {
      queryKey: ['external-domain-ownership', orgId],
      queryFn: listOwnExternalDomainOwnership,
      enabled: Boolean(orgId),
    },
    queryClient,
  );
  const connected =
    Boolean(orgId) &&
    ((ownership.data ?? []).some((row) => row.domain === domain && row.externalTier === 'erpnext') ||
      routeDomainWrite(domain) === 'external');
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
