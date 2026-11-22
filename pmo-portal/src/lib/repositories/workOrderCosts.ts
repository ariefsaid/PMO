/**
 * repositories/workOrderCosts.ts (#2517) — the seam over work-order cost attribution (ADR-0104):
 * the discipline list, the one write path and the one read seam. Standalone module (same shape as
 * `costAttribution.ts`): imported directly by its consumers. Errors keep their Postgres code via `wrap`.
 */
import {
  listCostDisciplines,
  createCostDiscipline,
  updateCostDiscipline,
  archiveCostDiscipline,
  type CostDisciplineInput,
  setCostAttribution,
  listWorkOrderCostLines,
  groupCostLinesBySource,
  hasAttribution,
  type CostAttribution,
  type CostDiscipline,
  type AttributionSource,
  type CostSource,
  type WorkOrderCostLine,
} from '@/src/lib/db/workOrderCosts';
import { listWorkOrderCostMoney, listWorkOrderCostLinks, listWorkOrderTimesheetLabels } from '@/src/lib/db/workOrderCostMoney';
import { wrap } from './repositoryErrors';

export type { AttributionSource, CostAttribution, CostDiscipline, CostDisciplineInput, CostSource, WorkOrderCostLine };
export { DISCIPLINE_CODE_MAX, DISCIPLINE_NAME_MAX } from '@/src/lib/db/workOrderCosts';
export { NO_ATTRIBUTION, hasAttribution, COST_SOURCES } from '@/src/lib/db/workOrderCosts';

/**
 * The record was saved (and, for a stock movement, posted) but its work order / discipline was refused. Carries the
 * saved record's id so the form can open it instead of creating it again.
 */
export class AttributionRefusedError extends Error {
  readonly refusal: unknown;
  readonly recordId: string;
  constructor(refusal: unknown, recordId: string) {
    super(String((refusal as { message?: string })?.message ?? 'attribution refused'));
    this.name = 'AttributionRefusedError';
    this.refusal = refusal;
    this.recordId = recordId;
  }
}

export const workOrderCostRepository = {
  disciplines: (): Promise<CostDiscipline[]> => wrap(() => listCostDisciplines()),
  /** #2623: the Admin-kept list (RLS is the authority: Admin only, 0950). */
  createDiscipline: (input: CostDisciplineInput): Promise<string> => wrap(() => createCostDiscipline(input)),
  updateDiscipline: (id: string, input: CostDisciplineInput): Promise<void> => wrap(() => updateCostDiscipline(id, input)),
  archiveDiscipline: (id: string): Promise<void> => wrap(() => archiveCostDiscipline(id)),
  setAttribution: (source: AttributionSource, ids: string[], attribution: CostAttribution): Promise<number> =>
    wrap(() => setCostAttribution(source, ids, attribution)),
  /**
   * Called by a form right after it created a record: writes the attribution only when one was picked, so a
   * form whose pickers were left empty makes no extra call.
   */
  attributeCreated: async (source: CostSource, id: string | null | undefined, attribution: CostAttribution | null | undefined): Promise<void> => {
    if (!id || !hasAttribution(attribution)) return;
    await wrap(() => setCostAttribution(source, [id], attribution));
  },
  /**
   * Same, for a create that resolved to a row (or an id): a refusal becomes AttributionRefusedError carrying the
   * saved record's id, so the form can say "saved, but…" instead of offering a retry that would duplicate it.
   */
  attributeOrRefuse: async (source: CostSource, created: unknown, attribution: CostAttribution | null | undefined): Promise<void> => {
    const id = typeof created === 'string' ? created : (created as { id?: unknown } | null | undefined)?.id;
    if (typeof id !== 'string' || !id || !hasAttribution(attribution)) return;
    try { await wrap(() => setCostAttribution(source, [id], attribution)); } catch (err) { throw new AttributionRefusedError(err, id); }
  },
  /**
   * A purchase's lines, each to its own work order (wo-per-purchase-line). `byLine` maps a line id to the work order picked
   * for it (null / absent = "same as the request": nothing is written). Run right after the purchase is saved; a refusal
   * becomes AttributionRefusedError carrying the purchase id, so the form says "saved, but…" and never offers a duplicating retry.
   */
  attributeLines: async (purchaseId: string, byLine: Readonly<Record<string, string | null>>): Promise<void> => {
    const groups = new Map<string, string[]>();
    for (const [lineId, workOrderId] of Object.entries(byLine)) {
      if (!workOrderId) continue;
      groups.set(workOrderId, [...(groups.get(workOrderId) ?? []), lineId]);
    }
    try {
      for (const [workOrderId, ids] of groups) {
        await wrap(() => setCostAttribution('procurement_item', ids, { workOrderId, disciplineId: null }));
      }
    } catch (err) { throw new AttributionRefusedError(err, purchaseId); }
  },
  costLines: (workOrderId: string): Promise<WorkOrderCostLine[]> => wrap(() => listWorkOrderCostLines(workOrderId)),
  /** Per-source money behind the lines (#2518); `null` for a source the caller cannot read. */
  costLinks: (lines: WorkOrderCostLine[]) => wrap(() => listWorkOrderCostLinks(lines)),
  timesheetLabels: (lines: WorkOrderCostLine[]) => wrap(() => listWorkOrderTimesheetLabels(lines)),
  costMoney: (lines: WorkOrderCostLine[]) => wrap(() => listWorkOrderCostMoney(lines)),
  /** One work order's cost lines, grouped by source — the foundation #2518/#2519/#2523 read. */
  costLinesBySource: async (workOrderId: string) => groupCostLinesBySource(await wrap(() => listWorkOrderCostLines(workOrderId))),
};
