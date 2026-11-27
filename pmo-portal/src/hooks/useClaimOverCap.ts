import { useQuery } from '@tanstack/react-query';
import { claimOverCapRepository } from '@/src/lib/repositories/claimOverCap';
import { useAuth } from '@/src/auth/useAuth';
import type { ClaimOverCapMode } from '@/src/lib/db/claimOverCap';

export const CLAIM_OVER_CAP_KEY = 'org-claim-over-cap';

/** The organisation's claim-quantity setting. Unreadable reads as `warn`, today's behaviour. */
export function useClaimOverCap() {
  const { currentUser } = useAuth();
  const orgId = currentUser?.org_id;
  return useQuery<ClaimOverCapMode>({
    queryKey: [CLAIM_OVER_CAP_KEY, orgId],
    queryFn: claimOverCapRepository.get,
    enabled: Boolean(orgId),
    staleTime: 5 * 60_000,
    retry: false,
  });
}
