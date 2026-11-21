/**
 * stockReservations.ts (#2693) — a work order holds a quantity of an item at a location; stock reads "x free + y reserved"; a request that takes
 * another work order's reserved stock is borrowing. Spec docs/specs/stock-reservations.spec.md. The database enforces every rule (free quantity,
 * who may reserve, borrowing approval, consumption); this file only reads, writes and maps. Quantities stay decimal strings (NFR-STK-007).
 * The generated database types predate migrations 1315-1318, so these calls go through one narrow loose client until they are regenerated.
 */
import { supabase } from '@/src/lib/supabase/client';
import { toAppError } from '@/src/lib/appError';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Json = Record<string, any>;
interface Reply { data: any; error: { message: string; code?: string; details?: string } | null }
interface Loose { from: (table: string) => any; rpc: (name: string, args?: Json) => PromiseLike<Reply> }
const db = supabase as unknown as Loose;
/* eslint-enable @typescript-eslint/no-explicit-any */

export type BorrowMode = 'approve' | 'warn';
export interface ReservationSettings { enabled: boolean; borrowMode: BorrowMode; borrowRole: string | null; borrowLabel: string | null }
export interface ReservingWorkOrder { reservationId: string; workOrderId: string; workOrderNumber: string | null; workOrderTitle: string; remainingQty: string; expiresOn: string | null }
export interface FreeReservedRow {
  itemId: string; warehouseId: string; qtyOnHand: string; reservedQty: string; freeQty: string; shortBy: string; reservations: ReservingWorkOrder[];
}
export interface ReserveInput { workOrderId: string; itemId: string; warehouseId: string; quantity: string; expiresOn: string | null; note: string }
export interface RequestBorrowing { borrowing: boolean; lines: { itemId: string; reservedUseQty: string; borrowedQty: string }[] }

const rpc = async (name: string, args: Json): Promise<any> => { // eslint-disable-line @typescript-eslint/no-explicit-any
  const { data, error } = await db.rpc(name, args);
  if (error) throw toAppError(error);
  return data;
};

const OFF: ReservationSettings = { enabled: false, borrowMode: 'approve', borrowRole: null, borrowLabel: null };

/** The organisation's reservation settings (default off). */
export async function getReservationSettings(): Promise<ReservationSettings> {
  const { data, error } = await db.from('organizations').select('stock_reservations, reservation_borrow_mode, reservation_borrow_role, reservation_borrow_label').limit(1).maybeSingle();
  if (error) throw toAppError(error);
  if (!data) return OFF;
  return {
    enabled: data.stock_reservations === true, borrowMode: data.reservation_borrow_mode === 'warn' ? 'warn' : 'approve',
    borrowRole: data.reservation_borrow_role ?? null, borrowLabel: data.reservation_borrow_label ?? null,
  };
}

export async function setReservationSettings(s: ReservationSettings): Promise<void> {
  await rpc('set_stock_reservations', { p_on: s.enabled, p_borrow_mode: s.borrowMode, p_borrow_role: s.borrowRole, p_borrow_label: s.borrowLabel?.trim() || null });
}

/** Free and reserved figures per item and location, with the reserving work orders. Empty while reservations are off. */
export async function getFreeReserved(warehouseId?: string, itemId?: string): Promise<FreeReservedRow[]> {
  const data = (await rpc('get_stock_free_reserved', { p_warehouse_id: warehouseId ?? null, p_item_id: itemId ?? null })) as Json[] | null;
  return (data ?? []).map((r) => ({
    itemId: r.item_id, warehouseId: r.warehouse_id, qtyOnHand: r.qty_on_hand, reservedQty: r.reserved_qty, freeQty: r.free_qty, shortBy: r.short_by,
    reservations: ((r.reservations ?? []) as Json[]).map((x) => ({
      reservationId: x.reservation_id, workOrderId: x.work_order_id, workOrderNumber: x.work_order_number ?? null, workOrderTitle: x.work_order_title,
      remainingQty: x.remaining_qty, expiresOn: x.expires_on ?? null,
    })),
  }));
}

export async function reserveStock(i: ReserveInput, requestId: string): Promise<string> {
  return (await rpc('reserve_stock', {
    p_work_order_id: i.workOrderId, p_item_id: i.itemId, p_warehouse_id: i.warehouseId, p_quantity: i.quantity,
    p_expires_on: i.expiresOn || null, p_note: i.note.trim() || null, p_client_request_id: requestId,
  })) as string;
}

export async function releaseReservation(id: string, quantity: string | null, reason: string): Promise<void> {
  await rpc('release_reservation', { p_reservation_id: id, p_quantity: quantity, p_reason: reason });
}

/** The reservations a work order holds (its own, for its stock balance screen). */
export async function listWorkOrderReservations(workOrderId: string): Promise<(ReservingWorkOrder & { itemId: string; warehouseId: string; status: string })[]> {
  const { data, error } = await db.from('stock_reservations')
    .select('id, work_order_id, item_id, warehouse_id, quantity, consumed_qty, released_qty, status, expires_on')
    .eq('work_order_id', workOrderId).eq('status', 'active').order('created_at', { ascending: true }).limit(200);
  if (error) throw toAppError(error);
  return ((data ?? []) as Json[]).map((r) => ({
    reservationId: r.id, workOrderId: r.work_order_id, workOrderNumber: null, workOrderTitle: '', itemId: r.item_id, warehouseId: r.warehouse_id, status: r.status,
    remainingQty: String(Number(r.quantity) - Number(r.consumed_qty) - Number(r.released_qty)), expiresOn: r.expires_on ?? null,
  }));
}

/** Whether a request takes another work order's reserved stock, and how much per line (shown only while reservations are on). */
export async function getRequestBorrowing(requestId: string): Promise<RequestBorrowing | null> {
  const head = await db.from('material_requests').select('borrowing, reservation_checked').eq('id', requestId).maybeSingle();
  if (head.error) throw toAppError(head.error);
  if (!head.data || head.data.reservation_checked !== true) return null;
  const lines = await db.from('material_request_lines').select('item_id, reserved_use_qty, borrowed_qty').eq('request_id', requestId).order('line_no', { ascending: true }).limit(200);
  if (lines.error) throw toAppError(lines.error);
  return {
    borrowing: head.data.borrowing === true,
    lines: ((lines.data ?? []) as Json[]).map((l) => ({ itemId: l.item_id, reservedUseQty: String(l.reserved_use_qty), borrowedQty: String(l.borrowed_qty) })),
  };
}
