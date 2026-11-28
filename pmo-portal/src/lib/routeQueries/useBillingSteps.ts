import { repositories } from '../repositories';

export const workOrderStepsQuery = (orgId: string | undefined, workOrderId: string | undefined) => ({
  queryKey: ['work-order-billing-steps', orgId, workOrderId ?? ''],
  queryFn: () => repositories.billingStages.workOrderSteps(workOrderId ?? ''),
  enabled: Boolean(orgId) && Boolean(workOrderId),
});
