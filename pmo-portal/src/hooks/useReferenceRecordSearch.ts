import { useQuery } from '@tanstack/react-query';
import { useOptionalRealRole } from '@/src/auth/impersonation';
import { useAuth } from '@/src/auth/useAuth';
import { can } from '@/src/auth/policy';
import { searchRecordReferencesRepository } from '@/src/lib/repositories/recordReferenceSearch';

const REFERENCE_QUERY_MIN_LENGTH = 2;
const REFERENCE_QUERY_MAX_LENGTH = 120;

/** Query-specific read for palette references, bounded by the caller's real role and tenant. */
export function useReferenceRecordSearch(query: string, opts: { enabled: boolean }) {
  const { currentUser } = useAuth();
  const orgId = currentUser?.org_id;
  const userId = currentUser?.id;
  const realRole = useOptionalRealRole();
  const normalizedQuery = query.trim().toLowerCase();
  const mayViewInvoices = can('view', 'salesInvoice', { realRole });
  const mayViewReceipts = can('view', 'incomingPayment', { realRole });

  return useQuery({
    queryKey: ['uxs40', 'references', orgId, userId, realRole, normalizedQuery],
    queryFn: () => searchRecordReferencesRepository(normalizedQuery),
    enabled:
      opts.enabled &&
      Boolean(orgId && userId) &&
      mayViewInvoices &&
      mayViewReceipts &&
      normalizedQuery.length >= REFERENCE_QUERY_MIN_LENGTH &&
      normalizedQuery.length <= REFERENCE_QUERY_MAX_LENGTH,
    retry: false,
  });
}
