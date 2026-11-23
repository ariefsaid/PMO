import { deriveScopeProgress, type ProgressAcceptanceInput, type ProgressItemInput, type ProgressLineInput } from './workOrderProgress';
import { stepDaysOver } from './workOrderBillingSteps';
import type { WorkOrderStatus } from './db/workOrders';
import type { WorkOrderBillingRow } from './db/workOrderBilling';
import type { WorkOrderStep } from './db/workOrderBillingSteps';
import type { WorkOrderFigures } from './workOrderPlanVsActual';
import type { ExactMoney } from './projectFinances';

/**
 * One row per work order for the work-order dashboard (#2805). Every figure is the one the work-order page already
 * shows, computed by the same pure function over the same reads: progress = `deriveScopeProgress`, billed = the
 * `work_order_billing` view, cost = the plan-versus-actual roll-up, open and late = the billing steps and the
 * close-out items. Nothing is computed here that the record page does not compute; an unread figure is null, never 0.
 */
export interface DashboardWorkOrder {
  id: string;
  wo_number: string | null;
  title: string;
  status: WorkOrderStatus;
  project_id: string;
  project_name: string | null;
  end_date: string | null;
}

export interface DashboardItem extends ProgressItemInput { discipline_id: string | null }
export interface DashboardLine extends ProgressLineInput { work_order_id: string }
export interface DashboardAcceptance extends ProgressAcceptanceInput { work_order_id: string }

export interface DashboardRow extends DashboardWorkOrder {
  disciplineIds: string[];
  /** 0-100, value-weighted; null when nothing priced is allocated. */
  progress: number | null;
  billing: { currency: string; invoiced: number; orderNet: number; complete: boolean } | null;
  cost: { currency: string; direct: ExactMoney | null; plan: ExactMoney | null } | null;
  /** Billing steps not done or skipped. */
  openSteps: number;
  /** Steps past their target plus close-out items past their due day. */
  late: number;
}

export interface DashboardInput {
  workOrders: readonly DashboardWorkOrder[];
  lines?: readonly DashboardLine[];
  items?: readonly DashboardItem[];
  acceptances?: readonly DashboardAcceptance[];
  billing?: readonly WorkOrderBillingRow[];
  cost?: ReadonlyMap<string, WorkOrderFigures>;
  steps?: readonly WorkOrderStep[];
  closeoutOverdue?: ReadonlyMap<string, number>;
  today: string;
}

function group<T>(rows: readonly T[] | undefined, key: (row: T) => string): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const row of rows ?? []) {
    const k = key(row);
    const bucket = out.get(k);
    if (bucket) bucket.push(row); else out.set(k, [row]);
  }
  return out;
}

export function buildDashboardRows(input: DashboardInput): DashboardRow[] {
  const linesBy = group(input.lines, (l) => l.work_order_id);
  const acceptancesBy = group(input.acceptances, (a) => a.work_order_id);
  const stepsBy = group(input.steps, (s) => s.workOrderId);
  const itemById = new Map((input.items ?? []).map((i) => [i.id, i]));
  const billingBy = new Map((input.billing ?? []).map((b) => [b.workOrderId, b]));
  const rows = input.workOrders.map((wo): DashboardRow => {
    const lines = linesBy.get(wo.id) ?? [];
    const lineItems = lines.map((l) => itemById.get(l.boq_item_id)).filter((i): i is DashboardItem => Boolean(i));
    const progress = input.lines && input.items && input.acceptances && lines.length > 0
      ? deriveScopeProgress(lines, lineItems, acceptancesBy.get(wo.id) ?? []).overallPercent
      : null;
    const b = billingBy.get(wo.id);
    const f = input.cost?.get(wo.id);
    const steps = stepsBy.get(wo.id) ?? [];
    return {
      ...wo,
      disciplineIds: [...new Set(lineItems.map((i) => i.discipline_id).filter((d): d is string => Boolean(d)))],
      progress,
      billing: b ? { currency: b.currency, invoiced: b.invoiced, orderNet: b.orderNet, complete: b.figuresComplete } : null,
      cost: f ? { currency: f.currency, direct: f.direct, plan: f.plan.direct_budget } : null,
      openSteps: steps.filter((s) => !s.doneOn && !s.skippedOn).length,
      late: steps.filter((s) => stepDaysOver(s, input.today) !== null).length + (input.closeoutOverdue?.get(wo.id) ?? 0),
    };
  });
  // Off track first (screen rules, "Order on any screen"); otherwise the order the work orders arrived in.
  return rows.map((r, i) => [r, i] as const).sort((a, b) => b[0].late - a[0].late || a[1] - b[1]).map(([r]) => r);
}
