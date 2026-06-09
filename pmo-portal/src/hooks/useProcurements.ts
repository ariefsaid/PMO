import { useQuery } from '@tanstack/react-query';
import {
  listProcurements,
  getProjectCommittedSpend,
  type ProcurementWithRefs,
} from '@/src/lib/db/procurements';
import { useAuth } from '@/src/auth/useAuth';

/** Org-scoped procurement list. queryKey includes org_id so cache is tenant-scoped (FR-QRY-PROC-001). */
export function useProcurements() {
  const { currentUser } = useAuth();
  const orgId = currentUser?.org_id;
  return useQuery<ProcurementWithRefs[]>({
    queryKey: ['procurements', orgId],
    queryFn: () => listProcurements(),
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
