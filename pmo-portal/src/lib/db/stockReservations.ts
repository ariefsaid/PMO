/**
 * stockReservations.ts (#2693) — a work order holds a quantity of an item at a location; stock reads "x free + y reserved"; a request that takes
 * another work order's reserved stock is borrowing. Spec docs/specs/stock-reservations.spec.md. The database enforces every rule (free quantity,
 * who may reserve, borrowing approval, consumption); this file only reads, writes and maps. Quantities stay decimal strings (NFR-STK-007).
 */
import { supabase } from '@/src/lib/supabase/client';
import { toAppError } from '@/src/lib/appError';
import { nullableArg } from './nullableArg';
import type { Enums } from '@/src/lib/supabase/database.types';

/** A `numeric` quantity goes on the wire as the exact decimal TEXT the caller typed (NFR-STK-007), which the generated
 * argument type cannot state: it says `number`. The cast is the number's text, never a float. */
const asNumeric = (v: string) => v as unknown as number;

export type BorrowMode = 'approve' | 'warn';
export interface ReservationSettings { enabled: boolean; borrowMode: BorrowMode; borrowRole: string | null; borrowLabel: string | null }
export interface ReservingWorkOrder { reservationId: string; workOrderId: string; workOrderNumber: string | null; workOrderTitle: string; remainingQty: string; expiresOn: string | null }
export interface FreeReservedRow {
  itemId: string; warehouseId: string; qtyOnHand: string; reservedQty: string; freeQty: string; shortBy: string; reservations: ReservingWorkOrder[];
}
export interface ReserveInput { workOrderId: string; itemId: string; warehouseId: string; quantity: string; expiresOn: string | null; note: string }
export interface RequestBorrowing { borrowing: boolean; lines: { itemId: string; reservedUseQty: string; borrowedQty: string }[] }

/** The shape `get_stock_free_reserved` builds in jsonb; the RPC states no columns, so this module does. */
interface FreeReservedRpcRow {
  item_id: string; warehouse_id: string; qty_on_hand: string; reserved_qty: string; free_qty: string; short_by: string;
  reservations: Array<{ reservation_id: string; work_order_id: string; work_order_number: string | null; work_order_title: string; remaining_qty: string; expires_on: string | null }> | null;
}

const OFF: ReservationSettings = { enabled: false, borrowMode: 'approve', borrowRole: null, borrowLabel: null };

/** The organisation's reservation settings (default off). */
export async function getReservationSettings(): Promise<ReservationSettings> {
  const { data, error } = await supabase.from('organizations').select('stock_reservations, reservation_borrow_mode, reservation_borrow_role, reservation_borrow_label').limit(1).maybeSingle();
  if (error) throw toAppError(error);
  if (!data) return OFF;
  return {
    enabled: data.stock_reservations === true, borrowMode: data.reservation_borrow_mode === 'warn' ? 'warn' : 'approve',
    borrowRole: data.reservation_borrow_role, borrowLabel: data.reservation_borrow_label,
  };
}

export async function setReservationSettings(s: ReservationSettings): Promise<void> {
  const { error } = await supabase.rpc('set_stock_reservations', {
    p_on: s.enabled, p_borrow_mode: s.borrowMode,
    // The role picker is fed from the role list itself, and the database casts the parameter to the role enum.
    p_borrow_role: (s.borrowRole ?? undefined) as Enums<'user_role'> | undefined,
    p_borrow_label: nullableArg(s.borrowLabel?.trim() || null),
  });
  if (error) throw toAppError(error);
}

/** Free and reserved figures per item and location, with the reserving work orders. Empty while reservations are off. */
export async function getFreeReserved(warehouseId?: string, itemId?: string): Promise<FreeReservedRow[]> {
  const { data, error } = await supabase.rpc('get_stock_free_reserved', { p_warehouse_id: nullableArg(warehouseId ?? null), p_item_id: nullableArg(itemId ?? null) });
  if (error) throw toAppError(error);
  // `get_stock_free_reserved` is declared `returns jsonb`, so the generated type is `Json`; the figure strings are stated here.
  return ((data ?? []) as unknown as FreeReservedRpcRow[]).map((r) => ({
    itemId: r.item_id, warehouseId: r.warehouse_id, qtyOnHand: r.qty_on_hand, reservedQty: r.reserved_qty, freeQty: r.free_qty, shortBy: r.short_by,
    reservations: (r.reservations ?? []).map((x) => ({
      reservationId: x.reservation_id, workOrderId: x.work_order_id, workOrderNumber: x.work_order_number ?? null, workOrderTitle: x.work_order_title,
      remainingQty: x.remaining_qty, expiresOn: x.expires_on ?? null,
    })),
  }));
}

export async function reserveStock(i: ReserveInput, requestId: string): Promise<string> {
  const { data, error } = await supabase.rpc('reserve_stock', {
    p_work_order_id: i.workOrderId, p_item_id: i.itemId, p_warehouse_id: i.warehouseId, p_quantity: asNumeric(i.quantity),
    p_expires_on: nullableArg(i.expiresOn || null), p_note: nullableArg(i.note.trim() || null), p_client_request_id: requestId,
  });
  if (error) throw toAppError(error);
  return data;
}

export async function releaseReservation(id: string, quantity: string | null, reason: string): Promise<void> {
  const { error } = await supabase.rpc('release_reservation', {
    p_reservation_id: id, p_quantity: quantity === null ? nullableArg(null as number | null) : asNumeric(quantity), p_reason: reason,
  });
  if (error) throw toAppError(error);
}

/** The reservations a work order holds (its own, for its stock balance screen). */
export async function listWorkOrderReservations(workOrderId: string): Promise<(ReservingWorkOrder & { itemId: string; warehouseId: string; status: string })[]> {
  const { data, error } = await supabase.from('stock_reservations')
    .select('id, work_order_id, item_id, warehouse_id, quantity, consumed_qty, released_qty, status, expires_on')
    .eq('work_order_id', workOrderId).eq('status', 'active').order('created_at', { ascending: true }).limit(200);
  if (error) throw toAppError(error);
  return (data ?? []).map((r) => ({
    reservationId: r.id, workOrderId: r.work_order_id, workOrderNumber: null, workOrderTitle: '', itemId: r.item_id, warehouseId: r.warehouse_id, status: r.status,
    remainingQty: String(Number(r.quantity) - Number(r.consumed_qty) - Number(r.released_qty)), expiresOn: r.expires_on ?? null,
  }));
}

/** Whether a request takes another work order's reserved stock, and how much per line (shown only while reservations are on). */
export async function getRequestBorrowing(requestId: string): Promise<RequestBorrowing | null> {
  const head = await supabase.from('material_requests').select('borrowing, reservation_checked').eq('id', requestId).maybeSingle();
  if (head.error) throw toAppError(head.error);
  if (!head.data || head.data.reservation_checked !== true) return null;
  const lines = await supabase.from('material_request_lines').select('item_id, reserved_use_qty, borrowed_qty').eq('request_id', requestId).order('line_no', { ascending: true }).limit(200);
  if (lines.error) throw toAppError(lines.error);
  return {
    borrowing: head.data.borrowing === true,
    lines: (lines.data ?? []).map((l) => ({ itemId: l.item_id, reservedUseQty: String(l.reserved_use_qty), borrowedQty: String(l.borrowed_qty) })),
  };
}
