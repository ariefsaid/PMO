import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/src/auth/useAuth';
import { usePermission } from '@/src/auth/usePermission';
import { useOrgQuery } from './useOrgQuery';
import { useAllWorkOrders, useProjectWorkOrders } from './useWorkOrders';
import { useBoqItems } from './useProgressBilling';
import { useProjectWorkOrderLines, useWorkOrderAcceptances } from './useWorkOrderAcceptances';
import { useWorkOrderBilling } from './useWorkOrderBilling';
import { useBoardWorkOrderSteps } from './useBillingSteps';
import { useOpenCloseoutDue } from './useCloseoutChecklist';
import { useCostDisciplines } from './useWorkOrderCosts';
import { workOrderDashboardRepository } from '@/src/lib/repositories/workOrderDashboard';
import { workOrderFinanceRepository } from '@/src/lib/repositories/workOrderFinance';
import { buildDashboardRows, type DashboardRow, type DashboardWorkOrder } from '@/src/lib/workOrderDashboard';
import { closeoutOverdueByWorkOrder, orgToday } from '@/src/lib/checklistDue';
import { getActiveOrgTimezone } from '@/src/lib/locale/activeLocale';

export type CostState = 'shown' | 'hidden';

/**
 * The work-order dashboard's rows (#2805), for every work order the reader may see or for one project. A fixed set of
 * reads whatever the row count: the work orders, their contract lines, the allocated contract items, confirmed
 * acceptances, billing, billing steps and close-out items, each one request (paged by thousands). Cost is the
 * direct-cost and budget roll-up for the projects in view, fetched as a batch.
 * Billing needs the invoice view right and cost the plan view right, exactly as on the work-order page.
 */
export function useWorkOrderDashboard(projectId?: string, costProjectIds?: readonly string[]) {
  const may = usePermission();
  const { currentUser } = useAuth();
  const orgId = currentUser?.org_id;
  const scoped = Boolean(projectId);
  const pid = projectId ?? '';
  const canBilling = may('view', 'salesInvoice');
  const canPlan = may('view', 'workOrderPlan');

  const allOrders = useAllWorkOrders(!scoped);
  const projectOrders = useProjectWorkOrders(pid);
  const allLines = useOrgQuery(['work-order-dashboard', 'lines'], workOrderDashboardRepository.lines, { enabled: !scoped });
  const allItems = useOrgQuery(['work-order-dashboard', 'items'], workOrderDashboardRepository.items, { enabled: !scoped });
  const allAcceptances = useOrgQuery(['work-order-dashboard', 'acceptances'], workOrderDashboardRepository.acceptances, { enabled: !scoped });
  const allBilling = useOrgQuery(['work-order-dashboard', 'billing'], workOrderDashboardRepository.billing, { enabled: !scoped && canBilling });
  const projectLines = useProjectWorkOrderLines(pid);
  const projectItems = useBoqItems(pid);
  const projectAcceptances = useWorkOrderAcceptances(pid);
  const projectBilling = useWorkOrderBilling(pid, canBilling);
  const steps = useBoardWorkOrderSteps(projectId);
  const closeout = useOpenCloseoutDue();
  const disciplines = useCostDisciplines();

  const orders = scoped ? projectOrders : allOrders;
  const lines = scoped ? projectLines : allLines;
  const items = scoped ? projectItems : allItems;
  const acceptances = scoped ? projectAcceptances : allAcceptances;
  const billing = scoped ? projectBilling : allBilling;

  const workOrders = useMemo<DashboardWorkOrder[]>(() => (orders.data ?? []).map((o) => ({
    id: o.id, wo_number: o.wo_number, title: o.title, status: o.status, project_id: o.project_id,
    project_name: 'project_name' in o ? (o.project_name as string | null) : null, end_date: o.end_date,
  })), [orders.data]);

  const costIds = useMemo(() => scoped ? [pid] : [...new Set(costProjectIds ?? workOrders.map((w) => w.project_id))].sort(),
    [scoped, pid, costProjectIds, workOrders]);
  const readCosts = Boolean(orgId) && canPlan && costIds.length > 0;
  const costRead = useQuery({
    queryKey: ['work-order-plan-vs-actual', orgId, 'dashboard', costIds, currentUser?.id, currentUser?.role],
    queryFn: () => workOrderFinanceRepository.dashboardCosts(costIds),
    enabled: readCosts,
  });
  const cost = useMemo(() => costRead.data ? new Map(costRead.data.map(({ workOrderId, ...figures }) => [workOrderId, figures])) : undefined,
    [costRead.data]);
  const costState: CostState = !canPlan || costRead.data === null ? 'hidden' : 'shown';

  const today = orgToday(new Date(), getActiveOrgTimezone());
  const rows = useMemo<DashboardRow[]>(() => buildDashboardRows({
    workOrders,
    lines: lines.data,
    items: items.data,
    acceptances: acceptances.data?.filter((a) => a.status === 'Confirmed'),
    billing: canBilling ? billing.data : undefined,
    cost: costState === 'shown' ? cost : undefined,
    steps: steps.data,
    closeoutOverdue: closeoutOverdueByWorkOrder(closeout.data ?? [], today),
    today,
  }), [workOrders, lines.data, items.data, acceptances.data, billing.data, canBilling, cost, costState, steps.data, closeout.data, today]);

  return {
    rows,
    isPending: orders.isPending,
    isError: orders.isError,
    refetch: () => { void orders.refetch(); },
    /** Figures still arriving: their cells read as loading rather than blank. */
    figuresPending: lines.isPending || items.isPending || acceptances.isPending || (canBilling && billing.isPending) || (readCosts && costRead.isPending),
    figuresError: lines.isError || items.isError || acceptances.isError || (canBilling && billing.isError) || steps.isError || (readCosts && costRead.isError),
    retryFigures: () => { for (const q of [lines, items, acceptances, billing, steps, closeout]) void q.refetch(); if (readCosts) void costRead.refetch(); },
    canBilling,
    costState,
    disciplines: disciplines.data ?? [],
  };
}
