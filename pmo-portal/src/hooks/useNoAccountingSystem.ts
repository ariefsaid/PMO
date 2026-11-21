import { useDomainOwnershipMode } from './useDomainOwnershipMode';
import { useExternalDomainOwnership } from './useExternalDomainOwnership';

/**
 * #2734: whether the organisation runs with no accounting system connected: no externally-owned domain and no
 * active integration binding. `'unknown'` while either read is loading or failed, so a connected organisation can
 * never be shown the PMO-only copy (callers treat anything but `true` as today's behaviour).
 */
export function useNoAccountingSystem(enabled = true): boolean | 'unknown' {
  const ownership = useExternalDomainOwnership(enabled);
  const { orgBound } = useDomainOwnershipMode('revenue');
  if (!enabled || ownership.isError || !ownership.data || orgBound === null) return 'unknown';
  return ownership.data.length === 0 && orgBound === false;
}
