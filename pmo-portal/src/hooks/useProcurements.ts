import { useQuery } from '@tanstack/react-query';
import {
  listProcurements,
  getProjectCommittedSpend,
  getProjectReservedSpend,
  type ProcurementWithRefs,
} from '@/src/lib/db/procurements';
import { useAuth } from '@/src/auth/useAuth';

/**
 * Org-scoped procurement list. queryKey includes org_id so cache is tenant-scoped (FR-QRY-PROC-001).
 * `withRefs` (#769) is the Procurement index only: it adds the record-reference embeds for search/export
 * under its own cache key, so Approvals/dashboards keep the lean payload. Both keys share the
 * `['procurements', orgId]` prefix, so existing invalidations still refetch it.
 */
export function useProcurements(opts?: { withRefs?: boolean }) {
  const { currentUser } = useAuth();
  const orgId = currentUser?.org_id;
  const withRefs = opts?.withRefs === true;
  return useQuery<ProcurementWithRefs[]>({
    queryKey: withRefs ? ['procurements', orgId, 'with-refs'] : ['procurements', orgId],
    queryFn: () => listProcurements(undefined, withRefs ? { withRefs: true } : undefined),
    enabled: Boolean(orgId),
  });
}

/**
 * Committed spend for ONE project (OD-W5-4): Σ PO total_value in Ordered..Paid — the same basis the
 * dashboards use. Powers the DecisionSupportPanel's "Committed spend" figure. Org-scoped via RLS.
 */
export function useProjectCommittedSpend(projectId: string | null | undefined) {
  const { currentUser } = useAuth();
  const orgId = currentUser?.org_id;
  return useQuery<number>({
    queryKey: ['project-committed-spend', orgId, projectId],
    queryFn: () => getProjectCommittedSpend(projectId as string),
    enabled: Boolean(orgId && projectId),
  });
}

/**
 * Reserved spend for ONE project (ADR-0034): Σ total_value in Approved/Vendor Quoted/Quote Selected —
 * approved-but-not-yet-ordered demand. Powers the DecisionSupportPanel's Reserved/Available figures.
 * Org-scoped via RLS; query key carries orgId so the cache is tenant-scoped.
 */
export function useProjectReservedSpend(projectId: string | null | undefined) {
  const { currentUser } = useAuth();
  const orgId = currentUser?.org_id;
  return useQuery<number>({
    queryKey: ['project-reserved-spend', orgId, projectId],
    queryFn: () => getProjectReservedSpend(projectId as string),
    enabled: Boolean(orgId && projectId),
  });
}
