import { supabase } from '@/src/lib/supabase/client';
import { AppError } from '@/src/lib/appError';

/**
 * Phone check-in at the work location (#2705, migrations 1210-1214). The database decides inside / outside from the position it
 * receives (haversine in SQL); nothing here computes distance or sends an "inside" flag. The RPCs are not in the generated types
 * until the next regeneration, so the casts below are the whole seam.
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
  const { data, error } = await supabase.rpc('phone_check_in' as never, {
    p_work_order_id: a.workOrderId, p_crew_id: a.crewId,
    p_lat: a.position?.lat ?? null, p_lng: a.position?.lng ?? null, p_accuracy: a.position?.accuracy ?? null,
    p_hours: a.hours, p_no_position: a.noPosition ?? false,
  } as never);
  if (error) throw new AppError(error.message, error.code);
  return data as unknown as CheckInResult;
}

export interface CheckInRequest {
  id: string; work_order_id: string; work_order_title: string; worker_name: string; crew_id: string | null; crew_name: string | null;
  work_date: string; hours: number; outcome: CheckInOutcome; distance_m: number | null; accuracy_m: number | null; checked_in_at: string;
}

export async function listCheckInRequests(): Promise<CheckInRequest[]> {
  const { data, error } = await supabase.rpc('phone_check_in_requests' as never);
  if (error) throw new AppError(error.message, error.code);
  return (data as unknown as CheckInRequest[] | null) ?? [];
}

export async function decideCheckIn(id: string, approve: boolean, reason: string | null): Promise<void> {
  const { error } = await supabase.rpc('phone_check_in_decide' as never, { p_request_id: id, p_approve: approve, p_reason: reason } as never);
  if (error) throw new AppError(error.message, error.code);
}

export interface WorkOrderArea { lat: number; lng: number; radius_m: number }
interface AreaRow { area_lat: number | null; area_lng: number | null; area_radius_m: number | null }
interface AreaTable {
  select: (cols: string) => { eq: (c: string, v: string) => { maybeSingle: () => Promise<{ data: AreaRow | null; error: { message: string; code?: string } | null }> } };
  update: (v: AreaRow) => { eq: (c: string, v: string) => Promise<{ error: { message: string; code?: string } | null }> };
}
const workOrders = () => (supabase as unknown as { from: (t: string) => AreaTable }).from('work_orders');

export async function getWorkOrderArea(workOrderId: string): Promise<WorkOrderArea | null> {
  const { data, error } = await workOrders().select('area_lat, area_lng, area_radius_m').eq('id', workOrderId).maybeSingle();
  if (error) throw new AppError(error.message, error.code);
  if (!data || data.area_lat == null || data.area_lng == null || data.area_radius_m == null) return null;
  return { lat: data.area_lat, lng: data.area_lng, radius_m: data.area_radius_m };
}

/** Whoever may update a work order today may set its area (RLS decides); `null` clears it. */
export async function setWorkOrderArea(workOrderId: string, area: WorkOrderArea | null): Promise<void> {
  const patch: AreaRow = area
    ? { area_lat: area.lat, area_lng: area.lng, area_radius_m: area.radius_m }
    : { area_lat: null, area_lng: null, area_radius_m: null };
  const { error } = await workOrders().update(patch).eq('id', workOrderId);
  if (error) throw new AppError(error.message, error.code);
}

export async function getSupervisorRole(): Promise<string | null> {
  const { data, error } = await supabase.rpc('get_phone_check_in_supervisor_role' as never);
  if (error) throw new AppError(error.message, error.code);
  return (data as unknown as string | null) ?? null;
}

export async function setSupervisorRole(role: string | null): Promise<void> {
  const { error } = await supabase.rpc('set_phone_check_in_supervisor_role' as never, { p_role: role } as never);
  if (error) throw new AppError(error.message, error.code);
}
