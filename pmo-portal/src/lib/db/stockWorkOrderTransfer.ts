/**
 * stockWorkOrderTransfer.ts (#2691) — one document that moves leftover material from work order A to work order B (a return from A and an issue to B).
 * Spec docs/specs/stock-work-order-transfer.spec.md. The database enforces every rule (net balance, same project, location, keeper, atomicity);
 * this file only reads, writes and maps. Quantities stay decimal strings (NFR-STK-007).
 * The generated database types predate migrations 1310-1314, so these calls go through one narrow loose client until they are regenerated.
 */
import { supabase } from '@/src/lib/supabase/client';
import { toAppError } from '@/src/lib/appError';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Json = Record<string, any>;
interface Reply { data: any; error: { message: string; code?: string; details?: string } | null }
interface Loose { from: (table: string) => any; rpc: (name: string, args?: Json) => PromiseLike<Reply> }
const db = supabase as unknown as Loose;
/* eslint-enable @typescript-eslint/no-explicit-any */

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

const rpc = async (name: string, args: Json): Promise<any> => { // eslint-disable-line @typescript-eslint/no-explicit-any
  const { data, error } = await db.rpc(name, args);
  if (error) throw toAppError(error);
  return data;
};

/** Whether the organisation turned work-order transfers on (default off). A failed read reads as off: nothing new shows. */
export async function getWoTransfersEnabled(): Promise<boolean> {
  const { data, error } = await db.from('organizations').select('stock_wo_transfers').limit(1).maybeSingle();
  if (error) throw toAppError(error);
  return data?.stock_wo_transfers === true;
}
export const setWoTransfersEnabled = (on: boolean): Promise<void> => rpc('set_stock_wo_transfers', { p_on: on });

export async function getReturnable(workOrderId: string): Promise<ReturnableLine[]> {
  const data = (await rpc('get_work_order_returnable', { p_work_order_id: workOrderId })) as Json[] | null;
  return (data ?? []).map((r) => ({
    itemId: r.item_id, itemCode: r.item_code, itemName: r.item_name, unitCode: r.unit_code, quantity: r.quantity, boqItemId: r.boq_item_id ?? null, value: r.value ?? null,
  }));
}

export async function postWorkOrderTransfer(i: WoTransferInput, requestId: string): Promise<string> {
  return (await rpc('post_stock_wo_transfer', {
    p_header: {
      warehouse_id: i.warehouseId, from_work_order_id: i.fromWorkOrderId, to_work_order_id: i.toWorkOrderId,
      note: i.note.trim() || null, discipline_id: i.disciplineId,
    },
    p_lines: i.lines.map((l) => ({ item_id: l.itemId, quantity: l.quantity, ...(l.boqItemId ? { boq_item_id: l.boqItemId } : {}) })),
    p_client_request_id: requestId,
  })) as string;
}

const mapHalf = (d: Json): WoTransferHalf => ({ id: d.id, number: d.number, kind: d.kind, status: d.status, workOrderId: d.work_order_id ?? null });
const mapTransfer = (t: Json, halves: Json[]): WoTransfer => ({
  id: t.id, number: t.number, projectId: t.project_id, warehouseId: t.warehouse_id, fromWorkOrderId: t.from_work_order_id, toWorkOrderId: t.to_work_order_id,
  note: t.note ?? null, occurredOn: t.occurred_on, createdBy: t.created_by, createdAt: t.created_at, halves: halves.map(mapHalf),
});

export async function getWorkOrderTransfer(id: string): Promise<WoTransfer | null> {
  const { data, error } = await db.from('stock_wo_transfers').select('*').eq('id', id).maybeSingle();
  if (error) throw toAppError(error);
  if (!data) return null;
  const docs = await db.from('stock_documents').select('id, number, kind, status, work_order_id').eq('wo_transfer_id', id).order('kind', { ascending: true }).limit(2);
  if (docs.error) throw toAppError(docs.error);
  return mapTransfer(data, (docs.data ?? []) as Json[]);
}

