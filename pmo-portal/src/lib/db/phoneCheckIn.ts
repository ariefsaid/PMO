import { supabase } from '@/src/lib/supabase/client';
import { nullableArg } from './nullableArg';
import { AppError } from '@/src/lib/appError';

/**
 * Phone check-in at the work location (#2705, migrations 1210-1214). The database decides inside / outside from the position it
 * receives (haversine in SQL); nothing here computes distance or sends an "inside" flag.
 */
export type CheckInStatus = 'recorded' | 'pending' | 'needs_position';
export type CheckInOutcome = 'inside' | 'outside' | 'not_rostered' | 'no_position' | 'no_area';
export interface CheckInResult { status: CheckInStatus; outcome?: CheckInOutcome; id?: string; distance_m?: number | null }

export interface CheckInArgs {
  workOrderId: string; crewId: string | null; hours: number;
  position?: { lat: number; lng: number; accuracy: number };
  /** Permission refused or no fix: ask the supervisor without a position. */
  noPosition?: boolean;
}

export async function phoneCheckIn(a: CheckInArgs): Promise<CheckInResult> {
  const { data, error } = await supabase.rpc('phone_check_in', {
    p_work_order_id: a.workOrderId, p_crew_id: nullableArg(a.crewId),
    p_lat: nullableArg(a.position?.lat ?? null), p_lng: nullableArg(a.position?.lng ?? null),
    p_accuracy: nullableArg(a.position?.accuracy ?? null),
    p_hours: a.hours, p_no_position: a.noPosition ?? false,
  });
  if (error) throw new AppError(error.message, error.code);
  // `phone_check_in` is declared `returns jsonb`, so the generated type is `Json` and carries no shape; this interface is
  // the contract.
  return data as unknown as CheckInResult;
}

export interface CheckInRequest {
  id: string; work_order_id: string; work_order_title: string; worker_name: string; crew_id: string | null; crew_name: string | null;
  work_date: string; hours: number; outcome: CheckInOutcome; distance_m: number | null; accuracy_m: number | null; checked_in_at: string;
}

export async function listCheckInRequests(): Promise<CheckInRequest[]> {
  const { data, error } = await supabase.rpc('phone_check_in_requests');
  if (error) throw new AppError(error.message, error.code);
  // `returns table` states no nullability, so the generated row marks every column NOT NULL; the crew, its name, the
  // distance and the accuracy are genuinely absent without a position, and the outcome is bounded by the database's own case.
  return (data ?? []).map((row) => ({
    id: row.id, work_order_id: row.work_order_id, work_order_title: row.work_order_title, worker_name: row.worker_name,
    crew_id: row.crew_id ?? null, crew_name: row.crew_name ?? null, work_date: row.work_date, hours: row.hours,
    outcome: row.outcome as CheckInOutcome, distance_m: row.distance_m ?? null, accuracy_m: row.accuracy_m ?? null,
    checked_in_at: row.checked_in_at,
  }));
}

export async function decideCheckIn(id: string, approve: boolean, reason: string | null): Promise<void> {
  const { error } = await supabase.rpc('phone_check_in_decide', { p_request_id: id, p_approve: approve, p_reason: reason ?? undefined });
  if (error) throw new AppError(error.message, error.code);
}

export interface WorkOrderArea { lat: number; lng: number; radius_m: number }

export async function getWorkOrderArea(workOrderId: string): Promise<WorkOrderArea | null> {
  const { data, error } = await supabase.from('work_orders').select('area_lat, area_lng, area_radius_m').eq('id', workOrderId).maybeSingle();
  if (error) throw new AppError(error.message, error.code);
  if (!data || data.area_lat == null || data.area_lng == null || data.area_radius_m == null) return null;
  return { lat: data.area_lat, lng: data.area_lng, radius_m: data.area_radius_m };
}

/** Whoever may update a work order today may set its area (RLS decides); `null` clears it. */
export async function setWorkOrderArea(workOrderId: string, area: WorkOrderArea | null): Promise<void> {
  const patch = area
    ? { area_lat: area.lat, area_lng: area.lng, area_radius_m: area.radius_m }
    : { area_lat: null, area_lng: null, area_radius_m: null };
  const { error } = await supabase.from('work_orders').update(patch).eq('id', workOrderId);
  if (error) throw new AppError(error.message, error.code);
}

export async function getSupervisorRole(): Promise<string | null> {
  const { data, error } = await supabase.rpc('get_phone_check_in_supervisor_role');
  if (error) throw new AppError(error.message, error.code);
  return data ?? null;
}

export async function setSupervisorRole(role: string | null): Promise<void> {
  const { error } = await supabase.rpc('set_phone_check_in_supervisor_role', { p_role: nullableArg(role) });
  if (error) throw new AppError(error.message, error.code);
}
