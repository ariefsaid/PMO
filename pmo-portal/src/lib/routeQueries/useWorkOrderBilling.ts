import { repositories } from '../repositories';

/** One project's per-work-order billing. The hook, the plan-vs-actual load and the tab prefetch all share this key: one read. */
export const workOrderBillingQuery = (orgId: string | undefined, projectId: string, enabled = true) => ({
  queryKey: ['work-order-billing', orgId, projectId],
  queryFn: () => repositories.workOrder.billing(projectId),
  enabled: enabled && Boolean(orgId) && Boolean(projectId),
});

export const workOrderBilledMonthsQuery = (orgId: string | undefined, workOrderId: string | undefined, enabled = true) => ({
  queryKey: ['work-order-billing', orgId, 'billed-months', workOrderId],
  queryFn: () => repositories.workOrder.billedMonths(workOrderId as string),
  enabled: enabled && Boolean(orgId) && Boolean(workOrderId),
});
