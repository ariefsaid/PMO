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
export interface MyDelivery { id: string; description: string }

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

export async function getMyDeliveries(): Promise<MyDelivery[]> {
  return []; // seam: the handover ticket supplies deliveries addressed to a person; no table, no stock write here.
}

export interface SeatReport { full: number; light: number; total: number }
export async function getSeatReport(): Promise<SeatReport> {
  const { data, error } = await supabase.rpc('org_seat_report' as never);
  if (error) throw new AppError(error.message, error.code);
  const r = data as unknown as Partial<SeatReport> | null;
  return { full: Number(r?.full ?? 0), light: Number(r?.light ?? 0), total: Number(r?.total ?? 0) };
}

export type AbsenceReason = 'sick' | 'other';
export interface MyAbsence { reason: AbsenceReason; note: string | null }

/** "I am not coming in today": the caller's own report for today (the database names the person, never the client). */
export async function reportAbsence(reason: AbsenceReason, note: string): Promise<void> {
  const { error } = await supabase.rpc('report_absence' as never, { p_reason: reason, p_note: note.trim() || null } as never);
  if (error) throw new AppError(error.message, error.code);
}

/** The caller's report for a date, if any (RLS shows a worker only their own). */
export async function getMyAbsence(workDate: string): Promise<MyAbsence | null> {
  const { data, error } = await supabase.from('absence_reports' as never).select('reason, note').eq('work_date', workDate).limit(1);
  if (error) throw new AppError(error.message, error.code);
  const row = (data as unknown as MyAbsence[] | null)?.[0];
  return row ?? null;
}
