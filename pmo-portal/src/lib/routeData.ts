import { projectWorkOrdersQuery, type ProjectOrdersViewer } from './routeQueries/useWorkOrders';
import { orgSwitchQuery } from './routeQueries/useOrgSwitch';
import { billingReconciliationQuery, claimBillingTraceQuery } from './routeQueries/useBillingStages';
import { projectClaimsQuery } from './routeQueries/useProgressBilling';
import { projectQuery } from './routeQueries/useProjects';
import { workOrderEarnedBilledQuery } from './routeQueries/useEarnedBilled';
import { costDisciplinesQuery } from './routeQueries/useWorkOrderCosts';
import { workOrderAllocationsQuery, workOrderQuery } from './routeQueries/useWorkOrderRecord';
import { disciplineRevenueQuery } from './routeQueries/useDisciplineProfit';
import { projectPlanVsActualQuery } from './routeQueries/useWorkOrderPlanVsActual';
import { isPriceVisibilityResolved } from './priceReadPath';
import { projectOverviewFlags, type ProjectOverviewAccess } from '@/src/auth/projectOverviewAccess';
import type { QueryClient } from '@tanstack/react-query';
import { projectBudgetPositionsQuery, projectOverviewQuery } from './projectRouteQueries';

/** Navigation uses the hooks' query factories and resolved real-role policy. */
export function preloadProjectOverview(client: QueryClient, orgId: string, projectId: string, access?: ProjectOverviewAccess): void {
  if (!orgId || !projectId || !access?.realRole || !isPriceVisibilityResolved()) return;
  void client.prefetchQuery(projectQuery(orgId, projectId));
  void client.prefetchQuery(projectOverviewQuery(client, orgId, projectId, projectOverviewFlags(access)));
  if (access.may('view', 'salesInvoice')) {
    void client.prefetchQuery(projectBudgetPositionsQuery(orgId, [projectId]));
  }
}

export function preloadWorkOrder(client: QueryClient, orgId: string, id: string): void {
  void client.prefetchQuery(workOrderQuery(orgId, id));
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
