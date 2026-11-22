import { supabase } from '@/src/lib/supabase/client';
import { AppError } from '@/src/lib/appError';
import { fetchAllPages } from '@/src/lib/pagedRead';
import { sanitizeFilename } from '@/src/lib/storageKey';
import { SIGNED_URL_EXPIRY_SECONDS } from '@/src/lib/fileConstants';
import type { SafetySummary } from '@/src/lib/safetyDay';
import type { TablesInsert } from '@/src/lib/supabase/database.types';
import { nullableArg } from './nullableArg';

/**
 * Daily safety records DAL (#2596, migrations 1410-1414). Reads are RLS-scoped selects; creation, the toolbox talk,
 * submit and correction are RPCs; the other parts are plain row writes the database guards (draft only, roster, lists).
 * org_id is never sent. Every summary figure is validated: a malformed or missing number throws, it is never a 0.
 */
export type SafetyListKind = 'check_type' | 'permit_type' | 'checklist_item';
export interface SafetyListItem { id: string; kind: SafetyListKind; label: string; position: number; archived_at: string | null }

export interface SafetyDay {
  id: string; org_id: string; project_id: string; work_order_id: string; work_date: string; status: 'draft' | 'locked';
  version: number; supersedes_id: string | null; correction_reason: string | null; author_id: string; submitted_at: string | null;
}
export interface SafetyFitnessCheck { id: string; worker_id: string | null; visitor_name: string | null; check_type_id: string | null; result: 'fit' | 'not_fit' | 'not_checked'; note: string | null }
export interface SafetyTalk { id: string; topic: string; presenter: string; held_at: string; attendees: { id: string; worker_id: string | null; visitor_name: string | null }[]; photos: SafetyPhoto[] }
export interface SafetyPhoto { id: string; file_path: string }
export interface SafetyChecklistAnswer { id: string; label: string; position: number; answer: 'yes' | 'no' | 'not_applicable' | null; note: string | null }
export interface SafetyPermit { id: string; permit_number: string; type_id: string | null; valid_from: string; valid_to: string; issued_by: string | null; state: 'open' | 'closed' }
export interface SafetyOfficerEntry { id: string; body: string; near_misses: number; observations: number; incident_id: string | null; author_id: string; created_at: string }
export interface SafetyDayDetail {
  day: SafetyDay;
  fitness: SafetyFitnessCheck[];
  talks: SafetyTalk[];
  checklist: SafetyChecklistAnswer[];
  permits: SafetyPermit[];
  officer: SafetyOfficerEntry[];
}
export interface SafetyWorkOrderDay {
  work_date: string; day_id: string | null; status: 'draft' | 'locked' | null; version: number | null;
  workers_present: number; missing: string[]; complete: boolean;
}
export interface SafetyDetailRow { date: string; work_order_id: string | null; ref_id: string | null; label: string }
export type SafetyDetailKind = 'lost_time_incidents' | 'recordable_incidents' | 'days_without_record' | 'complete_days' | 'toolbox_talks' | 'near_misses';
export interface RosterWorker { worker_id: string; display_name: string }

export const SAFETY_PHOTOS_BUCKET = 'safety-photos';
const DAY_COLS = 'id, org_id, project_id, work_order_id, work_date, status, version, supersedes_id, correction_reason, author_id, submitted_at';

const fail = (error: { message: string; code?: string }): never => { throw new AppError(error.message, error.code); };

// ── the switch and the lists ───────────────────────────────────────────────────────────────────────────
export async function isEnabled(): Promise<boolean> {
  const { data, error } = await supabase.rpc('safety_records_enabled');
  if (error) fail(error);
  return data === true;
}
export async function setEnabled(enabled: boolean): Promise<void> {
  const { error } = await supabase.rpc('set_safety_records_enabled', { p_enabled: enabled });
  if (error) fail(error);
}

/** Every entry of a kind; archived ones only when asked (the Admin editor), the pickers never. */
export async function listItems(kind: SafetyListKind, includeArchived = false): Promise<SafetyListItem[]> {
  const rows = await fetchAllPages((f, t) => {
    const q = supabase.from('safety_list_items').select('id, kind, label, position, archived_at').eq('kind', kind);
    return (includeArchived ? q : q.is('archived_at', null)).order('position').order('created_at').order('id').range(f, t);
  });
  // `kind` is `text` with a CHECK of the three values, which the generated row states as `string`.
  return rows.map((r) => ({ ...r, kind: r.kind as SafetyListKind }));
}
export async function addItem(kind: SafetyListKind, label: string): Promise<void> {
  const { error } = await supabase.from('safety_list_items').insert({ kind, label: label.trim() });
  if (error) fail(error);
}
export async function renameItem(id: string, label: string): Promise<void> {
  const { error } = await supabase.from('safety_list_items').update({ label: label.trim() }).eq('id', id);
  if (error) fail(error);
}
export async function setItemArchived(id: string, archived: boolean): Promise<void> {
  const { error } = await supabase.from('safety_list_items').update({ archived_at: archived ? new Date().toISOString() : null }).eq('id', id);
  if (error) fail(error);
}

// ── days ────────────────────────────────────────────────────────────────────────────────────────────────
export async function workOrderDays(workOrderId: string, from: string, to: string): Promise<SafetyWorkOrderDay[]> {
  const { data, error } = await supabase.rpc('safety_work_order_days', { p_work_order_id: workOrderId, p_from: from, p_to: to });
  if (error) fail(error);
  // `returns table` states no nullability, so the generated row marks every column NOT NULL; a date with no record has
  // no day, no status and no version, and the status is bounded by the database's own CHECK.
  return (data ?? []).map((r) => ({
    ...r, day_id: r.day_id ?? null, status: (r.status ?? null) as SafetyWorkOrderDay['status'], version: r.version ?? null,
    workers_present: Number(r.workers_present), missing: r.missing ?? [],
  }));
}

export async function createDay(workOrderId: string, workDate: string): Promise<string> {
  // `project_id` is copied from the work order by the safety_days_guard trigger (migration 1411), which introspection
  // cannot see, so the generated Insert type asks for a column the client must not send.
  const row = { work_order_id: workOrderId, work_date: workDate } satisfies Omit<TablesInsert<'safety_days'>, 'project_id'>;
  const { data, error } = await supabase.from('safety_days').insert(row as TablesInsert<'safety_days'>).select('id').single();
  if (error) fail(error);
  // `.single()` resolves the row or an error, never a null body.
  return (data as { id: string }).id;
}

export async function getDay(id: string): Promise<SafetyDayDetail | null> {
  const { data, error } = await supabase.from('safety_days').select(DAY_COLS).eq('id', id).maybeSingle();
  if (error) fail(error);
  if (!data) return null;
  const [fitness, talks, attendees, photos, checklist, permits, officer] = await Promise.all([
    fetchAllPages((f, t) => supabase.from('safety_fitness_checks').select('id, worker_id, visitor_name, check_type_id, result, note').eq('day_id', id).order('id').range(f, t)),
    fetchAllPages((f, t) => supabase.from('safety_toolbox_talks').select('id, topic, presenter, held_at').eq('day_id', id).order('held_at').order('id').range(f, t)),
    fetchAllPages((f, t) => supabase.from('safety_toolbox_attendees').select('id, talk_id, worker_id, visitor_name').eq('day_id', id).order('id').range(f, t)),
    fetchAllPages((f, t) => supabase.from('safety_toolbox_photos').select('id, talk_id, file_path').eq('day_id', id).order('created_at').order('id').range(f, t)),
    fetchAllPages((f, t) => supabase.from('safety_checklist_answers').select('id, label, position, answer, note').eq('day_id', id).order('position').order('id').range(f, t)),
    fetchAllPages((f, t) => supabase.from('safety_permits').select('id, permit_number, type_id, valid_from, valid_to, issued_by, state').eq('day_id', id).order('valid_from').order('id').range(f, t)),
    fetchAllPages((f, t) => supabase.from('safety_officer_entries').select('id, body, near_misses, observations, incident_id, author_id, created_at').eq('day_id', id).order('created_at').order('id').range(f, t)),
  ]);
  return {
    day: data as SafetyDay,
    fitness: fitness.map((r) => ({ ...r, result: r.result as SafetyFitnessCheck['result'] })),
    checklist: checklist.map((r) => ({ ...r, answer: r.answer as SafetyChecklistAnswer['answer'] })),
    permits: permits.map((r) => ({ ...r, state: r.state as SafetyPermit['state'] })),
    officer,
    talks: talks.map((t) => ({
      ...t,
      attendees: attendees.filter((a) => a.talk_id === t.id).map(({ id: aid, worker_id, visitor_name }) => ({ id: aid, worker_id, visitor_name })),
      photos: photos.filter((p) => p.talk_id === t.id).map(({ id: pid, file_path }) => ({ id: pid, file_path })),
    })),
  };
}

/** Workers on the work order's roster for the date (the same shipped read the attendance tick uses). */
export async function rosterWorkers(workOrderId: string, workDate: string): Promise<RosterWorker[]> {
  const { data, error } = await supabase.rpc('work_order_roster', { p_work_order_id: workOrderId, p_date: workDate });
  if (error) fail(error);
  const seen = new Map<string, RosterWorker>();
  for (const crew of data ?? []) {
    // `members` is declared `jsonb` in the generated row: its shape is stated here.
    for (const m of (crew.members ?? []) as unknown as RosterWorker[]) seen.set(m.worker_id, { worker_id: m.worker_id, display_name: m.display_name });
  }
  return [...seen.values()].sort((a, b) => a.display_name.localeCompare(b.display_name) || (a.worker_id < b.worker_id ? -1 : 1));
}

// ── parts ───────────────────────────────────────────────────────────────────────────────────────────────
export async function saveFitness(dayId: string, row: { workerId?: string | null; visitorName?: string | null; checkTypeId?: string | null; result: SafetyFitnessCheck['result']; note?: string | null }): Promise<void> {
  const { error } = await supabase.from('safety_fitness_checks').insert({
    day_id: dayId, worker_id: row.workerId ?? null, visitor_name: row.visitorName ?? null, check_type_id: row.checkTypeId ?? null,
    result: row.result, note: row.note?.trim() || null,
  });
  if (error) fail(error);
}
export async function updateFitness(id: string, patch: { result: SafetyFitnessCheck['result']; note?: string | null }): Promise<void> {
  const { error } = await supabase.from('safety_fitness_checks').update({ result: patch.result, note: patch.note?.trim() || null }).eq('id', id);
  if (error) fail(error);
}
export async function deleteFitness(id: string): Promise<void> {
  const { error } = await supabase.from('safety_fitness_checks').delete().eq('id', id);
  if (error) fail(error);
}
export async function answerChecklist(id: string, answer: SafetyChecklistAnswer['answer'], note: string | null): Promise<void> {
  const { error } = await supabase.from('safety_checklist_answers').update({ answer, note: note?.trim() || null }).eq('id', id);
  if (error) fail(error);
}
export async function saveTalk(dayId: string, v: { topic: string; presenter: string; heldAt: string; attendees: { workerId?: string; visitorName?: string }[] }): Promise<string> {
  const { data, error } = await supabase.rpc('safety_save_talk', {
    p_day: dayId, p_topic: v.topic.trim(), p_presenter: v.presenter.trim(), p_held_at: v.heldAt,
    p_attendees: v.attendees.map((a) => ({ worker_id: a.workerId ?? null, visitor_name: a.visitorName ?? null })),
  });
  if (error) fail(error);
  return String(data);
}
export async function deleteTalk(id: string): Promise<void> {
  const { error } = await supabase.from('safety_toolbox_talks').delete().eq('id', id);
  if (error) fail(error);
}
export async function savePermit(dayId: string, v: { permitNumber: string; typeId?: string | null; validFrom: string; validTo: string; issuedBy?: string | null }): Promise<void> {
  const { error } = await supabase.from('safety_permits').insert({
    day_id: dayId, permit_number: v.permitNumber.trim(), type_id: v.typeId ?? null, valid_from: v.validFrom, valid_to: v.validTo, issued_by: v.issuedBy?.trim() || null,
  });
  if (error) fail(error);
}
export async function setPermitState(id: string, state: 'open' | 'closed'): Promise<void> {
  const { error } = await supabase.from('safety_permits').update({ state }).eq('id', id);
  if (error) fail(error);
}
export async function deletePermit(id: string): Promise<void> {
  const { error } = await supabase.from('safety_permits').delete().eq('id', id);
  if (error) fail(error);
}
export async function addOfficerEntry(dayId: string, v: { body: string; nearMisses: number; observations: number; incidentId?: string | null }): Promise<void> {
  const { error } = await supabase.from('safety_officer_entries').insert({
    day_id: dayId, body: v.body.trim(), near_misses: v.nearMisses, observations: v.observations, incident_id: v.incidentId ?? null,
  });
  if (error) fail(error);
}
export async function submitDay(id: string): Promise<void> {
  const { error } = await supabase.rpc('submit_safety_day', { p_day: id });
  if (error) fail(error);
}
export async function correctDay(id: string, reason: string): Promise<string> {
  const { data, error } = await supabase.rpc('correct_safety_day', { p_day: id, p_reason: reason });
  if (error) fail(error);
  return String(data);
}

// ── photos ──────────────────────────────────────────────────────────────────────────────────────────────
export function buildSafetyPhotoPath(orgId: string, dayId: string, photoId: string, fileName: string): string {
  return `${orgId}/${dayId}/${photoId}/${sanitizeFilename(fileName)}`;
}
/** Upload to the private bucket, then record the row; a failed row removes the orphan object. */
export async function uploadTalkPhoto(day: Pick<SafetyDay, 'id' | 'org_id'>, talkId: string, file: File): Promise<void> {
  const photoId = crypto.randomUUID();
  const path = buildSafetyPhotoPath(day.org_id, day.id, photoId, file.name || 'photo.jpg');
  const bucket = supabase.storage.from(SAFETY_PHOTOS_BUCKET);
  const { error: upErr } = await bucket.upload(path, file, { contentType: file.type || undefined, upsert: false });
  if (upErr) throw new AppError(upErr.message);
  const { error } = await supabase.from('safety_toolbox_photos').insert({ id: photoId, day_id: day.id, talk_id: talkId, file_path: path });
  if (error) {
    await bucket.remove([path]);
    fail(error);
  }
}
export async function deletePhoto(id: string): Promise<void> {
  const { error } = await supabase.from('safety_toolbox_photos').delete().eq('id', id);
  if (error) fail(error);
}
export async function photoUrl(path: string): Promise<string> {
  const { data, error } = await supabase.storage.from(SAFETY_PHOTOS_BUCKET).createSignedUrl(path, SIGNED_URL_EXPIRY_SECONDS);
  if (error || !data?.signedUrl) throw new AppError(error?.message ?? 'Could not open the photo');
  return data.signedUrl;
}

// ── the monthly summary ─────────────────────────────────────────────────────────────────────────────────
const count = (raw: unknown, what: string): number => {
  const n = typeof raw === 'string' ? Number(raw) : raw;
  if (typeof n !== 'number' || !Number.isInteger(n) || n < 0) throw new AppError(`Malformed safety figure: ${what}`);
  return n;
};
const minutes = (raw: unknown, what: string): number | null => (raw === null || raw === undefined ? null : count(raw, what));

export function parseSafetySummary(raw: unknown): SafetySummary {
  if (!raw || typeof raw !== 'object') throw new AppError('Malformed safety summary');
  const r = raw as Record<string, unknown>;
  if (typeof r.month !== 'string') throw new AppError('Malformed safety summary: month');
  const hidden = (r.hidden && typeof r.hidden === 'object' ? r.hidden : {}) as Record<string, string>;
  return {
    month: r.month,
    timezone: String(r.timezone ?? ''),
    projectId: (r.project_id as string | null) ?? null,
    workedMinutes: minutes(r.worked_minutes, 'worked'),
    safeMinutes: minutes(r.safe_minutes, 'safe'),
    lostTimeIncidents: count(r.lost_time_incidents, 'lost-time'),
    recordableIncidents: count(r.recordable_incidents, 'recordable'),
    nearMisses: count(r.near_misses, 'near misses'),
    toolboxTalks: count(r.toolbox_talks, 'talks'),
    completeDays: count(r.complete_days, 'complete days'),
    daysWithoutRecord: count(r.days_without_record, 'days without a record'),
    hidden: { ...(hidden.worked_minutes ? { workedMinutes: hidden.worked_minutes } : {}), ...(hidden.safe_minutes ? { safeMinutes: hidden.safe_minutes } : {}) },
  };
}
export async function getSummary(projectId: string | null, month: string | null): Promise<SafetySummary> {
  // Both parameters DEFAULT to null; the module sends null, which is the same request.
  const { data, error } = await supabase.rpc('get_safety_summary', { p_project: nullableArg(projectId), p_month: nullableArg(month) });
  if (error) fail(error);
  return parseSafetySummary(data);
}
export async function getSummaryDetail(kind: SafetyDetailKind, projectId: string | null, month: string | null): Promise<SafetyDetailRow[]> {
  const { data, error } = await supabase.rpc('get_safety_summary_detail', { p_kind: kind, p_project: nullableArg(projectId), p_month: nullableArg(month) });
  if (error) fail(error);
  // `get_safety_summary_detail` is declared `returns jsonb`: its rows are stated here, not by the compiler.
  return (data ?? []) as unknown as SafetyDetailRow[];
}
