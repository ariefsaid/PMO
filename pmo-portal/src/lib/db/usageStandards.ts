import { supabase } from '@/src/lib/supabase/client';
import { nullableArg } from './nullableArg';
import { AppError, assertWriteLanded, toAppError } from '@/src/lib/appError';
import { wireValidator } from '@/src/lib/wireDoc';
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
export interface ConsumablePlanApproval {
  authorId: string | null;
  authorIsPcm: boolean;
  approved: boolean;
  approvedBy: string | null;
  approvedAt: string | null;
}
export interface ConsumablePlan {
  workOrderId: string;
  workOrderStatus: string;
  generatedAt: string | null;
  outOfDate: boolean;
  approval: ConsumablePlanApproval;
  lines: ConsumablePlanLine[];
  noStandard: NoStandardLine[];
  unplanned: UnplannedItem[];
}

const planValidator = wireValidator('Consumable plan', 'consumable-plan-malformed');
const PLAN_SOURCES = ['standard', 'adjusted'] as const;
const UNPLANNED_SOURCES = ['allowance', 'none'] as const;

export function parseConsumablePlan(raw: unknown, approvalRaw?: unknown): ConsumablePlan {
  const v = planValidator;
  const j = v.rec(raw, 'response');
  const approval = approvalRaw === undefined ? null : v.rec(approvalRaw, 'approval');
  return {
    workOrderId: v.str(j.work_order_id, 'work_order_id'),
    workOrderStatus: v.str(j.work_order_status, 'work_order_status'),
    generatedAt: v.strOrNull(j.generated_at, 'generated_at'),
    outOfDate: v.bool(j.out_of_date, 'out_of_date'),
    approval: approval === null
      ? { authorId: null, authorIsPcm: false, approved: false, approvedBy: null, approvedAt: null }
      : {
          authorId: v.strOrNull(approval.author_id, 'approval.author_id'),
          authorIsPcm: v.bool(approval.author_is_pcm, 'approval.author_is_pcm'),
          approved: v.bool(approval.approved, 'approval.approved'),
          approvedBy: v.strOrNull(approval.approved_by, 'approval.approved_by'),
          approvedAt: v.strOrNull(approval.approved_at, 'approval.approved_at'),
        },
    lines: v.arr(j.lines, 'lines').map((item, idx) => {
      const p = `lines[${idx}]`;
      const l = v.rec(item, p);
      return {
        itemId: v.str(l.item_id, `${p}.item_id`),
        itemCode: v.str(l.item_code, `${p}.item_code`),
        itemName: v.str(l.item_name, `${p}.item_name`),
        unitCode: v.str(l.unit_code, `${p}.unit_code`),
        generatedQty: v.decimal(l.generated_qty, `${p}.generated_qty`),
        adjustedQty: v.decimalOrNull(l.adjusted_qty, `${p}.adjusted_qty`),
        adjustReason: v.strOrNull(l.adjust_reason, `${p}.adjust_reason`),
        adjustedBy: v.strOrNull(l.adjusted_by, `${p}.adjusted_by`),
        adjustedAt: v.strOrNull(l.adjusted_at, `${p}.adjusted_at`),
        plannedQty: v.decimal(l.planned_qty, `${p}.planned_qty`),
        priorQty: v.decimal(l.prior_qty, `${p}.prior_qty`),
        source: v.oneOf(l.source, PLAN_SOURCES, `${p}.source`),
        basis: v.arr(l.basis, `${p}.basis`).map((bItem, bIdx) => {
          const bp = `${p}.basis[${bIdx}]`;
          const b = v.rec(bItem, bp);
          return {
            boqItemId: v.str(b.boq_item_id, `${bp}.boq_item_id`),
            code: v.str(b.boq_code, `${bp}.boq_code`),
            unit: v.str(b.unit, `${bp}.unit`),
            workQty: v.decimal(b.work_qty, `${bp}.work_qty`),
            standardId: v.str(b.standard_id, `${bp}.standard_id`),
            qtyPerUnit: v.decimal(b.qty_per_unit, `${bp}.qty_per_unit`),
            marginPct: v.decimal(b.margin_pct, `${bp}.margin_pct`),
            result: v.decimal(b.result, `${bp}.result`),
          };
        }),
      };
    }),
    noStandard: v.arr(j.no_standard, 'no_standard').map((item, idx) => {
      const p = `no_standard[${idx}]`;
      const n = v.rec(item, p);
      return {
        boqItemId: v.str(n.boq_item_id, `${p}.boq_item_id`),
        itemCode: v.str(n.item_code, `${p}.item_code`),
        description: v.text(n.description, `${p}.description`),
        unit: v.str(n.unit, `${p}.unit`),
        quantity: v.decimal(n.quantity, `${p}.quantity`),
      };
    }),
    unplanned: v.arr(j.unplanned, 'unplanned').map((item, idx) => {
      const p = `unplanned[${idx}]`;
      const u = v.rec(item, p);
      return {
        itemId: v.str(u.item_id, `${p}.item_id`),
        itemCode: v.str(u.item_code, `${p}.item_code`),
        itemName: v.str(u.item_name, `${p}.item_name`),
        unitCode: v.str(u.unit_code, `${p}.unit_code`),
        plannedQty: v.decimal(u.planned_qty, `${p}.planned_qty`),
        priorQty: v.decimal(u.prior_qty, `${p}.prior_qty`),
        source: v.oneOf(u.source, UNPLANNED_SOURCES, `${p}.source`),
      };
    }),
  };
}

export async function getConsumablePlan(workOrderId: string): Promise<ConsumablePlan> {
  const args = { p_work_order_id: workOrderId };
  const [plan, approval] = await Promise.all([
    supabase.rpc('cus_get_plan', args),
    supabase.rpc('cus_plan_approval_status', args),
  ]);
  if (plan.error) throw toAppError(plan.error);
  if (approval.error) throw toAppError(approval.error);
  return parseConsumablePlan(plan.data, approval.data);
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
export async function approveConsumablePlan(workOrderId: string): Promise<void> {
  const { error } = await supabase.rpc('cus_approve_plan', { p_work_order_id: workOrderId });
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
export function consumablePlanRefusal(err: unknown): 'CUS_NOT_FOUND' | 'CUS_FORBIDDEN' | 'CUS_WORK_ORDER' | 'CUS_REASON' | 'CUS_ITEM' | 'CUS_INVALID' | 'CUS_SOD' | 'CUS_APPROVER' | 'CUS_PLAN_MISSING' | 'CUS_PLAN_STALE' | null {
  const msg = err instanceof Error ? err.message : '';
  const m = /\b(CUS_NOT_FOUND|CUS_FORBIDDEN|CUS_WORK_ORDER|CUS_REASON|CUS_ITEM|CUS_INVALID|CUS_SOD|CUS_APPROVER|CUS_PLAN_MISSING|CUS_PLAN_STALE)\b/.exec(msg);
  return m ? (m[1] as ReturnType<typeof consumablePlanRefusal>) : null;
}
