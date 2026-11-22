import { supabase } from '@/src/lib/supabase/client';
import { nullableArg } from './nullableArg';
import { AppError, assertWriteLanded, toAppError } from '@/src/lib/appError';
import type { PlanLineInput, UsageStandard } from '@/src/lib/consumablePlan';

/**
 * Consumable usage standards and the work-order consumable plan (#2577). The database enforces every rule
 * (1075 RLS and constraints, 1076 functions); this module reads and writes and keeps quantities as decimal
 * strings both ways (they never become JS floats, NFR-CUS-002).
 */

export const USAGE_STANDARDS_PAGE_SIZE = 25;
/** A `numeric` column or argument goes on the wire as the exact decimal TEXT the caller typed (NFR-CUS-002), which the
 * generated type cannot state: it says `number`. The one cast in this module, and it is the number's text, not a float. */
const asNumeric = (v: string) => v as unknown as number;

export interface UsageStandardRow {
  id: string;
  itemId: string;
  workUnit: string;
  boqCodePrefix: string | null;
  qtyPerUnit: string;
  marginPct: string;
  archivedAt: string | null;
}
export interface UsageStandardInput {
  itemId: string;
  workUnit: string;
  boqCodePrefix: string | null;
  qtyPerUnit: string;
  marginPct: string;
}
export interface UsageStandardFilter { includeArchived: boolean; itemId?: string; workUnit?: string; page: number }

const COLUMNS = 'id, item_id, work_unit, boq_code_prefix, qty_per_unit::text, margin_pct::text, archived_at';
/** What `COLUMNS` returns: the select asks for `::text`, so the two numerics arrive as exact decimal text. */
type SelectedRow = { id: string; item_id: string; work_unit: string; boq_code_prefix: string | null; qty_per_unit: string; margin_pct: string; archived_at: string | null };
const toRow = (r: SelectedRow): UsageStandardRow => ({
  id: r.id, itemId: r.item_id, workUnit: r.work_unit, boqCodePrefix: r.boq_code_prefix, qtyPerUnit: r.qty_per_unit, marginPct: r.margin_pct, archivedAt: r.archived_at,
});
const escapeLike = (v: string) => v.replace(/[\\%_]/g, (c) => `\\${c}`);

/** FR-CUS-004: bounded pages, filter by item and work unit (a contains match, case-blind). */
export async function listUsageStandards(f: UsageStandardFilter): Promise<{ rows: UsageStandardRow[]; total: number }> {
  const from = f.page * USAGE_STANDARDS_PAGE_SIZE;
  let q = supabase.from('consumable_usage_standards').select(COLUMNS, { count: 'exact' }).order('work_unit').order('id')
    .range(from, from + USAGE_STANDARDS_PAGE_SIZE - 1);
  if (!f.includeArchived) q = q.is('archived_at', null);
  if (f.itemId) q = q.eq('item_id', f.itemId);
  if (f.workUnit?.trim()) q = q.ilike('work_unit', `%${escapeLike(f.workUnit.trim())}%`);
  const { data, error, count } = await q;
  if (error) throw toAppError(error);
  return { rows: (data ?? []).map(toRow), total: count ?? 0 };
}

/** FR-CUS-004: lines in live (Draft or Issued) work orders each active standard's rule matches. */
export async function getStandardMatchCounts(): Promise<Record<string, number>> {
  const { data, error } = await supabase.rpc('cus_standard_match_counts');
  if (error) throw toAppError(error);
  return Object.fromEntries((data ?? []).map((r: { standard_id: string; match_lines: number }) => [r.standard_id, Number(r.match_lines)]));
}

const payload = (i: UsageStandardInput) => ({
  work_unit: i.workUnit.trim(), boq_code_prefix: i.boqCodePrefix?.trim() || null,
  qty_per_unit: asNumeric(i.qtyPerUnit.trim()), margin_pct: asNumeric(i.marginPct.trim() || '0'),
});
export async function createUsageStandard(i: UsageStandardInput): Promise<void> {
  const { error } = await supabase.from('consumable_usage_standards').insert({ item_id: i.itemId, ...payload(i) });
  if (error) throw toAppError(error);
}
/** The item of a standard is not editable: a different item is a different standard (1075 column grants). */
export async function updateUsageStandard(id: string, i: UsageStandardInput): Promise<void> {
  const { data, error } = await supabase.from('consumable_usage_standards').update(payload(i)).eq('id', id).select('id');
  if (error) throw toAppError(error);
  assertWriteLanded(data, 'You cannot change this usage standard.');
}
export async function setUsageStandardArchived(id: string, archived: boolean): Promise<void> {
  const { data, error } = await supabase.from('consumable_usage_standards').update({ archived_at: archived ? new Date().toISOString() : null }).eq('id', id).select('id');
  if (error) throw toAppError(error);
  assertWriteLanded(data, 'You cannot archive this usage standard.');
}

// ── the consumable plan of a work order ──────────────────────────────────────────────────────────────────────────

export type ConsumablePlanSource = 'standard' | 'adjusted';
export interface ConsumablePlanBasis { boqItemId: string; code: string; unit: string; workQty: string; standardId: string; qtyPerUnit: string; marginPct: string; result: string }
export interface ConsumablePlanLine {
  itemId: string;
  itemCode: string;
  itemName: string;
  unitCode: string;
  generatedQty: string;
  adjustedQty: string | null;
  adjustReason: string | null;
  adjustedBy: string | null;
  adjustedAt: string | null;
  plannedQty: string;
  priorQty: string;
  source: ConsumablePlanSource;
  basis: ConsumablePlanBasis[];
}
export interface UnplannedItem { itemId: string; itemCode: string; itemName: string; unitCode: string; plannedQty: string; priorQty: string; source: 'allowance' | 'none' }
export interface NoStandardLine { boqItemId: string; itemCode: string; description: string; unit: string; quantity: string }
export interface ConsumablePlan {
  workOrderId: string;
  workOrderStatus: string;
  generatedAt: string | null;
  outOfDate: boolean;
  lines: ConsumablePlanLine[];
  noStandard: NoStandardLine[];
  unplanned: UnplannedItem[];
}

type J = Record<string, unknown>;
const str = (v: unknown): string => (v == null ? '' : String(v));
const strOrNull = (v: unknown): string | null => (v == null ? null : String(v));

export function parseConsumablePlan(raw: unknown): ConsumablePlan {
  const j = (raw ?? {}) as J;
  const arr = (v: unknown): J[] => (Array.isArray(v) ? (v as J[]) : []);
  return {
    workOrderId: str(j.work_order_id), workOrderStatus: str(j.work_order_status), generatedAt: strOrNull(j.generated_at), outOfDate: j.out_of_date === true,
    lines: arr(j.lines).map((l) => ({
      itemId: str(l.item_id), itemCode: str(l.item_code), itemName: str(l.item_name), unitCode: str(l.unit_code),
      generatedQty: str(l.generated_qty), adjustedQty: strOrNull(l.adjusted_qty), adjustReason: strOrNull(l.adjust_reason),
      adjustedBy: strOrNull(l.adjusted_by), adjustedAt: strOrNull(l.adjusted_at), plannedQty: str(l.planned_qty), priorQty: str(l.prior_qty),
      source: l.source === 'adjusted' ? 'adjusted' : 'standard',
      basis: arr(l.basis).map((b) => ({
        boqItemId: str(b.boq_item_id), code: str(b.boq_code), unit: str(b.unit), workQty: str(b.work_qty), standardId: str(b.standard_id),
        qtyPerUnit: str(b.qty_per_unit), marginPct: str(b.margin_pct), result: str(b.result),
      })),
    })),
    noStandard: arr(j.no_standard).map((n) => ({ boqItemId: str(n.boq_item_id), itemCode: str(n.item_code), description: str(n.description), unit: str(n.unit), quantity: str(n.quantity) })),
    unplanned: arr(j.unplanned).map((u) => ({
      itemId: str(u.item_id), itemCode: str(u.item_code), itemName: str(u.item_name), unitCode: str(u.unit_code),
      plannedQty: str(u.planned_qty), priorQty: str(u.prior_qty), source: u.source === 'allowance' ? 'allowance' : 'none',
    })),
  };
}

export async function getConsumablePlan(workOrderId: string): Promise<ConsumablePlan> {
  const { data, error } = await supabase.rpc('cus_get_plan', { p_work_order_id: workOrderId });
  if (error) throw toAppError(error);
  return parseConsumablePlan(data);
}
export async function generateConsumablePlan(workOrderId: string): Promise<number> {
  const { data, error } = await supabase.rpc('cus_generate_plan', { p_work_order_id: workOrderId });
  if (error) throw toAppError(error);
  return Number(data ?? 0);
}
/** `adjustedQty` null reverts to the generated figure (and removes a hand-added line). */
export async function adjustConsumablePlanLine(a: { workOrderId: string; itemId: string; adjustedQty: string | null; reason: string | null }): Promise<void> {
  const { error } = await supabase.rpc('cus_adjust_plan_line', {
    p_work_order_id: a.workOrderId, p_item_id: a.itemId,
    p_adjusted_qty: a.adjustedQty === null ? nullableArg(null as number | null) : asNumeric(a.adjustedQty), p_reason: nullableArg(a.reason),
  });
  if (error) throw toAppError(error);
}

/** FR-CUS-007 preview inputs: the work order's lines (with contract-line code and unit) and every active standard. */
const MAX_INPUT_ROWS = 1000;
export async function getPlanInputs(workOrderId: string): Promise<{ lines: PlanLineInput[]; standards: UsageStandard[] }> {
  const [lines, standards] = await Promise.all([
    supabase.from('work_order_lines').select('boq_item_id, quantity::text, boq_items!inner(item_code, unit)').eq('work_order_id', workOrderId).limit(MAX_INPUT_ROWS),
    supabase.from('consumable_usage_standards').select(COLUMNS).is('archived_at', null).order('id').limit(MAX_INPUT_ROWS),
  ]);
  if (lines.error) throw toAppError(lines.error);
  if (standards.error) throw toAppError(standards.error);
  if ((lines.data?.length ?? 0) >= MAX_INPUT_ROWS || (standards.data?.length ?? 0) >= MAX_INPUT_ROWS) throw new AppError('Too many rows to preview.', 'CUS_TOO_MANY');
  return {
    lines: (lines.data ?? []).map((l) => {
      const b = Array.isArray(l.boq_items) ? l.boq_items[0] : l.boq_items;
      return { boqItemId: l.boq_item_id, code: b?.item_code ?? '', unit: b?.unit ?? '', quantity: l.quantity };
    }),
    standards: (standards.data ?? []).map((r) => ({ id: r.id, itemId: r.item_id, workUnit: r.work_unit, boqCodePrefix: r.boq_code_prefix, qtyPerUnit: r.qty_per_unit, marginPct: r.margin_pct })),
  };
}

/** The stable `CUS_*` code the plan functions raise, or null. */
export function consumablePlanRefusal(err: unknown): 'CUS_NOT_FOUND' | 'CUS_FORBIDDEN' | 'CUS_WORK_ORDER' | 'CUS_REASON' | 'CUS_ITEM' | 'CUS_INVALID' | null {
  const msg = err instanceof Error ? err.message : '';
  const m = /\b(CUS_NOT_FOUND|CUS_FORBIDDEN|CUS_WORK_ORDER|CUS_REASON|CUS_ITEM|CUS_INVALID)\b/.exec(msg);
  return m ? (m[1] as ReturnType<typeof consumablePlanRefusal>) : null;
}
