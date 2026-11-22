import { supabase } from '@/src/lib/supabase/client';
import { AppError } from '@/src/lib/appError';

/**
 * The light-account phone home screen's data (#2710, migrations 1205-1209). `my_home()` returns only the caller's own items:
 * assigned tasks, work orders rostered today, reported issues. No price or budget field exists in the response.
 */
export interface MyHomeTask { id: string; name: string; status: string; end_date: string | null; project_id: string; project_name: string }
export interface MyHomeWorkOrder {
  work_order_id: string; title: string; project_name: string; crew_id: string; crew_name: string;
  /** The person's own record in the workforce register; null when they have none (no clock-in then). */
  my_worker_id: string | null; is_controller: boolean;
  /** #2705: the work order has a check-in area, so a position is read on the tap. Absent or false = today's clock-in. */
  has_area?: boolean;
}
export interface MyHomeIssue { id: string; type: string; severity: string; status: string; incident_date: string; description: string | null }
export interface MyHome { today: string; tasks: MyHomeTask[]; work_orders: MyHomeWorkOrder[]; issues: MyHomeIssue[] }

/** A delivery addressed to the person, to confirm with count and photo. Supplied by the handover ticket; none exists yet. */
export interface MyDelivery { id: string; number: string; description: string; lineCount: number }

export async function getMyHome(): Promise<MyHome> {
  // `my_home` is not in the generated types until the next regeneration; the cast is the whole seam.
  const { data, error } = await supabase.rpc('my_home' as never);
  if (error) throw new AppError(error.message, error.code);
  const home = data as unknown as MyHome | null;
  return { today: home?.today ?? '', tasks: home?.tasks ?? [], work_orders: home?.work_orders ?? [], issues: home?.issues ?? [] };
}

/** A light account may change only the status of its own task (database-enforced). */
export async function setMyTaskStatus(taskId: string, status: 'To Do' | 'In Progress' | 'Done' | 'Blocked'): Promise<void> {
  const { data, error } = await supabase.from('tasks').update({ status }).eq('id', taskId).select('id');
  if (error) throw new AppError(error.message, error.code);
  if (!data || data.length === 0) throw new AppError('Task not found', 'PGRST116');
}

/**
 * Transfers sent to the person that wait for their count. The database decides who sees what (a light account reads only its own
 * transfer, 1480), so the filter on `to_user_id` is for the full accounts that can read every transfer. Read-only: the count,
 * photo and confirmation go through the transfer page and `receive_stock_transfer`.
 */
export async function getMyDeliveries(userId: string): Promise<MyDelivery[]> {
  const { data, error } = await (supabase as unknown as { from: (t: string) => any }) // eslint-disable-line @typescript-eslint/no-explicit-any
    .from('stock_transfers').select('id, number, note, sent_by, stock_transfer_lines(id)')
    .eq('status', 'Sent').eq('to_user_id', userId).order('sent_at', { ascending: false }).limit(20);
  if (error) throw new AppError(error.message, error.code);
  return ((data ?? []) as { id: string; number: string; note: string | null; sent_by: string; stock_transfer_lines: unknown[] | null }[])
    .filter((r) => r.sent_by !== userId) // the sender never counts their own shipment
    .map((r) => ({ id: r.id, number: r.number, description: r.note ?? '', lineCount: r.stock_transfer_lines?.length ?? 0 }));
}

export interface SeatReport { full: number; light: number; total: number }
export async function getSeatReport(): Promise<SeatReport> {
  const { data, error } = await supabase.rpc('org_seat_report' as never);
  if (error) throw new AppError(error.message, error.code);
  const r = data as unknown as Partial<SeatReport> | null;
  return { full: Number(r?.full ?? 0), light: Number(r?.light ?? 0), total: Number(r?.total ?? 0) };
}
