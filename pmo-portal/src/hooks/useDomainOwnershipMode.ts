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
  // Whether any external system is actively bound for the org: where one is, the books are kept there.
  // null until known, and on error: callers do not offer a control the server would refuse on that basis.
  const orgBindings = useQuery({
    queryKey: ['integrations', 'bindings', orgId],
    queryFn: () => repositories.integrations.listBindings(orgId!),
    enabled: Boolean(orgId),
  });
  const orgBound = orgBindings.data ? orgBindings.data.some((b) => b.status === 'active') : null;
  const route = useSyncExternalStore(subscribeOwnershipCache,
    () => isOwnershipCacheSynced() ? routeDomainWrite(domain) : 'unknown',
    () => 'unknown');
  const queryRoute = ownership.data?.some((row) => row.domain === domain) ? 'external' : 'pmo';
  const mode = ownership.isError || bindings.isError ? 'error'
    : !orgId || !ownership.data || !bindings.data || route !== queryRoute ? 'unknown' : route;
  const retry = () => { void ownership.refetch(); void bindings.refetch(); };
  return { mode, retry, orgBound } as const;
}
