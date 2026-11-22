/**
 * workOrderMaterialProgress.ts (#2674) — issued share against progress share per work order, and the organisation's
 * warning threshold. Spec docs/specs/material-issued-vs-progress.spec.md. The database computes every figure and enforces
 * the Admin-only save; this file only reads, writes and maps. Quantities stay decimal strings (NFR-STK-007).
 */
import { supabase } from '@/src/lib/supabase/client';
import { nullableArg } from './nullableArg';
import { toAppError } from '@/src/lib/appError';

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

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const num = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));

export async function getWorkOrderMaterialProgress(workOrderId: string): Promise<MaterialProgress> {
  const { data, error } = await supabase.rpc('get_work_order_material_vs_progress', { p_work_order_id: workOrderId });
  if (error) throw toAppError(error);
  const r = (data ?? {}) as Json;
  return {
    thresholdPct: num(r.threshold_pct),
    progressPct: num(r.progress_pct),
    items: ((r.items ?? []) as Json[]).map((i) => ({
      itemId: i.item_id, itemCode: i.item_code, itemName: i.item_name, unitCode: i.unit_code,
      plannedQty: i.planned_qty, issuedQty: i.issued_qty,
      issuedPct: num(i.issued_pct), gapPp: num(i.gap_pp), unplanned: i.unplanned === true, warn: i.warn === true,
    })),
  };
}

/** Admin only (the database refuses anyone else). null clears the threshold, which turns the warning off. */
export async function setWorkOrderIssueThreshold(thresholdPct: number | null): Promise<number | null> {
  // Null clears the threshold; the SQL parameter accepts it, but the generated argument type is `number`.
  const { data, error } = await supabase.rpc('set_work_order_issue_threshold', { p_threshold_pct: nullableArg(thresholdPct) });
  if (error) throw toAppError(error);
  return num(data);
}

/** The organisation's current threshold, or null when it is unset (RLS shows only the caller's own row). */
export async function getWorkOrderIssueThreshold(): Promise<number | null> {
  const { data, error } = await supabase.from('work_order_stock_settings').select('issue_progress_threshold_pct').maybeSingle();
  if (error) throw toAppError(error);
  return num(data?.issue_progress_threshold_pct);
}
