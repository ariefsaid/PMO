import { costDisciplinesQuery, workOrderCostLinesQuery } from '@/src/lib/routeQueries/useWorkOrderCosts';
export { costDisciplinesQuery, workOrderCostLinesQuery } from '@/src/lib/routeQueries/useWorkOrderCosts';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/src/auth/useAuth';
import { workOrderCostRepository } from '@/src/lib/repositories/workOrderCosts';

/** The org's live discipline list (#2517) — the cost forms' discipline picker. */

export function useCostDisciplines(enabled = true) {
  return useQuery(costDisciplinesQuery(useAuth().currentUser?.org_id, enabled));
}

/** One work order's cost lines grouped by source (#2517 read seam; #2518/#2519/#2523 build on it). */

export function useWorkOrderCostLines(workOrderId: string | null, enabled = true) {
  return useQuery(workOrderCostLinesQuery(useAuth().currentUser?.org_id, workOrderId, enabled));
}

/** Per-source money behind a work order's cost lines (#2518); runs after the lines are read. */
export function useWorkOrderCostMoney(workOrderId: string | null, lines: import('@/src/lib/repositories/workOrderCosts').WorkOrderCostLine[] | undefined) {
  const { currentUser } = useAuth();
  const orgId = currentUser?.org_id;
  return useQuery({
    queryKey: ['work-order-cost-money', orgId, workOrderId, lines?.map((line) => [line.source, line.recordId]) ?? []],
    queryFn: () => workOrderCostRepository.costMoney(lines as import('@/src/lib/repositories/workOrderCosts').WorkOrderCostLine[]),
    enabled: Boolean(orgId) && Boolean(workOrderId) && Boolean(lines && lines.length > 0),
  });
}

/** Resolve purchase costs to the record in their procurement timeline. */
export function useWorkOrderCostLinks(workOrderId: string | null, lines: import('@/src/lib/repositories/workOrderCosts').WorkOrderCostLine[]) {
  const orgId = useAuth().currentUser?.org_id;
  return useQuery({
    queryKey: ['work-order-cost-links', orgId, workOrderId, lines.map((line) => [line.source, line.recordId])],
    queryFn: () => workOrderCostRepository.costLinks(lines),
    enabled: Boolean(orgId) && Boolean(workOrderId) && lines.length > 0,
  });
}

/** Caller-scoped labels for timesheet rows, without exposing record identifiers. */
export function useWorkOrderTimesheetLabels(workOrderId: string | null, lines: import('@/src/lib/repositories/workOrderCosts').WorkOrderCostLine[]) {
  const orgId = useAuth().currentUser?.org_id;
  const ids = lines.filter((line) => line.source === 'timesheet_entry').map((line) => line.recordId);
  return useQuery({
    queryKey: ['work-order-timesheet-labels', orgId, workOrderId, ids],
    queryFn: () => workOrderCostRepository.timesheetLabels(lines),
    enabled: Boolean(orgId) && Boolean(workOrderId) && ids.length > 0,
  });
}
