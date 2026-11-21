import { useQuery } from '@tanstack/react-query';
import { repositories } from '@/src/lib/repositories';
import { useAuth } from '@/src/auth/useAuth';

/** The billing board rows (#2681). Key carries org_id; `projectId` null = every project the viewer can see. */
export function useBillingBoard(projectId: string | null, enabled = true) {
  const orgId = useAuth().currentUser?.org_id;
  return useQuery({
    queryKey: ['billing-board', orgId, projectId],
    queryFn: () => repositories.billingStages.readBoard(projectId),
    enabled: enabled && Boolean(orgId),
  });
}
