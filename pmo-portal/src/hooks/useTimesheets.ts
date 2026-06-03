import { useQuery } from '@tanstack/react-query';
import { listTimesheets, type TimesheetWithEntries } from '@/src/lib/db/timesheets';
import { useAuth } from '@/src/auth/useAuth';

/** Org+user-scoped timesheet list. queryKey includes org_id + user id so cache is tenant- and
 * user-scoped (FR-QRY-TS-001). Fetches only the signed-in user's own rows. */
export function useTimesheets() {
  const { currentUser } = useAuth();
  const orgId = currentUser?.org_id;
  const userId = currentUser?.id;
  return useQuery<TimesheetWithEntries[]>({
    queryKey: ['timesheets', orgId, userId],
    queryFn: () => listTimesheets(userId as string),
    enabled: Boolean(orgId && userId),
  });
}
