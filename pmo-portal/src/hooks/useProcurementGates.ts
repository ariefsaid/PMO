import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/src/auth/useAuth';
import { repositories } from '@/src/lib/repositories';

/** Query key shared with the Administration screen, so a rule change there refreshes every reader. */
export const PROCUREMENT_GATES_KEY = 'org-procurement-gates';

/**
 * FR-PFE-011 — the org's purchase rules. Any active member may read them (`get_procurement_gates`); Finance and
 * Project Managers cannot open Administration, so the purchase page reads them here to explain a blocked first step.
 * The server still enforces — a failed or pending read must never block a record on its own.
 */
export function useProcurementGates() {
  const orgId = useAuth().currentUser?.org_id;
  return useQuery({
    queryKey: [PROCUREMENT_GATES_KEY, orgId],
    queryFn: () => repositories.orgSettings.getProcurementGates(),
    enabled: Boolean(orgId),
  });
}
