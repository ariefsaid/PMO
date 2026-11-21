import { supabase } from '@/src/lib/supabase/client';
import { AppError } from '@/src/lib/appError';
import { SIGNED_URL_EXPIRY_SECONDS } from '@/src/lib/fileConstants';

/**
 * Timed checkpoints DAL (#2594, migrations 1385..1388). Reads are RPCs or RLS selects; every write is a server RPC
 * (`set_site_checkpoint_list`, `record_site_checkpoint`). The recorded time and person are stamped by the server and are
 * never sent. org_id is never sent. Generated types predate 1385, so this module uses a narrow shape and validates what
 * comes back instead of defaulting a missing field.
 */
export interface CheckpointTemplateItem {
  name: string;
  marks_work_start: boolean;
  due_time: string; // HH:MM
  grace_minutes: number;
  photo_required: boolean;
}
export type CheckpointState = 'on_time' | 'late' | 'pending';
export interface DayCheckpoint {
  id: string; crew_id: string; crew_name: string; position: number; name: string; marks_work_start: boolean;
  due_at: string; grace_minutes: number; photo_required: boolean; recorded_at: string | null; recorded_by: string | null;
  recorded_by_name: string | null; note: string | null; photo_path: string | null; state: CheckpointState;
}
export type PunctualityStatus = 'on_time' | 'late' | 'not_started';
export interface PunctualityDay {
  work_date: string; work_order_id: string; due_at: string; recorded_at: string | null; status: PunctualityStatus; minutes_late: number | null;
}
export interface CrewPunctuality { crew_id: string; crew_name: string; days: number; on_time: number; share_on_time: number; day_rows: PunctualityDay[] }
export interface PunctualityResult { from: string; to: string; truncated: boolean; crews: CrewPunctuality[] }
export interface LostTimeRow { reason_id: string; label: string; archived: boolean; minutes: number }
export interface LostTimeResult { from: string; to: string; total_minutes: number; report_count: number; rows: LostTimeRow[] }
export interface PunctualityFilter { from: string; to: string; projectId?: string | null; workOrderId?: string | null }

export const SITE_CHECKPOINT_PHOTOS_BUCKET = 'site-checkpoint-photos';

type Err = { message: string; code?: string } | null;
interface Loose {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- the PostgREST builder chain; generated types predate 1385
  from(table: string): any;
  rpc(fn: string, args?: Record<string, unknown>): PromiseLike<{ data: unknown; error: Err }>;
}
const db = supabase as unknown as Loose;
const fail = (error: { message: string; code?: string }): never => { throw new AppError(error.message, error.code); };
const malformed = (what: string): never => { throw new AppError(`Unexpected ${what} from the server`); };

async function call(fn: string, args: Record<string, unknown>): Promise<unknown> {
  const { data, error } = await db.rpc(fn, args);
  if (error) fail(error);
  return data;
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown, what: string): string => (typeof v === 'string' ? v : malformed(what));
const strOrNull = (v: unknown, what: string): string | null => (v === null ? null : str(v, what));
const num = (v: unknown, what: string): number => (typeof v === 'number' && Number.isFinite(v) ? v : malformed(what));
const bool = (v: unknown, what: string): boolean => (typeof v === 'boolean' ? v : malformed(what));

/** "07:00:00" from the server becomes "07:00" for a time input. */
const hhmm = (v: unknown): string => str(v, 'checkpoint time').slice(0, 5);

export async function getCheckpointList(): Promise<CheckpointTemplateItem[]> {
  const { data, error } = await db.from('site_checkpoint_templates')
    .select('position, name, marks_work_start, due_time, grace_minutes, photo_required').order('position', { ascending: true });
  if (error) fail(error);
  if (!Array.isArray(data)) return malformed('checkpoint list');
  return data.map((r: unknown) => {
    if (!isObj(r)) return malformed('checkpoint');
    return {
      name: str(r.name, 'checkpoint name'), marks_work_start: bool(r.marks_work_start, 'checkpoint flag'), due_time: hhmm(r.due_time),
      grace_minutes: num(r.grace_minutes, 'checkpoint grace'), photo_required: bool(r.photo_required, 'checkpoint photo flag'),
    };
  });
}

/** Replaces the whole list (Admin only, server-checked). An empty list switches the feature off. */
export async function setCheckpointList(items: CheckpointTemplateItem[]): Promise<number> {
  return num(await call('set_site_checkpoint_list', { p_items: items }), 'saved count');
}

export async function listDayCheckpoints(workOrderId: string, date: string): Promise<DayCheckpoint[]> {
  const data = await call('site_checkpoints_for_day', { p_work_order: workOrderId, p_date: date });
  if (!Array.isArray(data)) return malformed('checkpoints');
  return data.map((r: unknown) => {
    if (!isObj(r)) return malformed('checkpoint');
    const state = r.state;
    if (state !== 'on_time' && state !== 'late' && state !== 'pending') return malformed('checkpoint state');
    return {
      id: str(r.id, 'id'), crew_id: str(r.crew_id, 'crew'), crew_name: str(r.crew_name, 'crew name'), position: num(r.position, 'position'),
      name: str(r.name, 'name'), marks_work_start: bool(r.marks_work_start, 'flag'), due_at: str(r.due_at, 'due'),
      grace_minutes: num(r.grace_minutes, 'grace'), photo_required: bool(r.photo_required, 'photo flag'),
      recorded_at: strOrNull(r.recorded_at ?? null, 'recorded time'), recorded_by: strOrNull(r.recorded_by ?? null, 'recorder'),
      recorded_by_name: strOrNull(r.recorded_by_name ?? null, 'recorder name'), note: strOrNull(r.note ?? null, 'note'),
      photo_path: strOrNull(r.photo_path ?? null, 'photo'), state,
    };
  });
}

export async function getWorkOrderFlag(workOrderId: string, date?: string | null): Promise<boolean> {
  return bool(await call('work_order_checkpoint_flag', { p_work_order: workOrderId, p_date: date ?? null }), 'flag');
}

export function buildCheckpointPhotoPath(c: { org_id: string; work_order_id: string; crew_id: string; work_date: string; id: string }, file: File): string {
  const ext = (file.name.split('.').pop() ?? '').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 5)
    || (file.type === 'image/png' ? 'png' : file.type === 'image/webp' ? 'webp' : 'jpg');
  return `${c.org_id}/${c.work_order_id}/${c.crew_id}/${c.work_date}/${c.id}.${ext}`;
}

export interface RecordInput {
  checkpoint: { id: string; org_id: string; work_order_id: string; crew_id: string; work_date: string };
  file: File | null;
  note: string | null;
}

/** Upload (when there is a photo), then record: the server verifies the object and stamps time and person. A failed record removes the orphan. */
export async function recordCheckpoint(input: RecordInput): Promise<void> {
  let path: string | null = null;
  const bucket = supabase.storage.from(SITE_CHECKPOINT_PHOTOS_BUCKET);
  if (input.file) {
    path = buildCheckpointPhotoPath(input.checkpoint, input.file);
    const { error: upErr } = await bucket.upload(path, input.file, { contentType: input.file.type || undefined, upsert: false });
    if (upErr) throw new AppError(upErr.message);
  }
  const { error } = await db.rpc('record_site_checkpoint', { p_checkpoint: input.checkpoint.id, p_photo_path: path, p_note: input.note });
  if (error) {
    if (path) await bucket.remove([path]);
    fail(error);
  }
}

export async function checkpointPhotoUrl(path: string): Promise<string> {
  const { data, error } = await supabase.storage.from(SITE_CHECKPOINT_PHOTOS_BUCKET).createSignedUrl(path, SIGNED_URL_EXPIRY_SECONDS);
  if (error || !data?.signedUrl) throw new AppError(error?.message ?? 'Could not open the photo');
  return data.signedUrl;
}

export async function getCrewPunctuality(filter: PunctualityFilter): Promise<PunctualityResult> {
  const data = await call('crew_start_punctuality', {
    p_from: filter.from, p_to: filter.to, p_project: filter.projectId ?? null, p_work_order: filter.workOrderId ?? null,
  });
  if (!isObj(data) || !Array.isArray(data.crews)) return malformed('crews view');
  return {
    from: str(data.from, 'from'), to: str(data.to, 'to'), truncated: bool(data.truncated, 'truncated'),
    crews: data.crews.map((c: unknown) => {
      if (!isObj(c) || !Array.isArray(c.day_rows)) return malformed('crew');
      return {
        crew_id: str(c.crew_id, 'crew'), crew_name: str(c.crew_name, 'crew name'), days: num(c.days, 'days'), on_time: num(c.on_time, 'on time'),
        share_on_time: num(c.share_on_time, 'share'),
        day_rows: c.day_rows.map((d: unknown) => {
          if (!isObj(d)) return malformed('day');
          const status = d.status;
          if (status !== 'on_time' && status !== 'late' && status !== 'not_started') return malformed('day status');
          return {
            work_date: str(d.work_date, 'date'), work_order_id: str(d.work_order_id, 'work order'), due_at: str(d.due_at, 'due'),
            recorded_at: strOrNull(d.recorded_at ?? null, 'recorded'), status,
            minutes_late: d.minutes_late === null || d.minutes_late === undefined ? null : num(d.minutes_late, 'minutes late'),
          };
        }),
      };
    }),
  };
}

export async function getLostTimeByCause(filter: PunctualityFilter): Promise<LostTimeResult> {
  const data = await call('site_lost_time_by_cause', {
    p_from: filter.from, p_to: filter.to, p_project: filter.projectId ?? null, p_work_order: filter.workOrderId ?? null,
  });
  if (!isObj(data) || !Array.isArray(data.rows)) return malformed('lost time');
  return {
    from: str(data.from, 'from'), to: str(data.to, 'to'), total_minutes: num(data.total_minutes, 'total'), report_count: num(data.report_count, 'reports'),
    rows: data.rows.map((r: unknown) => {
      if (!isObj(r)) return malformed('cause');
      return { reason_id: str(r.reason_id, 'cause'), label: str(r.label, 'label'), archived: bool(r.archived, 'archived'), minutes: num(r.minutes, 'minutes') };
    }),
  };
}

/** The columns the record call needs from a checkpoint row (the day list omits org and work date, which the caller knows). */
export async function getCheckpointRecordRefs(id: string): Promise<{ id: string; org_id: string; work_order_id: string; crew_id: string; work_date: string }> {
  const { data, error } = await db.from('site_checkpoints').select('id, org_id, work_order_id, crew_id, work_date').eq('id', id).maybeSingle();
  if (error) fail(error);
  if (!isObj(data)) return malformed('checkpoint');
  return { id: str(data.id, 'id'), org_id: str(data.org_id, 'org'), work_order_id: str(data.work_order_id, 'work order'), crew_id: str(data.crew_id, 'crew'), work_date: str(data.work_date, 'date') };
}
