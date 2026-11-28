import { useQuery } from '@tanstack/react-query';
import { repositories } from '@/src/lib/repositories';
import { useAuth } from '@/src/auth/useAuth';
import { workOrderBillingQuery, workOrderBilledMonthsQuery } from '@/src/lib/routeQueries/useWorkOrderBilling';
export { workOrderBillingQuery, workOrderBilledMonthsQuery } from '@/src/lib/routeQueries/useWorkOrderBilling';

/** OD-BILL-1: work-order billing reads over the repository seam (ADR-0017). Keys carry org_id (tenant scope). */
export const UNBILLED_WORK_ORDERS_LIMIT = 8;

/** Per-work-order billing for one project. `enabled` = the caller may see billing (salesInvoice.view). */
export function useWorkOrderBilling(projectId: string, enabled = true) {
  return useQuery(workOrderBillingQuery(useAuth().currentUser?.org_id, projectId, enabled));
}

/** Billed per month for one work order. Keyed under 'work-order-billing' so billing invalidation refreshes it. */
export function useWorkOrderBilledMonths(workOrderId: string | undefined, enabled = true) {
  return useQuery(workOrderBilledMonthsQuery(useAuth().currentUser?.org_id, workOrderId, enabled));
}

/** What is still to invoice across the organisation's issued and closed work orders (dashboards). */
export function useUnbilledWorkOrders(enabled = true) {
  const { currentUser } = useAuth();
  const orgId = currentUser?.org_id;
  return useQuery({
    queryKey: ['unbilled-work-orders', orgId],
    queryFn: () => repositories.workOrder.unbilled(UNBILLED_WORK_ORDERS_LIMIT),
    enabled: enabled && Boolean(orgId),
  });
}

/** #1640: acceptance age per work order. Keyed under 'work-order-billing' so every billing invalidation refreshes it. */
export function useWorkOrderAcceptanceAge(projectId: string, enabled = true) {
  const { currentUser } = useAuth();
  const orgId = currentUser?.org_id;
  return useQuery({
    queryKey: ['work-order-billing', orgId, projectId, 'acceptance-age'],
    queryFn: () => repositories.workOrder.acceptanceAge(projectId),
    enabled: enabled && Boolean(orgId) && Boolean(projectId),
  });
}
