import { useQuery } from '@tanstack/react-query';
import { listProcurements, type ProcurementWithRefs } from '@/src/lib/db/procurements';
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
