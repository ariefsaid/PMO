import { projectOverviewFlags, type ProjectOverviewAccess } from '@/src/auth/projectOverviewAccess';
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
import { projectBudgetPositionsQuery, projectOverviewQuery, projectTasksQuery } from './projectRouteQueries';

/** Navigation uses the hooks' query factories and resolved real-role policy. */
export function preloadProjectOverview(client: QueryClient, orgId: string, projectId: string, access?: ProjectOverviewAccess): void {
  if (!orgId || !projectId || !access?.realRole) return;
  void client.prefetchQuery(projectQuery(orgId, projectId));
  void client.prefetchQuery(projectOverviewQuery(client, orgId, projectId, projectOverviewFlags(access)));
  void client.prefetchQuery(projectTasksQuery(orgId, projectId));
  if (access.may('view', 'salesInvoice')) {
    void client.prefetchQuery(projectBudgetPositionsQuery(orgId, [projectId]));
  }
}

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

function preloadProjectAndOrders(client: QueryClient, orgId: string, projectId: string, viewer?: ProjectOrdersViewer): void {
  void client.prefetchQuery(projectQuery(orgId, projectId));
  if (viewer) void client.prefetchQuery(projectWorkOrdersQuery(viewer, projectId));
}

/** The contract tab's shared project, work-order list and billing reconciliation reads. */
export function preloadContractProject(client: QueryClient, orgId: string, projectId: string, canViewBilling: boolean, viewer?: ProjectOrdersViewer): void {
  preloadProjectAndOrders(client, orgId, projectId, viewer);
  if (canViewBilling) void client.prefetchQuery(billingReconciliationQuery(orgId, projectId, null));
}

export function preloadClaimDrawer(client: QueryClient, orgId: string, projectId: string, claimId: string): void {
  void client.prefetchQuery(projectQuery(orgId, projectId));
  void client.prefetchQuery(projectClaimsQuery(orgId, projectId));
  void client.prefetchQuery(claimBillingTraceQuery(orgId, claimId, projectId));
}

export function preloadOrderReconciliation(client: QueryClient, orgId: string, projectId: string, workOrderId: string, viewer?: ProjectOrdersViewer): void {
  preloadProjectAndOrders(client, orgId, projectId, viewer);
  void client.prefetchQuery(billingReconciliationQuery(orgId, projectId, workOrderId));
}
