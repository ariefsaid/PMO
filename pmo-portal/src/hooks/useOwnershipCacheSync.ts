import { useEffect, useLayoutEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useExternalDomainOwnership } from './useExternalDomainOwnership';
import { useAuth } from '@/src/auth/useAuth';
import { repositories } from '@/src/lib/repositories';
import {
  setTaskOwnership,
  setProjectBindings,
  clearOwnershipCache,
} from '@/src/lib/adapterSeam/ownershipCache';

/**
 * ADR-0056 — seeds the ADR-0056 module-level ownership cache load-on-auth. Mounted ONCE in the
 * top-level authenticated shell (Shell in App.tsx). On a successful `useExternalDomainOwnership()`
 * resolve, calls `setTaskOwnership(data)`; while loading/absent (cold start, or a query error) and
 * on unmount (sign-out — this hook lives only inside the authenticated shell), calls
 * `clearOwnershipCache()` so `routeTaskWrite()` stays fail-closed to `'pmo'` until re-seeded.
 */
export function useOwnershipCacheSync(): void {
  const { currentUser } = useAuth();
  const { data: ownership } = useExternalDomainOwnership();
  const orgId = currentUser?.org_id;
  const { data: projectBindings } = useQuery({
    queryKey: ['integrations', 'project-bindings', orgId],
    queryFn: () => repositories.integrations.listProjectBindings(orgId!),
    enabled: Boolean(orgId),
  });

  useLayoutEffect(() => {
    if (ownership && projectBindings) {
      setTaskOwnership(ownership);
      setProjectBindings(projectBindings.map(({ project_id, external_tier }) => ({
        projectId: project_id,
        externalTier: external_tier,
      })));
    } else {
      clearOwnershipCache();
    }
  }, [ownership, projectBindings]);

  // Own-org-only, session-scoped: clear on unmount so a later session (sign-out → sign-in as a
  // different org) never inherits a stale map, even for the instant before the next fetch resolves.
  useEffect(() => {
    return () => clearOwnershipCache();
  }, []);
}
