import { useContext } from 'react';
import { QueryClient, QueryClientContext, useQuery } from '@tanstack/react-query';
import { AuthContext } from '@/src/auth/AuthContext';
import { repositories } from '@/src/lib/repositories';

// Chrome-adjacent read: outside a query provider or a session, and until `enabled`, it is simply off (no throw, no request).
const IDLE_CLIENT = new QueryClient();

/**
 * The name of the signed-in person's line manager — who a submitted timesheet week goes to. Read lazily (`enabled`) from the
 * manager-choice list, so a page that never reaches a submit pays nothing. Null while unknown or when no manager is set.
 */
export function useApproverName(enabled: boolean): string | null {
  const qc = useContext(QueryClientContext);
  const user = useContext(AuthContext)?.currentUser;
  const managerId = user?.manager_id ?? null;
  const { data } = useQuery({
    queryKey: ['users', user?.org_id, 'manager-choices'],
    queryFn: () => repositories.profile.listManagerChoices(),
    enabled: enabled && Boolean(user?.org_id) && Boolean(managerId) && Boolean(qc),
  }, qc ?? IDLE_CLIENT);
  return managerId ? data?.find((c) => c.id === managerId)?.full_name ?? null : null;
}
