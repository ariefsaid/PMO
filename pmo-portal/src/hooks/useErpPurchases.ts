import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/src/auth/useAuth';
import { repositories } from '@/src/lib/repositories';

/** FR-EPR-006/007 — ERP-native purchases for one project, or the whole org when `projectId` is omitted. */
export function useErpPurchases(projectId?: string, opts?: { enabled?: boolean }) {
  const orgId = useAuth().currentUser?.org_id;
  return useQuery({
    queryKey: ['erp-purchases', orgId, projectId ?? null],
    queryFn: () => repositories.erpPurchases.list(projectId),
    enabled: Boolean(orgId) && opts?.enabled !== false,
  });
}

/** The default orphan list (set-aside documents excluded) for one project, or the whole org. */
export function useErpOrphans(projectId?: string, opts?: { enabled?: boolean }) {
  const orgId = useAuth().currentUser?.org_id;
  return useQuery({
    queryKey: ['erp-purchases', orgId, projectId ?? null, 'orphans'],
    queryFn: () => repositories.erpPurchases.listOrphans(projectId),
    enabled: Boolean(orgId) && opts?.enabled !== false,
  });
}

export function useHasErpPurchases(opts?: { enabled?: boolean }) {
  const orgId = useAuth().currentUser?.org_id;
  return useQuery({
    queryKey: ['erp-purchases-any', orgId],
    queryFn: () => repositories.erpPurchases.hasAny(),
    enabled: Boolean(orgId) && opts?.enabled !== false,
  });
}
