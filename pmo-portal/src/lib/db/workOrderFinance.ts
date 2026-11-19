import { supabase } from '@/src/lib/supabase/client';
import { AppError } from '@/src/lib/appError';
import { fetchAllPages } from '@/src/lib/pagedRead';
import type { CostSource } from '@/src/lib/db/workOrderCosts';
import type { CostAmountLine, CostReason, PlanKind, PlanLine, SplitPercent } from '@/src/lib/workOrderPlanVsActual';

/**
 * Plan versus actual per work order (#2519, migrations 0997–0999). Data access only — every figure is derived in
 * `src/lib/workOrderPlanVsActual.ts`.
 *
 *   • `listProjectCostAmounts` — the ONE money read (`work_order_cost_amounts`, definer, role-gated): every cost record
 *     of the project with its amount and the reason it is or is not summed. A role that cannot read work-order money
 *     is refused (42501); the repository turns that into "restricted", never into zero.
 *   • plan figures — `work_order_plan_lines` (RLS: Admin, Executive, Finance, Project Manager).
 *   • the custom shared-cost split — read from `project_shared_cost_splits`, written only through its two RPCs.
 *
 * org_id is never sent: RLS, the column default and the RPCs scope everything to the caller's org.
 */

const MALFORMED = 'malformed-response';
const SOURCES: readonly CostSource[] = ['purchase_request', 'purchase_order', 'goods_receipt', 'vendor_bill', 'timesheet_entry', 'stock_document', 'equipment_usage'];
const REASONS: readonly CostReason[] = ['counted', 'commitment', 'stocked', 'transfer', 'no-rate', 'not-posted'];
const KINDS: readonly PlanKind[] = ['direct_budget', 'indirect_budget', 'equipment_hours', 'crew_hours'];
const EXACT = /^-?\d+(\.\d{1,2})?$/;

function str(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 ? v : null;
}
function num(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

interface CostAmountRow {
  source: string; record_id: string; project_id: string | null; work_order_id: string | null; discipline_id: string | null;
  occurred_on: string | null; reference: string | null; currency: string | null; amount: string | null; reason: string;
  quantity: number | string | null; quantity_unit: string | null; person_id: string | null;
}

/** Every cost record of one project with what it costs. A malformed row is an error, never a plausible figure. */
export async function listProjectCostAmounts(projectId: string): Promise<CostAmountLine[]> {
  const rows = await fetchAllPages<CostAmountRow>((from, to) =>
    supabase.rpc('work_order_cost_amounts', { p_project_id: projectId })
      .order('record_id', { ascending: true }).range(from, to) as unknown as PromiseLike<{ data: CostAmountRow[] | null; error: { message: string; code?: string } | null }>);
  return rows.map((r) => {
    if (!SOURCES.includes(r.source as CostSource) || !REASONS.includes(r.reason as CostReason) || !str(r.record_id)) {
      throw new AppError('Work-order cost read: unexpected row', MALFORMED);
    }
    const amount = r.amount === null ? null : String(r.amount);
    if (amount !== null && !EXACT.test(amount)) throw new AppError('Work-order cost read: unreadable amount', MALFORMED);
    return {
      source: r.source as CostSource,
      recordId: r.record_id,
      projectId: r.project_id,
      workOrderId: r.work_order_id,
      disciplineId: r.discipline_id,
      occurredOn: r.occurred_on,
      reference: r.reference,
      currency: r.currency,
      amount,
      reason: r.reason as CostReason,
      quantity: num(r.quantity),
      quantityUnit: r.quantity_unit,
      personId: r.person_id,
    };
  });
}

interface PlanRow { id: string; work_order_id: string; discipline_id: string | null; kind: string; value: number | string; note: string | null }

/** The project's plan figures (money as exact scale-two text, hours as a decimal string). */
export async function listProjectPlanLines(projectId: string): Promise<PlanLine[]> {
  const rows = await fetchAllPages<PlanRow>((from, to) =>
    supabase.from('work_order_plan_lines').select('id, work_order_id, discipline_id, kind, value, note')
      .eq('project_id', projectId).order('id', { ascending: true }).range(from, to) as unknown as PromiseLike<{ data: PlanRow[] | null; error: { message: string; code?: string } | null }>);
  return rows.map((r) => {
    const value = num(r.value);
    if (!KINDS.includes(r.kind as PlanKind) || value === null) throw new AppError('Plan figure: unexpected row', MALFORMED);
    return { id: r.id, workOrderId: r.work_order_id, disciplineId: r.discipline_id, kind: r.kind as PlanKind, value: value.toFixed(2), note: r.note };
  });
}

export interface PlanLineInput {
  projectId: string;
  workOrderId: string;
  disciplineId: string | null;
  kind: PlanKind;
  /** Non-negative decimal with at most two places (validated again by the database). */
  value: string;
  note: string | null;
}

/** Create a plan figure, or change the value and note of the existing one (work order × discipline × kind). */
export async function savePlanLine(input: PlanLineInput, existingId: string | null): Promise<void> {
  if (existingId) {
    const { error } = await supabase.from('work_order_plan_lines').update({ value: Number(input.value), note: input.note }).eq('id', existingId);
    if (error) throw new AppError(error.message, error.code);
    return;
  }
  const { error } = await supabase.from('work_order_plan_lines').insert({
    project_id: input.projectId,
    work_order_id: input.workOrderId,
    discipline_id: input.disciplineId,
    kind: input.kind,
    value: Number(input.value),
    note: input.note,
  });
  if (error) throw new AppError(error.message, error.code);
}

export async function deletePlanLine(id: string): Promise<void> {
  const { error } = await supabase.from('work_order_plan_lines').delete().eq('id', id);
  if (error) throw new AppError(error.message, error.code);
}

/** The saved custom split, or null when the project uses the default. */
export async function getSharedSplit(projectId: string): Promise<SplitPercent[] | null> {
  const rows = await fetchAllPages<{ work_order_id: string; percent: number | string }>((from, to) =>
    supabase.from('project_shared_cost_splits').select('work_order_id, percent').eq('project_id', projectId)
      .order('work_order_id', { ascending: true }).range(from, to));
  if (rows.length === 0) return null;
  return rows.map((r) => {
    const p = num(r.percent);
    if (p === null) throw new AppError('Shared-cost split: unreadable percentage', MALFORMED);
    return { workOrderId: r.work_order_id, percent: String(Number(p.toFixed(4))) };
  });
}

export async function setSharedSplit(projectId: string, split: readonly SplitPercent[]): Promise<number> {
  const { data, error } = await supabase.rpc('set_shared_cost_split', {
    p_project_id: projectId,
    p_split: split.map((s) => ({ work_order_id: s.workOrderId, percent: s.percent })),
  });
  if (error) throw new AppError(error.message, error.code);
  return Number(data ?? 0);
}

export async function clearSharedSplit(projectId: string): Promise<number> {
  const { data, error } = await supabase.rpc('clear_shared_cost_split', { p_project_id: projectId });
  if (error) throw new AppError(error.message, error.code);
  return Number(data ?? 0);
}
