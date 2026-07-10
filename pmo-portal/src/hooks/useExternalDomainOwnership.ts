import { useQuery } from '@tanstack/react-query';
import { listOwnExternalDomainOwnership } from '@/src/lib/db/externalDomainOwnership';

/** The caller's own-org employed external tiers + externally-owned domains (AC-EAS-015 source). */
export function useExternalDomainOwnership() {
  return useQuery({
    queryKey: ['external-domain-ownership'],
    queryFn: listOwnExternalDomainOwnership,
  });
}
