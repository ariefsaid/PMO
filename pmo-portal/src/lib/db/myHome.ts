import { supabase } from '@/src/lib/supabase/client';
import { AppError } from '@/src/lib/appError';

/**
 * The light-account phone home screen's data (#2710, migrations 1205-1209). `my_home()` returns only the caller's own items:
 * assigned tasks, work orders rostered today, reported issues. No price or budget field exists in the response.
 */
export interface MyHomeTask { id: string; name: string; status: string; end_date: string | null; project_id: string; project_name: string }
/** What became of today's clock-in on a work order (1552): clocked in at `at`, waiting for the supervisor, or refused with a reason. */
export interface MyHomeCheckIn { state: 'clocked_in' | 'pending' | 'rejected'; at?: string | null; outcome?: string; reason?: string | null }
export interface MyHomeWorkOrder {
  work_order_id: string; title: string; project_name: string; crew_id: string; crew_name: string;
  /** The person's own record in the workforce register; null when they have none (no clock-in then). */
  my_worker_id: string | null; is_controller: boolean;
  /** #2705: the work order has a check-in area, so a position is read on the tap. Absent or false = today's clock-in. */
  has_area?: boolean;
  /** Today's clock-in result here; null or absent = not clocked in yet. */
  check_in?: MyHomeCheckIn | null;
}
export interface MyHomeIssue { id: string; type: string; severity: string; status: string; incident_date: string; description: string | null }
export interface MyHome {
  today: string; tasks: MyHomeTask[]; work_orders: MyHomeWorkOrder[]; issues: MyHomeIssue[];
  /** Built-in role key that decides outside-area check-ins; null = the crew's Foreman or a crew manager. */
  decider_role: string | null;
}

/** A delivery addressed to the person, to confirm with count and photo. Supplied by the handover ticket; none exists yet. */
export interface MyDelivery { id: string; description: string }

export async function getMyHome(): Promise<MyHome> {
  const { data, error } = await supabase.rpc('my_home');
  if (error) throw new AppError(error.message, error.code);
  // `my_home` is declared `returns jsonb`, so its generated type is `Json` and carries no shape; the interface above is
  // the contract, and every field is defaulted rather than trusted.
  const home = data as unknown as MyHome | null;
  return { today: home?.today ?? '', tasks: home?.tasks ?? [], work_orders: home?.work_orders ?? [], issues: home?.issues ?? [], decider_role: home?.decider_role ?? null };
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
  const { data, error } = await supabase.rpc('org_seat_report');
  if (error) throw new AppError(error.message, error.code);
  // `org_seat_report` is declared `returns jsonb` too: `Json` in, the shape stated here, each figure defaulted.
  const r = data as unknown as Partial<SeatReport> | null;
  return { full: Number(r?.full ?? 0), light: Number(r?.light ?? 0), total: Number(r?.total ?? 0) };
}
