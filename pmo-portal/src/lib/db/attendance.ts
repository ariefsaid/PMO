import { supabase } from '@/src/lib/supabase/client';
import { AppError } from '@/src/lib/appError';
import { toStorageAppError } from '@/src/lib/storageError';
import { fetchAllRowsByKeyset } from '@/src/lib/pagedRead';

/**
 * Daily attendance (#2528, migrations 0989 + 0990).
 *
 * Every capture method writes the same record through ONE RPC (`attendance_record`), told apart by `source`
 * (OQ-CRW-1 is open, #2535): this app builds the crew-roster tick and the office correction; a phone check-in from
 * #1517 calls the same RPC with `phone_check_in`. The database enforces roster membership, the 24-hour day, the
 * back-date window, the lock and the approval SoD; this module only carries requests.
 */

export type AttendanceStatus = 'present' | 'absent' | 'leave' | 'off_rotation';
export type AttendanceSource = 'phone_check_in' | 'roster_tick' | 'manual_correction';

export const ATTENDANCE_PHOTOS_BUCKET = 'attendance-photos';

export interface AttendanceRowInput {
  worker_id: string;
  status: AttendanceStatus;
  hours?: number | null;
  overtime_hours?: number | null;
  reason?: string | null;
  /** The crew this person followed that day, when it is not their own (no loan arranged). */
  followed_crew_id?: string | null;
}

export interface AttendanceDayRow {
  id: string;
  worker_id: string;
  work_order_id: string;
  crew_id: string | null;
  work_date: string;
  status: AttendanceStatus;
  hours: number | null;
  overtime_hours: number | null;
  reason: string | null;
  source: AttendanceSource;
  tick_hours: number | null;
  phone_hours: number | null;
  needs_review: boolean;
  submitted_at: string | null;
  approved_at: string | null;
  locked_at: string | null;
  timesheet_entry_id: string | null;
}

export interface GenerateWeekResult {
  mode: 'timesheet' | 'attendance';
  timesheet_id: string | null;
  changed: boolean;
}

export interface AwaitingWeekRow {
  worker_id: string;
  work_date: string;
  hours: number | null;
  overtime_hours: number | null;
  /** The work order these hours belong to (a week can span several). */
  work_order_title: string | null;
}

function fail(error: { message: string; code?: string } | null): void {
  if (error) throw new AppError(error.message, error.code);
}

const DAY_COLUMNS = 'id, worker_id, work_order_id, crew_id, work_date, status, hours, overtime_hours, reason, source, '
  + 'tick_hours, phone_hours, needs_review, submitted_at, approved_at, locked_at, timesheet_entry_id';

/** Record one work order's day for several people at once. Resolves to the number of records written. */
export async function recordAttendance(
  workOrderId: string, workDate: string, source: AttendanceSource, rows: AttendanceRowInput[],
): Promise<number> {
  const { data, error } = await supabase.rpc('attendance_record', {
    p_work_order_id: workOrderId,
    p_work_date: workDate,
    p_source: source,
    p_rows: rows as unknown as never,
  });
  fail(error);
  return Number(data ?? 0);
}

/** The records already held for a work order on a date (the tick screen pre-fills from them). */
export async function listAttendanceDay(workOrderId: string, workDate: string): Promise<AttendanceDayRow[]> {
  return fetchAllRowsByKeyset<AttendanceDayRow>(async (afterId, limit) => {
    let q = supabase
      .from('attendance_days')
      .select(DAY_COLUMNS)
      .eq('work_order_id', workOrderId)
      .eq('work_date', workDate)
      .order('id', { ascending: true });
    if (afterId !== null) q = q.gt('id', afterId);
    return q.limit(limit) as unknown as PromiseLike<{ data: AttendanceDayRow[] | null; error: { message: string; code?: string } | null }>;
  });
}

/** Turn one person's week into their timesheet (a login) or submit it on the attendance (no login). Idempotent. */
export async function generateAttendanceWeek(workerId: string, weekStart: string): Promise<GenerateWeekResult> {
  const { data, error } = await supabase.rpc('attendance_generate_timesheet', { p_worker_id: workerId, p_week_start: weekStart });
  fail(error);
  return data as unknown as GenerateWeekResult;
}

/** Approve or return the submitted week of a person with no login. Resolves to the number of days decided. */
export async function decideAttendanceWeek(
  workerId: string, weekStart: string, decision: 'approve' | 'reject', reason: string | null,
): Promise<number> {
  const { data, error } = await supabase.rpc('attendance_decide_week', {
    p_worker_id: workerId, p_week_start: weekStart, p_decision: decision, p_reason: reason ?? undefined,
  });
  fail(error);
  return Number(data ?? 0);
}

/** Days submitted for approval and not yet decided (people with no login), oldest first. */
export async function listAwaitingAttendance(): Promise<AwaitingWeekRow[]> {
  type Raw = { id: string; worker_id: string; work_date: string; hours: number | null; overtime_hours: number | null;
    work_orders: { title: string } | null };
  const rows = await fetchAllRowsByKeyset<Raw>(async (afterId, limit) => {
    let q = supabase
      .from('attendance_days')
      .select('id, worker_id, work_date, hours, overtime_hours, work_orders(title)')
      .not('submitted_at', 'is', null)
      .is('locked_at', null)
      .order('id', { ascending: true });
    if (afterId !== null) q = q.gt('id', afterId);
    return q.limit(limit);
  });
  return rows
    .map(({ worker_id, work_date, hours, overtime_hours, work_orders }) => (
      { worker_id, work_date, hours, overtime_hours, work_order_title: work_orders?.title ?? null }))
    .sort((a, b) => a.work_date.localeCompare(b.work_date) || a.worker_id.localeCompare(b.worker_id));
}

/**
 * Attach the crew's group photo for a day (FR-CRW-009). The organisation prefix is read from the work order under
 * RLS, never typed by the client; the photo id is chosen first so a retry reuses the same path.
 */
export async function uploadAttendancePhoto(
  input: { photoId: string; workOrderId: string; crewId: string; workDate: string; file: File },
): Promise<void> {
  const { data: wo, error: woError } = await supabase.from('work_orders').select('org_id').eq('id', input.workOrderId).maybeSingle();
  fail(woError);
  if (!wo) throw new AppError('Work order not found.', 'P0002');
  const safeName = input.file.name.replace(/[^A-Za-z0-9._-]+/g, '_').slice(-80) || 'photo';
  const path = `${(wo as { org_id: string }).org_id}/${input.workOrderId}/${input.photoId}/${safeName}`;
  const { error: upError } = await supabase.storage.from(ATTENDANCE_PHOTOS_BUCKET)
    .upload(path, input.file, { upsert: false, contentType: input.file.type });
  if (upError) throw toStorageAppError(upError);
  const { error } = await supabase.from('attendance_photos').insert({
    id: input.photoId, work_order_id: input.workOrderId, crew_id: input.crewId, work_date: input.workDate, file_path: path,
  });
  fail(error);
}
