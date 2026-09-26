import { useQuery } from '@tanstack/react-query';
import { listOwnExternalDomainOwnership } from '@/src/lib/db/externalDomainOwnership';
import { useAuth } from '@/src/auth/useAuth';

/** The caller's own-org employed external tiers + externally-owned domains (AC-EAS-015 source). */
export function useExternalDomainOwnership() {
  const { currentUser } = useAuth();
  const orgId = currentUser?.org_id;
  return useQuery({
    queryKey: ['external-domain-ownership', orgId],
    queryFn: listOwnExternalDomainOwnership,
    enabled: Boolean(orgId),
  });
}
