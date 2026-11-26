import { projectClaimsQuery } from '@/src/hooks/useProgressBilling';
import { projectWorkOrdersQuery, type ProjectOrdersViewer } from '@/src/hooks/useWorkOrders';
import { projectQuery } from '@/src/hooks/useProjects';
import { projectPlanVsActualQuery } from '@/src/hooks/useWorkOrderPlanVsActual';
import { orgSwitchQuery } from '@/src/hooks/useOrgSwitch';
import { workOrderEarnedBilledQuery } from '@/src/hooks/useEarnedBilled';
import { disciplineRevenueQuery } from '@/src/hooks/useDisciplineProfit';
import type { QueryClient } from '@tanstack/react-query';
import { workOrderAllocationsQuery, workOrderQuery } from '@/src/hooks/useWorkOrderRecord';
import { workOrderStepsQuery } from '@/src/hooks/useBillingSteps';
import { billingReconciliationQuery, claimBillingTraceQuery } from '@/src/hooks/useBillingStages';
import { costDisciplinesQuery, workOrderCostLinesQuery } from '@/src/hooks/useWorkOrderCosts';

export function preloadWorkOrder(client: QueryClient, orgId: string, id: string): void {
  void client.prefetchQuery(workOrderQuery(orgId, id));
  void client.prefetchQuery(workOrderStepsQuery(orgId, id));
  void client.prefetchQuery(workOrderCostLinesQuery(orgId, id));
  void client.prefetchQuery(workOrderAllocationsQuery(orgId, id));
}

export function preloadProjectOrders(client: QueryClient, orgId: string, projectId: string, canViewPlan: boolean, viewer?: ProjectOrdersViewer): void {
  void client.prefetchQuery(projectQuery(orgId, projectId));
  if (viewer) void client.prefetchQuery(projectWorkOrdersQuery(viewer, projectId));
  void client.prefetchQuery(costDisciplinesQuery(orgId));
  if (!canViewPlan) return;

  void client.prefetchQuery(projectPlanVsActualQuery(orgId, projectId));
  // The module and switch are independent. Keep the panel's switch gate on its extra reads.
  void Promise.all([
    client.fetchQuery(orgSwitchQuery(orgId, 'moduleBillingExtras')),
    client.fetchQuery(orgSwitchQuery(orgId, 'disciplineProfit')),
  ]).then(([moduleOn, disciplineProfit]) => {
    if (moduleOn === false || disciplineProfit !== true) return;
    void client.prefetchQuery(workOrderEarnedBilledQuery(orgId, projectId));
    void client.prefetchQuery(disciplineRevenueQuery(orgId, projectId));
  }).catch(() => {
    // Mounted queries own retries and error states.
  });
}

export function preloadClaimDrawer(client: QueryClient, orgId: string, projectId: string, claimId: string): void {
  void client.prefetchQuery(projectQuery(orgId, projectId));
  void client.prefetchQuery(projectClaimsQuery(orgId, projectId));
  void client.prefetchQuery(claimBillingTraceQuery(orgId, claimId, projectId));
}

export function preloadOrderReconciliation(client: QueryClient, orgId: string, projectId: string, workOrderId: string, viewer?: ProjectOrdersViewer): void {
  void client.prefetchQuery(projectQuery(orgId, projectId));
  if (viewer) void client.prefetchQuery(projectWorkOrdersQuery(viewer, projectId));
  void client.prefetchQuery(billingReconciliationQuery(orgId, projectId, workOrderId));
}
