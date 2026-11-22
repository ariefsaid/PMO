import { repositories } from '@/src/lib/repositories';
import { useOrgQuery } from '@/src/hooks/useOrgQuery';

/** The billing board rows (#2681). Key carries org_id; `projectId` null = every project the viewer can see. */
export function useBillingBoard(projectId: string | null, enabled = true) {
  return useOrgQuery(['billing-board', projectId], () => repositories.billingStages.readBoard(projectId), { enabled });
}
