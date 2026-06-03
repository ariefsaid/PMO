import { useQuery } from '@tanstack/react-query';
import { getExecutiveDashboard, type ExecutiveDashboard } from '@/src/lib/db/dashboard';
import { useAuth } from '@/src/auth/useAuth';

/** Org-scoped executive dashboard aggregates. queryKey includes org_id so cache is tenant-scoped
 * (FR-QRY-DASH-001). Aggregates are computed in SQL (RPC) and RLS-scoped to the caller's org. */
export function useDashboard() {
  const { currentUser } = useAuth();
  const orgId = currentUser?.org_id;
  return useQuery<ExecutiveDashboard>({
    queryKey: ['dashboard', orgId],
    queryFn: () => getExecutiveDashboard(),
    enabled: Boolean(orgId),
  });
}
