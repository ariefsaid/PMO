import { useQuery } from '@tanstack/react-query';
import { getOrgDefaultCurrency } from '@/src/lib/db/orgs';
import { useAuth } from '@/src/auth/useAuth';

/**
 * The caller's org operating currency, for figures with no money row of their own (dashboard
 * aggregates, pipeline stages, board column sums). Returns 'USD' until the org row resolves —
 * the same default posture 0187 gave the column itself. Row-backed surfaces must NOT use this:
 * pass the record's `currency` (FR-L10N-020). Platform AI billing must NOT use this:
 * PLATFORM_CURRENCY (FR-L10N-023). staleTime Infinity — the org currency changes only by
 * operator action.
 */
export function useOrgCurrency(): string {
  const { currentUser } = useAuth();
  const { data } = useQuery<string>({
    queryKey: ['org-currency', currentUser?.org_id],
    queryFn: () => getOrgDefaultCurrency(),
    enabled: Boolean(currentUser),
    staleTime: Infinity,
    placeholderData: 'USD',
  });
  return data ?? 'USD';
}
