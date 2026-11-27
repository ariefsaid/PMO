/**
 * stockWorkOrderTransfer.ts (#2691) — one document that moves leftover material from work order A to work order B (a return from A and an issue to B).
 * Spec docs/specs/stock-work-order-transfer.spec.md. The database enforces every rule (net balance, same project, location, keeper, atomicity);
 * this file only reads, writes and maps. Quantities stay decimal strings (NFR-STK-007).
 */
import { supabase } from '@/src/lib/supabase/client';
import { toAppError } from '@/src/lib/appError';

export interface ReturnableLine { itemId: string; itemCode: string; itemName: string; unitCode: string; quantity: string; boqItemId: string | null; value: string | null }
export interface WoTransferInput {
  warehouseId: string; fromWorkOrderId: string; toWorkOrderId: string; note: string; disciplineId: string | null;
  lines: { itemId: string; quantity: string; boqItemId: string | null }[];
}
export interface WoTransferHalf { id: string; number: string; kind: 'return' | 'issue'; status: string; workOrderId: string | null }
export interface WoTransfer {
  id: string; number: string; projectId: string; warehouseId: string; fromWorkOrderId: string; toWorkOrderId: string; note: string | null;
  occurredOn: string; createdBy: string; createdAt: string; halves: WoTransferHalf[];
}

/** The shape `get_work_order_returnable` builds in jsonb; the RPC states no columns, so this module does. */
interface ReturnableRpcLine {
  item_id: string; item_code: string; item_name: string; unit_code: string; quantity: string;
  boq_item_id: string | null; value: string | null;
}

/** Whether the organisation turned work-order transfers on (default off). A failed read reads as off: nothing new shows. */
export async function getWoTransfersEnabled(): Promise<boolean> {
  const { data, error } = await supabase.from('organizations').select('stock_wo_transfers').limit(1).maybeSingle();
  if (error) throw toAppError(error);
  return data?.stock_wo_transfers === true;
}
export async function setWoTransfersEnabled(on: boolean): Promise<void> {
  const { error } = await supabase.rpc('set_stock_wo_transfers', { p_on: on });
  if (error) throw toAppError(error);
}

export async function getReturnable(workOrderId: string): Promise<ReturnableLine[]> {
  const { data, error } = await supabase.rpc('get_work_order_returnable', { p_work_order_id: workOrderId });
  if (error) throw toAppError(error);
  // `get_work_order_returnable` is declared `returns jsonb`: the lines and their decimal-string quantities are stated here.
  return ((data ?? []) as unknown as ReturnableRpcLine[]).map((r) => ({
    itemId: r.item_id, itemCode: r.item_code, itemName: r.item_name, unitCode: r.unit_code, quantity: r.quantity, boqItemId: r.boq_item_id ?? null, value: r.value ?? null,
  }));
}

export async function postWorkOrderTransfer(i: WoTransferInput, requestId: string): Promise<string> {
  const { data, error } = await supabase.rpc('post_stock_wo_transfer', {
    p_header: {
      warehouse_id: i.warehouseId, from_work_order_id: i.fromWorkOrderId, to_work_order_id: i.toWorkOrderId,
      note: i.note.trim() || null, discipline_id: i.disciplineId,
    },
    p_lines: i.lines.map((l) => ({ item_id: l.itemId, quantity: l.quantity, ...(l.boqItemId ? { boq_item_id: l.boqItemId } : {}) })),
    p_client_request_id: requestId,
  });
  if (error) throw toAppError(error);
  return data;
}

export async function getWorkOrderTransfer(id: string): Promise<WoTransfer | null> {
  const { data, error } = await supabase.from('stock_wo_transfers').select('*').eq('id', id).maybeSingle();
  if (error) throw toAppError(error);
  if (!data) return null;
  const docs = await supabase.from('stock_documents').select('id, number, kind, status, work_order_id').eq('wo_transfer_id', id).order('kind', { ascending: true }).limit(2);
  if (docs.error) throw toAppError(docs.error);
  return {
    id: data.id, number: data.number, projectId: data.project_id, warehouseId: data.warehouse_id,
    fromWorkOrderId: data.from_work_order_id, toWorkOrderId: data.to_work_order_id, note: data.note ?? null,
    occurredOn: data.occurred_on, createdBy: data.created_by, createdAt: data.created_at,
    // `kind` is `text` with a CHECK of the two halves, which the generated row states as `string`.
    halves: (docs.data ?? []).map((d) => ({
      id: d.id, number: d.number, kind: d.kind as WoTransferHalf['kind'], status: d.status, workOrderId: d.work_order_id ?? null,
    })),
  };
}
