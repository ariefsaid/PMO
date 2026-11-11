import { supabase } from '@/src/lib/supabase/client';
import { AppError, toAppError } from '@/src/lib/appError';

/** Reorder levels (#1512 S6, FR-STK-051..054). Quantities stay decimal strings (NFR-STK-007). */
export interface ReorderLevel { reorderLevel: string; reorderQuantity: string | null }
export interface ReorderInputs {
  windowDays?: number; usage?: string; avgDailyUsage?: string; leadTimeDays?: number; safetyDays?: number; orderCycleDays?: number;
  usageMovements: number; historyDays: number; minHistoryDays?: number; minMovements?: number;
}
export interface ReorderSuggestion {
  status: 'ok' | 'insufficient_history';
  suggestion: ReorderLevel | null;
  inputs: ReorderInputs;
  /** The level in force now, when one was accepted. */
  current: ReorderLevel | null;
}
export interface BelowReorderRow {
  itemId: string; itemCode: string; itemName: string; unitCode: string; warehouseId: string; warehouseCode: string;
  qtyOnHand: string; reorderLevel: string; reorderQuantity: string | null;
}

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const level = (j: Json | null | undefined): ReorderLevel | null => (j ? { reorderLevel: j.reorder_level, reorderQuantity: j.reorder_quantity ?? null } : null);

/** Changes nothing (FR-STK-051): the figure is only ever shown until someone accepts it. */
export async function getReorderSuggestion(warehouseId: string, itemId: string): Promise<ReorderSuggestion> {
  const { data, error } = await supabase.rpc('get_reorder_suggestions', { p_warehouse_id: warehouseId, p_item_id: itemId });
  if (error) throw toAppError(error);
  if (!data) throw new AppError('The reorder suggestion could not be computed.', 'STK_INVALID');
  const d = data as Json;
  const i = (d.inputs ?? {}) as Json;
  const inputs: Json = { usageMovements: i.usage_movements, historyDays: i.history_days };
  const opt = (k: string, to: string) => { if (i[k] !== undefined) inputs[to] = i[k]; };
  opt('window_days', 'windowDays'); opt('usage', 'usage'); opt('avg_daily_usage', 'avgDailyUsage'); opt('lead_time_days', 'leadTimeDays');
  opt('safety_days', 'safetyDays'); opt('order_cycle_days', 'orderCycleDays'); opt('min_history_days', 'minHistoryDays'); opt('min_movements', 'minMovements');
  return { status: d.status, suggestion: level(d.suggestion), inputs: inputs as ReorderInputs, current: level(d.current) };
}

export async function getBelowReorder(): Promise<BelowReorderRow[]> {
  const { data, error } = await supabase.rpc('get_stock_below_reorder');
  if (error) throw toAppError(error);
  return ((data ?? []) as Json[]).map((r) => ({
    itemId: r.item_id, itemCode: r.item_code, itemName: r.item_name, unitCode: r.unit_code,
    warehouseId: r.warehouse_id, warehouseCode: r.warehouse_code,
    qtyOnHand: r.qty_on_hand, reorderLevel: r.reorder_level, reorderQuantity: r.reorder_quantity ?? null,
  }));
}

/** `level: null` clears the level. The strings travel as typed; PostgREST casts them to numeric. */
export async function setReorderLevel(a: { warehouseId: string; itemId: string; level: string | null; quantity?: string | null }): Promise<void> {
  const { error } = await supabase.rpc('set_stock_reorder_level', {
    p_warehouse_id: a.warehouseId, p_item_id: a.itemId,
    p_level: a.level as unknown as number, p_quantity: (a.quantity ?? null) as unknown as number,
  });
  if (error) throw toAppError(error);
}
