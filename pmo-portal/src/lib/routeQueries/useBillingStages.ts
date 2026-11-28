import { repositories } from '../repositories';
import { MONEY_STALE_TIME } from '../queryPolicies';

export const billingReconciliationQuery = (orgId: string | undefined, projectId: string, workOrderId: string | null) => ({
  queryKey: ['billing-reconciliation', orgId, projectId, workOrderId],
  queryFn: () => repositories.billingStages.reconciliation(projectId, workOrderId),
  staleTime: workOrderId ? MONEY_STALE_TIME : 0,
  enabled: Boolean(orgId) && Boolean(projectId),
});

export const claimBillingTraceQuery = (orgId: string | undefined, claimId: string, projectId: string) => ({
  queryKey: claimBillingTraceKey(orgId, claimId, projectId),
  queryFn: () => repositories.billingStages.trace(claimId, projectId),
  enabled: Boolean(orgId) && Boolean(claimId) && Boolean(projectId),
});

export const claimBillingTraceKey = (orgId: string | undefined, claimId: string, projectId: string) =>
  ['claim-billing-trace', orgId, claimId, projectId] as const;
