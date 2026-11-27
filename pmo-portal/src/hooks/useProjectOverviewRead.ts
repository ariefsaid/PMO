import { projectOverviewFlags } from '@/src/auth/projectOverviewAccess';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/src/auth/useAuth';
import { useEffectiveRole } from '@/src/auth/impersonation';
import { usePermission } from '@/src/auth/usePermission';
import { projectOverviewQuery } from '@/src/lib/projectRouteQueries';

/**
 * One read for the Overview's above-the-fold summaries (AC-PERF-007/008). On success it seeds the cache keys the
 * leaf hooks already use, so they find fresh data and issue no request; on failure the leaf hooks read for
 * themselves, exactly as before. The leaf hooks are untouched.
 *
 * The flags mirror what the page already asks for: money = may view invoices, commitments = may view procurement,
 * budget = not the delivery lens. The server re-checks every gate under the caller's real role.
 */
export function useProjectOverviewRead(projectId: string, enabled: boolean) {
  const qc = useQueryClient();
  const orgId = useAuth().currentUser?.org_id;
  const may = usePermission();
  const { realRole } = useEffectiveRole();
  return useQuery({
    ...projectOverviewQuery(qc, orgId, projectId, projectOverviewFlags({ may, realRole })),
    enabled: enabled && Boolean(orgId && projectId),
  });
}
