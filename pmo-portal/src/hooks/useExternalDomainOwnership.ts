import { useQuery } from '@tanstack/react-query';
import { externalDomainOwnershipRepository } from '@/src/lib/repositories/admin';
import { useAuth } from '@/src/auth/useAuth';
import { externalDomainOwnershipKey } from './approvalsQueryKeys';

export { externalDomainOwnershipKey } from './approvalsQueryKeys';

/** The caller's own-org employed external tiers + externally-owned domains (AC-EAS-015 source). */
export function useExternalDomainOwnership(enabled = true) {
  const { currentUser } = useAuth();
  const orgId = currentUser?.org_id;
  return useQuery({
    queryKey: externalDomainOwnershipKey(orgId),
    queryFn: () => externalDomainOwnershipRepository.listOwn(),
    enabled: Boolean(orgId && enabled),
  });
}
