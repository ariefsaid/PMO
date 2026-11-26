import { useContext, useMemo } from 'react';
import { useQueries } from '@tanstack/react-query';
import { useAuth } from '@/src/auth/useAuth';
import { usePermission } from '@/src/auth/usePermission';
import { ProjectMoneyScopeContext } from './useProjectMoneyScope';
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
import type { WorkOrderFigures } from '@/src/lib/workOrderPlanVsActual';

/** Above this many projects in view, cost is not read (each project's roll-up is its own read): the reader picks a project. */
export const COST_PROJECT_CAP = 6;

export type CostState = 'shown' | 'hidden' | 'too-many';

/**
 * The work-order dashboard's rows (#2805), for every work order the reader may see or for one project. A fixed set of
 * reads whatever the row count: the work orders, their contract lines, the allocated contract items, confirmed
 * acceptances, billing, billing steps and close-out items, each one request (paged by thousands). Cost is the
 * plan-versus-actual roll-up the work-order page reads, one per project in view and only up to `COST_PROJECT_CAP`.
 * Billing needs the invoice view right and cost the plan view right, exactly as on the work-order page.
 */
export function useWorkOrderDashboard(projectId?: string, costProjectIds?: readonly string[]) {
  const may = usePermission();
  const orgId = useAuth().currentUser?.org_id;
  const scoped = Boolean(projectId);
  const pid = projectId ?? '';
  // On a project page outside the reader's money scope (DD-R1125-14) the board reads like one for a role with no money.
  const moneyInScope = useContext(ProjectMoneyScopeContext);
  const canBilling = may('view', 'salesInvoice') && moneyInScope;
  const canPlan = may('view', 'workOrderPlan') && moneyInScope;

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

  const costIds = useMemo(() => {
    const ids = scoped ? [pid] : [...new Set(costProjectIds ?? workOrders.map((w) => w.project_id))];
    return ids.length <= COST_PROJECT_CAP ? ids : null;
  }, [scoped, pid, costProjectIds, workOrders]);
  const costReads = useQueries({
    queries: (canPlan && costIds ? costIds : []).map((id) => ({
      queryKey: ['work-order-plan-vs-actual', orgId, id],
      queryFn: () => workOrderFinanceRepository.projectPlanVsActual(id),
      enabled: Boolean(orgId),
    })),
  });
  const costData = costReads.map((q) => q.data);
  const costKey = costReads.map((q) => q.dataUpdatedAt).join(',');
  const cost = useMemo(() => {
    if (costData.length === 0 || costData.some((d) => !d) || costData.some((d) => d!.rollup.restricted)) return undefined;
    return new Map<string, WorkOrderFigures>(costData.flatMap((d) => d!.rollup.workOrders.map((f) => [f.workOrderId, f] as const)));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- costKey changes whenever any roll-up read lands.
  }, [costKey]);
  const restricted = costData.some((d) => d?.rollup.restricted);
  const costState: CostState = !canPlan || restricted ? 'hidden' : costIds === null ? 'too-many' : 'shown';

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
    figuresPending: lines.isPending || items.isPending || acceptances.isPending || (canBilling && billing.isPending) || costReads.some((q) => q.isPending),
    figuresError: lines.isError || items.isError || acceptances.isError || (canBilling && billing.isError) || steps.isError || costReads.some((q) => q.isError),
    retryFigures: () => { for (const q of [lines, items, acceptances, billing, steps, closeout, ...costReads]) void q.refetch(); },
    canBilling,
    costState,
    disciplines: disciplines.data ?? [],
  };
}
