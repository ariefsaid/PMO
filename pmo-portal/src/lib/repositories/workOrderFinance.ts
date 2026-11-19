/**
 * repositories/workOrderFinance.ts (#2519) — the seam over plan versus actual per work order (ADR-0017).
 * Standalone module (same shape as `workOrderCosts.ts`): imported directly by its consumers. Errors keep their
 * Postgres code via `wrap`.
 *
 * `projectPlanVsActual` gathers the four reads one project's figures need and hands them to the pure
 * `rollupProject` — the only place a figure is computed (FR-WPVA-010: the screens never re-sum).
 */
import {
  listProjectCostAmounts,
  listProjectPlanLines,
  savePlanLine,
  deletePlanLine,
  getSharedSplit,
  setSharedSplit,
  clearSharedSplit,
  type PlanLineInput,
} from '@/src/lib/db/workOrderFinance';
import { listProjectWorkOrders } from '@/src/lib/db/workOrders';
import { listWorkOrderBilling, type WorkOrderBillingRow } from '@/src/lib/db/workOrderBilling';
import { rollupProject, type CostAmountLine, type PlanLine, type ProjectRollup, type PvaWorkOrder, type SplitPercent } from '@/src/lib/workOrderPlanVsActual';
import { wrap } from './repositoryErrors';

export type { PlanLineInput };

export interface ProjectPlanVsActual {
  workOrders: PvaWorkOrder[];
  plans: PlanLine[];
  split: SplitPercent[] | null;
  rollup: ProjectRollup;
}

function isRefused(err: unknown): boolean {
  return (err as { code?: unknown } | null)?.code === '42501';
}

async function load(projectId: string): Promise<ProjectPlanVsActual> {
  const [orders, billing, money] = await Promise.all([
    listProjectWorkOrders(projectId),
    // Revenue is the shipped per-work-order billing read; when it cannot be read, revenue is unknown, never zero.
    listWorkOrderBilling(projectId).catch((): WorkOrderBillingRow[] | null => null),
    // FR-WPVA-013: a role that cannot read work-order money gets "restricted", never a zero or a partial sum.
    listProjectCostAmounts(projectId).then((lines): CostAmountLine[] | null => lines, (err) => {
      if (isRefused(err)) return null;
      throw err;
    }),
  ]);
  const restricted = money === null;
  const [plans, split] = restricted ? [[], null] : await Promise.all([listProjectPlanLines(projectId), getSharedSplit(projectId)]);

  const byWo = new Map((billing ?? []).map((b) => [b.workOrderId, b]));
  const workOrders: PvaWorkOrder[] = orders
    .map((o) => {
      const b = byWo.get(o.id);
      return {
        id: o.id,
        woNumber: o.wo_number,
        title: o.title,
        status: o.status,
        currency: o.currency,
        revenue: b ? b.invoiced.toFixed(2) : null,
        revenueComplete: Boolean(b?.figuresComplete && b.currency === o.currency),
      };
    })
    .sort((a, b) => (a.woNumber ?? '').localeCompare(b.woNumber ?? '', undefined, { numeric: true }) || a.id.localeCompare(b.id));

  return {
    workOrders,
    plans,
    split,
    rollup: rollupProject({ workOrders, lines: money ?? [], plans, split, restricted }),
  };
}

export const workOrderFinanceRepository = {
  projectPlanVsActual: (projectId: string): Promise<ProjectPlanVsActual> => wrap(() => load(projectId)),
  savePlan: (input: PlanLineInput, existingId: string | null): Promise<void> => wrap(() => savePlanLine(input, existingId)),
  deletePlan: (id: string): Promise<void> => wrap(() => deletePlanLine(id)),
  setSplit: (projectId: string, split: readonly SplitPercent[]): Promise<number> => wrap(() => setSharedSplit(projectId, split)),
  clearSplit: (projectId: string): Promise<number> => wrap(() => clearSharedSplit(projectId)),
};
