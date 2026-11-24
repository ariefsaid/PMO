import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/src/auth/useAuth';
import { repositories } from '@/src/lib/repositories';
import { SESSION_QUERY_OPTIONS } from '@/src/lib/queryPolicies';

export const PO_NEEDED_BY_REQUIRED_QUERY_KEY = 'org-po-needed-by-required';

/** 1124d — preserve pending and failed reads so callers can show loading/retry instead of treating them as off. */
export function usePoNeededByRequired() {
  const orgId = useAuth().currentUser?.org_id;
  return useQuery({
    queryKey: [PO_NEEDED_BY_REQUIRED_QUERY_KEY, orgId],
    queryFn: () => repositories.procurement.getPoNeededByRequired(),
    enabled: Boolean(orgId),
    ...SESSION_QUERY_OPTIONS,
  });
}

/** The order's header date; errors stay distinct from an empty date. */
export function useProcurementNeededBy(id: string, enabled: boolean) {
  const orgId = useAuth().currentUser?.org_id;
  return useQuery({
    queryKey: ['procurement-needed-by', orgId, id],
    queryFn: () => repositories.procurement.getNeededBy(id),
    enabled: Boolean(orgId) && enabled,
    ...SESSION_QUERY_OPTIONS,
  });
}
