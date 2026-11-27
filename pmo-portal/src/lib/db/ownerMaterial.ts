import { supabase } from '@/src/lib/supabase/client';
import { AppError } from '@/src/lib/appError';

/**
 * Owner-supplied material stages (#3010, frozen contract v2.1). The database computes every quantity and percentage
 * (decimal strings, scale <= 3; percentages 0..100 or null); this module only carries the request and the strings.
 * No org argument is ever sent.
 */
export const MATERIAL_PAGE_SIZE = 50;

export interface MaterialLine {
  planId: string; sectionId: string; itemId: string; itemCode: string; itemName: string; unit: string;
  categoryCode: string | null; ownerCostCode: string | null;
  planned: string; requested: string; setAside: string; received: string; issued: string; returned: string;
  transferIn: string; transferOut: string; ownerReturn: string; closing: string;
  requestedPct: string | null; setAsidePct: string | null; receivedPct: string | null; issuedPct: string | null; closingPct: string | null;
  /** Contract v2: the date the loaded opening position stands at, and its verbatim source text (display only); null when the line has no opening. */
  asOf: string | null; evidence: Record<string, unknown> | null;
}
export interface MaterialRollupRow {
  workOrderId: string; number: string | null; title: string; sectionCount: number;
  requestedPct: string | null; setAsidePct: string | null; receivedPct: string | null; issuedPct: string | null; closingPct: string | null;
  reconciliationStep: string | null; reconciliationPct: string | null; unallocatedMovementCount: number;
}
export interface Paged<T> { rows: T[]; total: number }
export interface ReconciliationStep { id: string; name: string; position: number; percentage: string }
export interface MaterialCategory { id: string; code: string; name: string }
export interface MaterialConfig { steps: ReconciliationStep[]; categories: MaterialCategory[] }
/** The two numbers a work order can carry: the owner's own (client purchase order) and ours. */
export interface OrderNumbers { workOrderId: string; clientPoNumber: string | null; woNumber: string | null }
/** One location (section) of a work order: its own stage percentages and reconciliation step (contract v2.1). */
export interface SectionStage {
  sectionId: string; code: string | null; name: string; ownerCostCode: string | null; lineCount: number;
  requestedPct: string | null; setAsidePct: string | null; receivedPct: string | null; issuedPct: string | null; closingPct: string | null;
  stepId: string | null; step: string | null; stepPct: string | null; asOf: string | null;
}

type Raw = Record<string, unknown>;
const MALFORMED = 'PMO_MALFORMED';
const str = (v: unknown): string => (v === null || v === undefined ? '' : String(v));
const strOrNull = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));
const rows = (data: unknown): Raw[] => {
  if (data === null || data === undefined) return [];
  if (!Array.isArray(data)) throw new AppError('Material read: unexpected response', MALFORMED);
  return data as Raw[];
};
const fail = (error: { message: string; code?: string; details?: string }): never => { throw new AppError(error.message, error.code, error.details); };
const totalOf = (r: Raw[]): number => (r.length ? Number(r[0].total_count ?? r.length) : 0);

export async function listMaterialLines(workOrderId: string, sectionId: string | null, page: number, pageSize = MATERIAL_PAGE_SIZE): Promise<Paged<MaterialLine>> {
  const { data, error } = await supabase.rpc('om_material_lines', { p_work_order_id: workOrderId, ...(sectionId ? { p_section_id: sectionId } : {}), p_page: page, p_page_size: pageSize });
  if (error) return fail(error);
  const r = rows(data);
  return {
    total: totalOf(r),
    rows: r.map((x) => ({
      planId: str(x.plan_id), sectionId: str(x.section_id), itemId: str(x.item_id), itemCode: str(x.item_code), itemName: str(x.item_name), unit: str(x.unit),
      categoryCode: strOrNull(x.category_code), ownerCostCode: strOrNull(x.owner_cost_code),
      planned: str(x.planned), requested: str(x.requested), setAside: str(x.set_aside), received: str(x.received), issued: str(x.issued),
      returned: str(x.returned), transferIn: str(x.transfer_in), transferOut: str(x.transfer_out), ownerReturn: str(x.owner_return), closing: str(x.closing),
      requestedPct: strOrNull(x.requested_pct), setAsidePct: strOrNull(x.set_aside_pct), receivedPct: strOrNull(x.received_pct),
      issuedPct: strOrNull(x.issued_pct), closingPct: strOrNull(x.closing_pct),
      asOf: strOrNull(x.as_of), evidence: x.evidence && typeof x.evidence === 'object' ? (x.evidence as Record<string, unknown>) : null,
    })),
  };
}

export async function listMaterialRollup(projectId: string, page: number, pageSize = MATERIAL_PAGE_SIZE): Promise<Paged<MaterialRollupRow>> {
  const { data, error } = await supabase.rpc('om_material_rollup', { p_project_id: projectId, p_page: page, p_page_size: pageSize });
  if (error) return fail(error);
  const r = rows(data);
  return {
    total: totalOf(r),
    rows: r.map((x) => ({
      workOrderId: str(x.work_order_id), number: strOrNull(x.number), title: str(x.title), sectionCount: Number(x.section_count ?? 0),
      requestedPct: strOrNull(x.requested_pct), setAsidePct: strOrNull(x.set_aside_pct), receivedPct: strOrNull(x.received_pct),
      issuedPct: strOrNull(x.issued_pct), closingPct: strOrNull(x.closing_pct),
      reconciliationStep: strOrNull(x.reconciliation_step), reconciliationPct: strOrNull(x.reconciliation_pct),
      unallocatedMovementCount: Number(x.unallocated_movement_count ?? 0),
    })),
  };
}

export async function getMaterialConfig(): Promise<MaterialConfig> {
  const { data, error } = await supabase.rpc('om_material_config');
  if (error) return fail(error);
  const steps = ((data as { steps?: Raw[] } | null)?.steps ?? []).map((s) => ({ id: str(s.id), name: str(s.name), position: Number(s.position), percentage: str(s.percentage) }));
  const categories = ((data as { categories?: Raw[] } | null)?.categories ?? []).map((c) => ({ id: str(c.id), code: str(c.code), name: str(c.name) }));
  return { steps: steps.sort((a, b) => a.position - b.position), categories };
}

export async function setSectionReconciliation(sectionId: string, stepId: string, reason: string | null): Promise<void> {
  const { error } = await supabase.rpc('om_material_set_reconciliation', { p_section_id: sectionId, p_step_id: stepId, ...(reason ? { p_reason: reason } : {}) });
  if (error) fail(error);
}

export async function listSectionStages(workOrderId: string): Promise<SectionStage[]> {
  const { data, error } = await supabase.rpc('om_material_section_rollup', { p_work_order_id: workOrderId });
  if (error) return fail(error);
  return rows(data).map((x) => ({
    sectionId: str(x.section_id), code: strOrNull(x.section_code), name: str(x.section_name), ownerCostCode: strOrNull(x.owner_cost_code), lineCount: Number(x.line_count ?? 0),
    requestedPct: strOrNull(x.requested_pct), setAsidePct: strOrNull(x.set_aside_pct), receivedPct: strOrNull(x.received_pct), issuedPct: strOrNull(x.issued_pct), closingPct: strOrNull(x.closing_pct),
    stepId: strOrNull(x.reconciliation_step_id), step: strOrNull(x.reconciliation_step), stepPct: strOrNull(x.reconciliation_pct), asOf: strOrNull(x.as_of),
  }));
}

/** Both order numbers of the work orders on a rollup page (one read; the rollup carries only one of them). */
export async function listOrderNumbers(workOrderIds: string[]): Promise<OrderNumbers[]> {
  if (workOrderIds.length === 0) return [];
  const { data, error } = await supabase.from('work_orders').select('id, wo_number, client_po_number').in('id', workOrderIds).limit(100); // one rollup page is at most 100 work orders
  if (error) return fail(error);
  return rows(data).map((x) => ({ workOrderId: str(x.id), clientPoNumber: strOrNull(x.client_po_number), woNumber: strOrNull(x.wo_number) }));
}
