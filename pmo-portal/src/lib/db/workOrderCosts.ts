import { supabase } from '@/src/lib/supabase/client';
import { AppError } from '@/src/lib/appError';
import { fetchAllRowsByKeyset } from '@/src/lib/pagedRead';

/**
 * Work orders on the cost side (#2517, migrations 0950 + 0951, ADR-0103).
 *
 * Seven cost sources can name an optional work order and an optional discipline. The database decides
 * whether that is allowed (the work order must be on the cost's own project and org; the discipline must be
 * the org's, live) — this module only carries the request:
 *
 *   • `listCostDisciplines` — the org's live discipline list (the picker).
 *   • `setCostAttribution` — the ONE write path (`set_cost_attribution`), run after the source record exists.
 *     It never changes a status, an approval or a money figure.
 *   • `listWorkOrderCostLines` — the ONE read seam (`work_order_cost_lines`, security_invoker: each source's
 *     own RLS decides what the caller sees).
 *
 * org_id is never sent: RLS and the RPC scope everything to the caller's org.
 */

export type CostSource =
  | 'purchase_request'
  | 'purchase_order'
  | 'goods_receipt'
  | 'vendor_bill'
  | 'timesheet_entry'
  | 'stock_document'
  | 'equipment_usage';

export const COST_SOURCES: readonly CostSource[] = [
  'purchase_request',
  'purchase_order',
  'goods_receipt',
  'vendor_bill',
  'timesheet_entry',
  'stock_document',
  'equipment_usage',
];

export interface CostDiscipline {
  id: string;
  code: string;
  name: string;
}

/** What a cost record is attributed to. Both null = a project-level cost with no discipline. */
export interface CostAttribution {
  workOrderId: string | null;
  disciplineId: string | null;
}

export interface WorkOrderCostLine {
  source: CostSource;
  recordId: string;
  projectId: string | null;
  workOrderId: string | null;
  disciplineId: string | null;
  occurredOn: string | null;
  reference: string | null;
  quantity: number | null;
  quantityUnit: string | null;
}

export const NO_ATTRIBUTION: CostAttribution = { workOrderId: null, disciplineId: null };

export function hasAttribution(a: CostAttribution | null | undefined): a is CostAttribution {
  return Boolean(a && (a.workOrderId || a.disciplineId));
}

/** The org's live disciplines, by name. */
export async function listCostDisciplines(): Promise<CostDiscipline[]> {
  const rows = await fetchAllRowsByKeyset<CostDiscipline>(async (afterId, limit) => {
    let q = supabase
      .from('cost_disciplines')
      .select('id, code, name')
      .is('archived_at', null)
      .order('id', { ascending: true });
    if (afterId !== null) q = q.gt('id', afterId);
    return q.limit(limit);
  });
  return rows.sort((a, b) => a.name.localeCompare(b.name) || a.code.localeCompare(b.code));
}

/**
 * Set (or clear, with nulls) the work order and discipline of 1..500 records of one source. Resolves to the
 * number of records changed. A refusal keeps its Postgres code (`23514` rule, `42501` not yours, `P0002`
 * not found) so `classifyMutationError` can map it.
 */
export async function setCostAttribution(source: CostSource, ids: string[], attribution: CostAttribution): Promise<number> {
  const { data, error } = await supabase.rpc('set_cost_attribution', {
    p_source: source,
    p_ids: ids,
    p_work_order_id: attribution.workOrderId,
    p_discipline_id: attribution.disciplineId,
  });
  if (error) throw new AppError(error.message, error.code);
  return Number(data ?? 0);
}

interface CostLineRow {
  id: string;
  source: string | null;
  project_id: string | null;
  work_order_id: string | null;
  discipline_id: string | null;
  occurred_on: string | null;
  reference: string | null;
  quantity: number | null;
  quantity_unit: string | null;
}

/** Every cost record the caller can see on one work order, oldest first. */
export async function listWorkOrderCostLines(workOrderId: string): Promise<WorkOrderCostLine[]> {
  const rows = await fetchAllRowsByKeyset<CostLineRow>(async (afterId, limit) => {
    let q = supabase
      .from('work_order_cost_lines')
      .select('id:record_id, source, project_id, work_order_id, discipline_id, occurred_on, reference, quantity, quantity_unit')
      .eq('work_order_id', workOrderId)
      .order('record_id', { ascending: true });
    if (afterId !== null) q = q.gt('record_id', afterId);
    return q.limit(limit) as unknown as PromiseLike<{ data: CostLineRow[] | null; error: { message: string; code?: string } | null }>;
  });
  return rows
    .map((r) => ({
      source: r.source as CostSource,
      recordId: r.id,
      projectId: r.project_id,
      workOrderId: r.work_order_id,
      disciplineId: r.discipline_id,
      occurredOn: r.occurred_on,
      reference: r.reference,
      quantity: r.quantity,
      quantityUnit: r.quantity_unit,
    }))
    .sort((a, b) => (a.occurredOn ?? '').localeCompare(b.occurredOn ?? '') || a.recordId.localeCompare(b.recordId));
}

/** The read seam's lines grouped by source, every source present (empty when none). */
export function groupCostLinesBySource(lines: WorkOrderCostLine[]): Record<CostSource, WorkOrderCostLine[]> {
  const out = Object.fromEntries(COST_SOURCES.map((s) => [s, [] as WorkOrderCostLine[]])) as Record<CostSource, WorkOrderCostLine[]>;
  for (const line of lines) out[line.source]?.push(line);
  return out;
}
