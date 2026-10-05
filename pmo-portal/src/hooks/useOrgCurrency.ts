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
function useOrgCurrencyQuery() {
  const { currentUser } = useAuth();
  return useQuery<string>({
    queryKey: ['org-currency', currentUser?.org_id],
    queryFn: () => getOrgDefaultCurrency(),
    enabled: Boolean(currentUser),
    staleTime: Infinity,
    placeholderData: 'USD',
  });
}

/** Currency plus its loading/error state for views that must not label amounts with the USD placeholder. */
export function useOrgCurrencyState(): { currency: string; isResolved: boolean; isError: boolean } {
  const query = useOrgCurrencyQuery();
  return {
    currency: query.data ?? 'USD',
    isResolved: query.data !== undefined && !query.isPlaceholderData,
    isError: query.isError,
  };
}

export function useOrgCurrency(): string {
  return useOrgCurrencyQuery().data ?? 'USD';
}
