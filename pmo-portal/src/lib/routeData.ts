import type { QueryClient } from '@tanstack/react-query';
import { workOrderAllocationsQuery, workOrderQuery } from '@/src/hooks/useWorkOrderRecord';
import { workOrderStepsQuery } from '@/src/hooks/useBillingSteps';
import { workOrderCostLinesQuery } from '@/src/hooks/useWorkOrderCosts';

export function preloadWorkOrder(client: QueryClient, orgId: string, id: string): void {
  void client.prefetchQuery(workOrderQuery(orgId, id));
  void client.prefetchQuery(workOrderStepsQuery(orgId, id));
  void client.prefetchQuery(workOrderCostLinesQuery(orgId, id));
  void client.prefetchQuery(workOrderAllocationsQuery(orgId, id));
}
