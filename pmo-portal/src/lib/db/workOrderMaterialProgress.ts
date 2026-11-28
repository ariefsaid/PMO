/**
 * workOrderMaterialProgress.ts (#2674) — issued share against progress share per work order, and the organisation's
 * warning threshold. Spec docs/specs/material-issued-vs-progress.spec.md. The database computes every figure and enforces
 * the Admin-only save; this file only reads, writes and maps. Quantities stay decimal strings (NFR-STK-007).
 */
import { supabase } from '@/src/lib/supabase/client';
import { nullableArg } from './nullableArg';
import { toAppError } from '@/src/lib/appError';
import { wireValidator } from '@/src/lib/wireDoc';

export interface MaterialProgressItem {
  itemId: string; itemCode: string; itemName: string; unitCode: string;
  plannedQty: string; issuedQty: string;
  /** Percent of planned, one decimal; null when the item has no planned quantity. */
  issuedPct: number | null;
  /** Issued share minus progress share, percentage points; null when either side is absent. */
  gapPp: number | null;
  unplanned: boolean;
  warn: boolean;
}
export interface MaterialProgress {
  /** null = the organisation has not set a threshold: nothing is compared. */
  thresholdPct: number | null;
  progressPct: number | null;
  items: MaterialProgressItem[];
}

const v = wireValidator('Work order material progress', 'material-progress-malformed');

export async function getWorkOrderMaterialProgress(workOrderId: string): Promise<MaterialProgress> {
  const { data, error } = await supabase.rpc('get_work_order_material_vs_progress', { p_work_order_id: workOrderId });
  if (error) throw toAppError(error);
  const r = v.rec(data, 'response');
  return {
    thresholdPct: v.numOrNull(r.threshold_pct, 'threshold_pct'),
    progressPct: v.numOrNull(r.progress_pct, 'progress_pct'),
    items: v.arr(r.items, 'items').map((item, idx) => {
      const p = `items[${idx}]`;
      const i = v.rec(item, p);
      return {
        itemId: v.str(i.item_id, `${p}.item_id`),
        itemCode: v.str(i.item_code, `${p}.item_code`),
        itemName: v.str(i.item_name, `${p}.item_name`),
        unitCode: v.str(i.unit_code, `${p}.unit_code`),
        plannedQty: v.decimal(i.planned_qty, `${p}.planned_qty`),
        issuedQty: v.decimal(i.issued_qty, `${p}.issued_qty`),
        issuedPct: v.numOrNull(i.issued_pct, `${p}.issued_pct`),
        gapPp: v.numOrNull(i.gap_pp, `${p}.gap_pp`),
        unplanned: v.bool(i.unplanned, `${p}.unplanned`),
        warn: v.bool(i.warn, `${p}.warn`),
      };
    }),
  };
}

/** Admin only (the database refuses anyone else). null clears the threshold, which turns the warning off. */
export async function setWorkOrderIssueThreshold(thresholdPct: number | null): Promise<number | null> {
  // Null clears the threshold; the SQL parameter accepts it, but the generated argument type is `number`.
  const { data, error } = await supabase.rpc('set_work_order_issue_threshold', { p_threshold_pct: nullableArg(thresholdPct) });
  if (error) throw toAppError(error);
  return v.numOrNull(data, 'threshold_pct');
}

/** The organisation's current threshold, or null when it is unset (RLS shows only the caller's own row). */
export async function getWorkOrderIssueThreshold(): Promise<number | null> {
  const { data, error } = await supabase.from('work_order_stock_settings').select('issue_progress_threshold_pct').maybeSingle();
  if (error) throw toAppError(error);
  return v.numOrNull(data?.issue_progress_threshold_pct, 'issue_progress_threshold_pct');
}
