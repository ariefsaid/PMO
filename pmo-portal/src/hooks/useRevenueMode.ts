import { useMemo } from 'react';
import { routeWrite, type OwnershipMap } from '@/src/lib/adapterSeam/router';
import { useExternalDomainOwnership } from './useExternalDomainOwnership';

export type RevenueMode = 'native' | 'erp';

/**
 * #784 (DD-NAR-1): who raises this org's customer invoices — PMO ('native') or the connected ERP ('erp').
 *
 * Derived from the ownership QUERY with the same `routeWrite('revenue', map)` rule the repository routes writes by, so
 * a surface re-renders the moment ownership loads (the module cache the repository reads cannot trigger a render).
 * `undefined` while ownership is loading, so no surface shows PMO-mode copy to an ERP-owned org for a frame. A failed
 * read is 'native' — the same fail-closed route the repository takes; the server refuses a PMO write while an ERP owns
 * revenue, so the worst case is an honest refusal, never a wrong write.
 */
export function useRevenueMode(): RevenueMode | undefined {
  const { data, isError } = useExternalDomainOwnership();
  return useMemo(() => {
    if (!data) return isError ? 'native' : undefined;
    const map: OwnershipMap = Object.fromEntries(data.map((row) => [row.domain, row.externalTier]));
    return routeWrite('revenue', map) === 'external' ? 'erp' : 'native';
  }, [data, isError]);
}
