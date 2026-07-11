import { useEffect } from 'react';
import { useExternalDomainOwnership } from './useExternalDomainOwnership';
import { setTaskOwnership, clearOwnershipCache } from '@/src/lib/adapterSeam/ownershipCache';

/**
 * ADR-0056 — seeds the ADR-0056 module-level ownership cache load-on-auth. Mounted ONCE in the
 * top-level authenticated shell (Shell in App.tsx). On a successful `useExternalDomainOwnership()`
 * resolve, calls `setTaskOwnership(data)`; while loading/absent (cold start, or a query error) and
 * on unmount (sign-out — this hook lives only inside the authenticated shell), calls
 * `clearOwnershipCache()` so `routeTaskWrite()` stays fail-closed to `'pmo'` until re-seeded.
 */
export function useOwnershipCacheSync(): void {
  const { data } = useExternalDomainOwnership();

  useEffect(() => {
    if (data) {
      setTaskOwnership(data);
    } else {
      clearOwnershipCache();
    }
  }, [data]);

  // Own-org-only, session-scoped: clear on unmount so a later session (sign-out → sign-in as a
  // different org) never inherits a stale map, even for the instant before the next fetch resolves.
  useEffect(() => {
    return () => clearOwnershipCache();
  }, []);
}
