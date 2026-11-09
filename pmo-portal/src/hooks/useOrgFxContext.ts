import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/src/auth/useAuth';
import { fxRatesRepository } from '@/src/lib/repositories/fxRates';
import { SESSION_QUERY_OPTIONS } from '@/src/lib/queryPolicies';

/** One session-fresh read for organization currency and timezone consumers. */
export function useOrgFxContext() {
  const org = useAuth().currentUser?.org_id;
  return useQuery({
    queryKey: ['fx-context', org ?? ''],
    queryFn: () => fxRatesRepository.context(),
    enabled: Boolean(org),
    ...SESSION_QUERY_OPTIONS,
  });
}
