import { useSyncExternalStore } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/src/auth/useAuth';
import { repositories } from '@/src/lib/repositories';
import { isOwnershipCacheSynced, routeDomainWrite, subscribeOwnershipCache } from '@/src/lib/adapterSeam/ownershipCache';
import { useExternalDomainOwnership } from './useExternalDomainOwnership';

export function useDomainOwnershipMode(domain: string) {
  const orgId = useAuth().currentUser?.org_id;
  const ownership = useExternalDomainOwnership();
  const bindings = useQuery({
    queryKey: ['integrations', 'project-bindings', orgId],
    queryFn: () => repositories.integrations.listProjectBindings(orgId!),
    enabled: Boolean(orgId),
  });
  const route = useSyncExternalStore(subscribeOwnershipCache,
    () => isOwnershipCacheSynced() ? routeDomainWrite(domain) : 'unknown',
    () => 'unknown');
  const queryRoute = ownership.data?.some((row) => row.domain === domain) ? 'external' : 'pmo';
  const mode = ownership.isError || bindings.isError ? 'error'
    : !orgId || !ownership.data || !bindings.data || route !== queryRoute ? 'unknown' : route;
  const retry = () => { void ownership.refetch(); void bindings.refetch(); };
  return { mode, retry } as const;
}
