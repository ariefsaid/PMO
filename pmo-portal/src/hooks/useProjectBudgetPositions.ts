import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/src/auth/useAuth';
import { usePermission } from '@/src/auth/usePermission';
import { projectBudgetPositionsQuery } from '@/src/lib/projectRouteQueries';

/** Reads the S03 set-based budget position for a stable, authorized set of projects. */
export function useProjectBudgetPositions(ids: string[], options?: { refetchOnMount?: boolean }) {
  const { currentUser } = useAuth();
  const may = usePermission();
  const orgId = currentUser?.org_id;
  const stableIds = [...new Set(ids)].sort();
  const canRead = may('view', 'salesInvoice');
  return useQuery({
    ...projectBudgetPositionsQuery(orgId, stableIds),
    enabled: Boolean(orgId && canRead && stableIds.length > 0),
    ...(options?.refetchOnMount === undefined ? {} : { refetchOnMount: options.refetchOnMount }),
  });
}
