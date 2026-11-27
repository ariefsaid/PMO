/**
 * repositories/workOrderFinance.ts (#2519) — the seam over plan versus actual per work order (ADR-0017).
 * Standalone module (same shape as `workOrderCosts.ts`): imported directly by its consumers. Errors keep their
 * Postgres code via `wrap`.
 *
 * `projectPlanVsActual` gathers the six sources one project's figures need and hands them to the pure
 * `rollupProject` — the only place a figure is computed (FR-WPVA-010: the screens never re-sum).
 */
import {
  parseCostAmountRows, parsePlanRows, parseSplitRows,
  getDashboardWorkOrderCosts,
  listProjectCostAmounts,
  listProjectPlanLines,
  setWorkOrderPlan,
  getSharedSplit,
  setSharedSplit,
  clearSharedSplit,
  type PlanChange,
} from '@/src/lib/db/workOrderFinance';
import { listProjectWorkOrders } from '@/src/lib/db/workOrders';
import { parseBillingRows, WORK_ORDER_BILLING_ROW_LIMIT, listWorkOrderBilling, type WorkOrderBillingRow } from '@/src/lib/db/workOrderBilling';
import { parseProjectFinances, getProjectFinances } from '@/src/lib/db/revenue';
import { rollupProject, type CostAmountLine, type PlanLine, type ProjectRollup, type PvaWorkOrder, type SplitPercent } from '@/src/lib/workOrderPlanVsActual';
import { supabase } from '@/src/lib/supabase/client';
import { AppError } from '@/src/lib/appError';
import { wrap } from './repositoryErrors';

export type { PlanChange };

export interface ProjectPlanVsActual {
  workOrders: PvaWorkOrder[];
  plans: PlanLine[];
  split: SplitPercent[] | null;
  rollup: ProjectRollup;
  /** The read's own lines, each with the reason it is or is not summed (empty when restricted). */
  costLines?: CostAmountLine[];
}

function isRefused(err: unknown): boolean {
  const code = (err as { code?: unknown } | null)?.code;
  return typeof code === 'string' && /^[0-9A-Z]{5}$/.test(code);
}

async function load(projectId: string): Promise<ProjectPlanVsActual> {
  let unavailableProject = false;
  const [orders, billing, money, projectFinances] = await Promise.all([
    listProjectWorkOrders(projectId),
    // Revenue is the shipped per-work-order billing read; when it cannot be read, revenue is unknown, never zero.
    listWorkOrderBilling(projectId).catch((): WorkOrderBillingRow[] | null => null),
    // FR-WPVA-013: canonical database refusals produce the restricted state.
    listProjectCostAmounts(projectId).then((lines): CostAmountLine[] | null => lines, (err) => {
      if (isRefused(err)) { unavailableProject = (err as { code?: string }).code === 'P0002'; return null; }
      throw err;
    }),
    getProjectFinances(projectId).catch(() => null),
  ]);
  const restricted = money === null;
  const [plans, split] = restricted ? [[], null] : await Promise.all([listProjectPlanLines(projectId), getSharedSplit(projectId)]);

  return assemble(unavailableProject ? [] : orders, unavailableProject ? null : billing, money, plans, split, unavailableProject ? null : projectFinances?.invoices ?? null);
}

function assemble(
  orders: Pick<import('@/src/lib/db/workOrders').WorkOrderRow, 'id' | 'wo_number' | 'title' | 'status' | 'currency'>[],
  billing: WorkOrderBillingRow[] | null, money: CostAmountLine[] | null, plans: PlanLine[], split: SplitPercent[] | null,
  projectRevenue: Parameters<typeof rollupProject>[0]['projectRevenue'],
): ProjectPlanVsActual {
  const restricted = money === null;
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
        orderValue: b && b.currency === o.currency && Number.isFinite(b.orderNet) ? b.orderNet.toFixed(2) : null,
      };
    })
    .sort((a, b) => (a.woNumber ?? '').localeCompare(b.woNumber ?? '', undefined, { numeric: true }) || a.id.localeCompare(b.id));

  return {
    workOrders,
    plans,
    split,
    rollup: rollupProject({ workOrders, lines: money ?? [], plans, split, restricted, projectRevenue }),
    costLines: money ?? [],
  };
}

/** Independent source failures retain the single-project read contract. */
async function loadMany(ids: readonly string[]): Promise<Record<string, ProjectPlanVsActual | Error>> {
  if (ids.length === 0) return {};
  const { data, error } = await supabase.rpc('get_projects_plan_actual_sources', { p_project_ids: [...ids] });
  if (error) throw new AppError(error.message, error.code);
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new AppError('Malformed project sources', 'malformed-response');
  const result: Record<string, ProjectPlanVsActual | Error> = {};
  for (const id of ids) {
    try {
      const sources = data[id] as Record<string, { data?: unknown; error?: { message: string; code: string } }> | undefined;
      const read = <T,>(name: string): T => {
        const source = sources?.[name];
        if (!source) throw new AppError('Missing project source', 'malformed-response');
        if (source.error) throw new AppError(source.error.message, source.error.code);
        return source.data as T;
      };
      const optional = <T,>(fn: () => T): T | null => { try { return fn(); } catch { return null; } };
      const orders = read<Parameters<typeof assemble>[0]>('orders');
      const billing = await (async () => {
        try {
          const rows = read<Parameters<typeof parseBillingRows>[0]>('billing');
          if (rows.length > WORK_ORDER_BILLING_ROW_LIMIT) return null;
          return await parseBillingRows(rows, false);
        } catch { return null; }
      })();
      let money: CostAmountLine[] | null;
      try { money = parseCostAmountRows(read('money')); }
      catch (err) { if (isRefused(err)) money = null; else throw err; }
      const finances = optional(() => parseProjectFinances(read('finances'), id));
      const plans = money === null ? [] : parsePlanRows(read('plans'));
      const split = money === null ? null : parseSplitRows(read('split'));
      const unavailableProject = sources?.money?.error?.code === 'P0002';
      result[id] = assemble(unavailableProject ? [] : orders, unavailableProject ? null : billing, money, plans, split, unavailableProject ? null : finances?.invoices ?? null);
    } catch (err) { result[id] = err instanceof Error ? err : new Error(String(err)); }
  }
  return result;
}

export const workOrderFinanceRepository = {
  projectsPlanVsActual: (ids: readonly string[]) => wrap(() => loadMany(ids)),
  dashboardCosts: (projectIds: readonly string[]) => wrap(async () => {
    try {
      return await getDashboardWorkOrderCosts(projectIds);
    } catch (error) {
      if ((error as { code?: string } | null)?.code === '42501') return null;
      throw error;
    }
  }),
  projectPlanVsActual: (projectId: string): Promise<ProjectPlanVsActual> => wrap(() => load(projectId)),
  setPlan: (projectId: string, workOrderId: string, changes: readonly PlanChange[]): Promise<void> => wrap(() => setWorkOrderPlan(projectId, workOrderId, changes)),
  setSplit: (projectId: string, split: readonly SplitPercent[]): Promise<number> => wrap(() => setSharedSplit(projectId, split)),
  clearSplit: (projectId: string): Promise<number> => wrap(() => clearSharedSplit(projectId)),
};
