import { supabase } from '@/src/lib/supabase/client';
import { AppError } from '@/src/lib/appError';
import { toStorageAppError } from '@/src/lib/storageError';
import { fetchAllRowsByKeyset } from '@/src/lib/pagedRead';
import type { Tables } from '@/src/lib/supabase/database.types';
import type { ToolReportKind, ToolResolution } from '@/src/lib/crewToolQuantity';

/**
 * Crew hand-tools register and damage/loss reports (#2581, migrations 1080-1083).
 *
 * The database owns every rule: the usable quantity under a row lock, the photo rule, the one-call report + task +
 * notification, the close that also sets the task Done, and the serial and crew checks. This module only carries the
 * request; a refusal keeps its Postgres code (`23514` rule, `23505` duplicate, `42501` not allowed, `P0002` not found).
 * org_id is never sent: RLS and triggers stamp it.
 */

export const CREW_TOOL_FILES_BUCKET = 'crew-tool-files';

/** A live line with its open damaged and lost sums (the view narrows nothing: its columns are nullable only by construction). */
export type ToolLineRow = Pick<Tables<'crew_tool_lines'>, 'id' | 'crew_id' | 'name' | 'code' | 'serial' | 'held_qty' | 'note' | 'archived_at'> & {
  damaged_qty: number;
  lost_qty: number;
  usable_qty: number;
};

export interface ToolLineInput {
  crew_id: string;
  name: string;
  code: string | null;
  serial: string | null;
  held_qty: number;
  note: string | null;
}

export interface ToolReportRow {
  id: string;
  line_id: string;
  line_name: string;
  crew_id: string;
  kind: ToolReportKind;
  qty: number;
  note: string | null;
  status: 'open' | 'closed';
  resolution: ToolResolution | null;
  task_id: string | null;
  assignee_id: string | null;
  reported_by: string | null;
  reported_on: string;
  due_on: string;
}

export interface ToolPhotoRow {
  id: string;
  report_id: string;
  title: string | null;
  file_path: string;
}

export interface ToolSettings {
  coordinator_id: string | null;
  task_due_days: number;
}

export interface ReportToolInput {
  /** Generated before the call: the idempotency key and the photo path's report segment. */
  reportId: string;
  lineId: string;
  kind: ToolReportKind;
  qty: number;
  note: string | null;
  photos: File[];
}

/** The view computes every one of these for a live line; Postgres cannot prove its joins, so the generated columns are
 * nullable and this is the one place they are narrowed. */
const toLineRow = (r: Tables<'crew_tool_line_summary'>): ToolLineRow => ({
  id: r.id ?? '', crew_id: r.crew_id ?? '', name: r.name ?? '', code: r.code, serial: r.serial,
  held_qty: r.held_qty ?? 0, note: r.note, archived_at: r.archived_at,
  damaged_qty: r.damaged_qty ?? 0, lost_qty: r.lost_qty ?? 0, usable_qty: r.usable_qty ?? 0,
});

function fail(error: { message: string; code?: string; details?: string } | null): void {
  if (error) throw new AppError(error.message, error.code);
}

/** Live lines of one crew with held, damaged, lost and usable quantities (one indexed read, FR-CTR-004). */
export async function listToolLines(crewId: string): Promise<ToolLineRow[]> {
  const rows = await fetchAllRowsByKeyset<ToolLineRow>(async (afterId, limit) => {
    let q = supabase
      .from('crew_tool_line_summary')
      .select('id, crew_id, name, code, serial, held_qty, note, archived_at, damaged_qty, lost_qty, usable_qty')
      .eq('crew_id', crewId)
      .is('archived_at', null)
      .order('id', { ascending: true });
    if (afterId !== null) q = q.gt('id', afterId);
    const { data, error } = await q.limit(limit);
    return { data: data ? data.map(toLineRow) : null, error };
  });
  return rows.sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
}

/** ⚑ ONE string literal, not `'…' + '…'`: the typed client reads a `string`-typed select as unknown columns, and the
 * embeds below would then be untyped (which is how three result casts used to hide this module from the typechecker). */
const REPORT_COLUMNS = 'id, line_id, kind, qty, note, status, resolution, task_id, reported_by, reported_on, due_on, line:crew_tool_lines!crew_tool_reports_line_id_fkey!inner(name, crew_id), task:tasks!crew_tool_reports_task_id_fkey(assignee_id)';

/** The crew's open reports, oldest due first. */
export async function listOpenToolReports(crewId: string): Promise<ToolReportRow[]> {
  const rows = await fetchAllRowsByKeyset<ToolReportRow>(async (afterId, limit) => {
    let q = supabase
      .from('crew_tool_reports')
      .select(REPORT_COLUMNS)
      .eq('status', 'open')
      .eq('line.crew_id', crewId)
      .order('id', { ascending: true });
    if (afterId !== null) q = q.gt('id', afterId);
    const { data, error } = await q.limit(limit);
    return {
      data: data
        ? data.map((r): ToolReportRow => ({
          id: r.id, line_id: r.line_id, line_name: r.line.name, crew_id: r.line.crew_id, kind: r.kind as ToolReportKind,
          qty: r.qty, note: r.note, status: r.status as ToolReportRow['status'], resolution: r.resolution as ToolResolution | null,
          task_id: r.task_id, assignee_id: r.task?.assignee_id ?? null,
          reported_by: r.reported_by, reported_on: r.reported_on, due_on: r.due_on,
        }))
        : null,
      error,
    };
  });
  return rows.sort((a, b) => a.due_on.localeCompare(b.due_on) || a.id.localeCompare(b.id));
}

export async function listReportPhotos(reportId: string): Promise<ToolPhotoRow[]> {
  const rows = await fetchAllRowsByKeyset<ToolPhotoRow>(async (afterId, limit) => {
    let q = supabase
      .from('crew_tool_report_files')
      .select('id, report_id, title, file_path')
      .eq('report_id', reportId)
      .is('archived_at', null)
      .order('id', { ascending: true });
    if (afterId !== null) q = q.gt('id', afterId);
    return q.limit(limit);
  });
  return rows;
}

/** A short-lived link to a private photo (the bucket is not public). */
export async function toolPhotoUrl(path: string): Promise<string> {
  const { data, error } = await supabase.storage.from(CREW_TOOL_FILES_BUCKET).createSignedUrl(path, 300);
  if (error) throw toStorageAppError(error);
  return data.signedUrl;
}

export async function getToolSettings(): Promise<ToolSettings | null> {
  const { data, error } = await supabase.from('org_crew_tool_settings').select('coordinator_id, task_due_days').maybeSingle();
  fail(error);
  return (data as ToolSettings | null) ?? null;
}

export async function setToolSettings(coordinatorId: string | null, dueDays: number): Promise<void> {
  const { error } = await supabase.rpc('set_crew_tool_settings', { p_coordinator: coordinatorId, p_due_days: dueDays });
  fail(error);
}

export async function addToolLine(input: ToolLineInput): Promise<void> {
  const { error } = await supabase.from('crew_tool_lines').insert({ ...input });
  fail(error);
}

export async function updateToolLine(id: string, patch: Partial<ToolLineInput> & { archived_at?: string | null }): Promise<void> {
  const { error } = await supabase.from('crew_tool_lines').update(patch).eq('id', id);
  fail(error);
}

function safeName(name: string): string {
  return name.replace(/[^A-Za-z0-9._-]+/g, '_').slice(-80) || 'photo';
}

/**
 * Report a tool damaged or lost (FR-CTR-006..009). The photos are uploaded first to `{org}/{report}/{file}/{name}`
 * (the organisation prefix is read from the line under RLS, never typed by the client), then ONE call inserts the
 * report, its photo rows, the task and the notification. A retry with the same `reportId` returns the same report.
 */
export async function reportTool(input: ReportToolInput): Promise<string> {
  const { data: line, error: lineError } = await supabase.from('crew_tool_lines').select('org_id').eq('id', input.lineId).maybeSingle();
  fail(lineError);
  if (!line) throw new AppError('Tool line not found.', 'P0002');
  const orgId = (line as { org_id: string }).org_id;
  const photos: { path: string; title: string }[] = [];
  for (const file of input.photos) {
    const path = `${orgId}/${input.reportId}/${crypto.randomUUID()}/${safeName(file.name)}`;
    const { error: upError } = await supabase.storage.from(CREW_TOOL_FILES_BUCKET).upload(path, file, { upsert: false, contentType: file.type });
    if (upError) throw toStorageAppError(upError);
    photos.push({ path, title: file.name.slice(0, 200) });
  }
  const { data, error } = await supabase.rpc('report_crew_tool', {
    p_id: input.reportId, p_line: input.lineId, p_kind: input.kind, p_qty: input.qty, p_note: input.note, p_photos: photos,
  });
  fail(error);
  return data as string;
}

export async function correctToolReport(reportId: string, kind: ToolReportKind, qty: number, reason: string): Promise<void> {
  const { error } = await supabase.rpc('correct_crew_tool_report', { p_report: reportId, p_kind: kind, p_qty: qty, p_reason: reason });
  fail(error);
}

export async function closeToolReport(reportId: string, resolution: ToolResolution): Promise<void> {
  const { error } = await supabase.rpc('close_crew_tool_report', { p_report: reportId, p_resolution: resolution });
  fail(error);
}
