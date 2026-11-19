import { fetchAllPages } from '@/src/lib/pagedRead';
import { supabase } from '@/src/lib/supabase/client';
import { AppError, assertWriteLanded } from '@/src/lib/appError';
import type { Tables, TablesInsert, TablesUpdate } from '@/src/lib/supabase/database.types';
import { sanitizeFilename } from '@/src/lib/storageKey';
import { toStorageAppError } from '@/src/lib/storageError';

export type IncidentRow = Tables<'incident_reports'>;
export type IncidentSeverity = IncidentRow['severity']; // 'Low' | 'Medium' | 'High' | 'Critical'
export type IncidentStatus = IncidentRow['status']; // 'Open' | 'Investigating' | 'Closed'

/**
 * The fields a "File incident" form supplies. org_id, status and reported_by are NEVER
 * among them — RLS stamps org_id (companies_write-style WITH CHECK), the column default
 * sets status='Open', and reported_by is stamped server-side from auth.uid() by the
 * `incident_reports_stamp_reporter` BEFORE INSERT trigger (migration 0017 — the audit
 * authenticity fix; it was previously never populated).
 */
export interface IncidentInput {
  incident_date: string; // ISO date (yyyy-mm-dd)
  type: string;
  severity: IncidentSeverity;
  location?: string;
  description?: string;
  /**
   * Optional link to the project the incident relates to (deep-links to /projects/:id).
   * `null`/omitted leaves the incident unlinked. The DB same-org guard (migration 0043)
   * rejects a cross-org project_id (42501) — org_id itself is NEVER sent (RLS authority).
   */
  project_id?: string | null;
  /** Site-issue fields (#2521). All optional; the database re-checks each (work order of the project, active assignee, future due time). */
  work_order_id?: string | null;
  assignee_id?: string | null;
  action?: string;
  /** ISO timestamp the fix is due. */
  due_at?: string | null;
}

export type IncidentFileRow = Tables<'incident_files'>;
export type IncidentFileKind = 'at_raise' | 'at_close';
export const INCIDENT_FILES_BUCKET = 'incident-files';
export const INCIDENT_FILE_MAX_BYTES = 15 * 1024 * 1024;

/** Shape of a PostgREST/Postgres error we surface (only the fields we read). */
interface PostgrestErrorLike {
  message: string;
  code?: string;
}

/**
 * Throws an `AppError` preserving the verbatim message AND the Postgres error `code`
 * (e.g. `42501` RLS-rejected when a non-manager tries to update/close) so the UI can
 * classify the toast via `classifyMutationError`.
 */
function throwWrite(error: PostgrestErrorLike): never {
  throw new AppError(error.message, error.code);
}

/** Quote a user-typed term for a PostgREST `ilike`: `%`/`_` are LIKE metacharacters, `\\` escapes them, `"` ends the quoted value. */
const likeAny = (value: string) => `"%${value.replace(/[\\%_"]/g, '\\$&')}%"`;

/** The register's status filter + type/location search, shared by the page read and the full read. */
function withFilters<Q extends { eq: (c: string, v: string) => Q; or: (f: string) => Q; neq: (c: string, v: string) => Q; lt: (c: string, v: string) => Q }>(
  query: Q,
  params?: { status?: IncidentStatus; search?: string; overdue?: boolean },
): Q {
  if (params?.status) query = query.eq('status', params.status);
  // Overdue = not Closed and past its due time, computed here from due_at (FR-SIL-022), not from the escalation job.
  if (params?.overdue) query = query.neq('status', 'Closed').lt('due_at', new Date().toISOString());
  const term = params?.search?.trim();
  if (!term) return query;
  const pattern = likeAny(term);
  return query.or(`type.ilike.${pattern},location.ilike.${pattern}`);
}

/**
 * List incident reports in the caller's org for the Incidents index (AC-IN-001). org_id is
 * NEVER sent — RLS (incident_reports_select: org_id = auth_org_id()) scopes the rows. Pass
 * `status` to narrow to one workflow state (Open / Investigating / Closed). Ordered by
 * incident_date descending (newest first) for a stable, scannable register. Throws an
 * `AppError` (code preserved) on failure.
 */
export async function listIncidents(params?: { status?: IncidentStatus; search?: string; overdue?: boolean }): Promise<IncidentRow[]> {
  return fetchAllPages((from, to) => {
    const query = withFilters(supabase.from('incident_reports').select('*'), params);
    return query.order('incident_date', { ascending: false }).order('id', { ascending: true }).range(from, to);
  });
}

/** One server page of the Incidents register. 50 matches the other server-paged lists. */
export const INCIDENTS_PAGE_SIZE = 50;

/**
 * ONE server page of the register (#1991): the optional status filter and the type/location
 * search run on the SERVER before the range, so a match on page 7 is found and counted. Same
 * order as `listIncidents`, plus the `id` tiebreak that makes an OFFSET page total. `total` is the
 * exact count of the FILTERED set. org_id is NEVER sent — RLS scopes the rows. A page error, or an
 * unresolved total, throws (never an empty page). Callers needing the whole set use `listIncidents`.
 */
export async function listIncidentsPage(input: {
  page: number;
  pageSize: number;
  status?: IncidentStatus;
  search?: string;
  overdue?: boolean;
}): Promise<{ rows: IncidentRow[]; total: number }> {
  const from = Math.max(0, input.page - 1) * input.pageSize;
  const { data, error, count } = await withFilters(
    supabase.from('incident_reports').select('*', { count: 'exact' }),
    input,
  )
    .order('incident_date', { ascending: false })
    .order('id', { ascending: true })
    .range(from, from + input.pageSize - 1);
  if (error) throwWrite(error);
  if (count === null || count === undefined) {
    throw new AppError('The incidents total could not be resolved.', 'COUNT_UNRESOLVED');
  }
  return { rows: data ?? [], total: count };
}

/** Exact count of every incident RLS lets the caller read — a head request, no row bodies ("x of y" denominator). */
export async function countIncidents(): Promise<number> {
  const { count, error } = await supabase.from('incident_reports').select('id', { count: 'exact', head: true });
  if (error) throwWrite(error);
  if (count === null || count === undefined) {
    throw new AppError('The incidents total could not be resolved.', 'COUNT_UNRESOLVED');
  }
  return count;
}

/**
 * Fetch a single incident by id (AC-IN-002), or null when not found / not readable. org_id
 * is NEVER sent — RLS scopes the row. Throws an `AppError` (code preserved) on a genuine
 * query error.
 */
export async function getIncident(id: string): Promise<IncidentRow | null> {
  const { data, error } = await supabase
    .from('incident_reports')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (error) throwWrite(error);
  return data ?? null;
}

/**
 * File an incident (AC-IN-003) — available to ANY member. org_id is NEVER sent (the column
 * default + `incident_reports_insert` WITH CHECK org_id = auth_org_id() are the authority);
 * `status` is NOT sent (the column default 'Open' applies); `reported_by` is stamped
 * server-side from auth.uid() by the BEFORE INSERT trigger (never sent from the client).
 * Empty optional fields (location/description) are omitted so they persist as NULL rather
 * than ''. An optional `project_id` links the incident to a project (omitted when none is
 * chosen → NULL); the migration-0043 same-org guard rejects a cross-org project_id (42501).
 * Returns the new row. Throws an `AppError` (code preserved) on failure.
 */
export async function createIncident(input: IncidentInput): Promise<IncidentRow> {
  const insert: TablesInsert<'incident_reports'> = {
    incident_date: input.incident_date,
    type: input.type,
    severity: input.severity,
  };
  if (input.location?.trim()) insert.location = input.location.trim();
  if (input.description?.trim()) insert.description = input.description.trim();
  // Only sent when a project is chosen — omitting it leaves project_id NULL (unlinked).
  if (input.project_id) insert.project_id = input.project_id;
  if (input.work_order_id) insert.work_order_id = input.work_order_id;
  if (input.assignee_id) insert.assignee_id = input.assignee_id;
  if (input.action?.trim()) insert.action = input.action.trim();
  if (input.due_at) insert.due_at = input.due_at;

  const { data, error } = await supabase
    .from('incident_reports')
    .insert(insert)
    .select()
    .single();
  if (error) throwWrite(error);
  return data as IncidentRow;
}

/**
 * Update an incident's editable detail fields by id (AC-IN-004) — managers only (the
 * `incident_reports_update` USING role gate is the authority; the FE is stricter still).
 * `status` is NOT touched here (the workflow uses `transitionIncident`); org_id is NEVER
 * sent. Empty optional fields are written as NULL. Throws an `AppError` (code preserved) on failure.
 */
export async function updateIncident(id: string, input: IncidentInput): Promise<void> {
  const patch: TablesUpdate<'incident_reports'> = {
    incident_date: input.incident_date,
    type: input.type,
    severity: input.severity,
    location: input.location?.trim() || null,
    description: input.description?.trim() || null,
    // Written explicitly (NULL when cleared) so an edit can both set AND remove the project link.
    project_id: input.project_id ?? null,
    work_order_id: input.work_order_id ?? null,
    assignee_id: input.assignee_id ?? null,
    action: input.action?.trim() || null,
    due_at: input.due_at ?? null,
  };
  const { data, error } = await supabase
    .from('incident_reports')
    .update(patch)
    .eq('id', id)
    .select('id');
  if (error) throwWrite(error);
  assertWriteLanded(data, 'Incident not found or you do not have permission to edit it.');
}

/**
 * Advance an incident's workflow status (AC-IN-004): Open → Investigating → Closed. Sets
 * ONLY the `status` column by id; org_id is NEVER sent. The `incident_reports_update` RLS
 * policy (Admin/Exec/PM/Finance) is the enforcement authority — a non-manager attempt is
 * rejected as a `42501` `AppError` (#534: a `using` denial hides the row rather than erroring, so
 * this asserts `.select('id')` actually returned the row instead of trusting a null `error`).
 */
export async function transitionIncident(id: string, status: IncidentStatus, closeNote?: string): Promise<void> {
  const patch: TablesUpdate<'incident_reports'> = { status };
  // The close note rides with the closing write (closed_at / closed_by are the database's, never sent).
  if (status === 'Closed' && closeNote?.trim()) patch.close_note = closeNote.trim();
  const { data, error } = await supabase
    .from('incident_reports')
    .update(patch)
    .eq('id', id)
    .select('id');
  if (error) throwWrite(error);
  assertWriteLanded(data, 'Incident not found or you do not have permission to change its status.');
}

/**
 * Hard-delete an incident by id (AC-IN-005) — Admin only. The `incident_reports_delete_admin_only`
 * RLS policy (migration 0017: org_id = auth_org_id() AND auth_role() = 'Admin') is the server
 * authority; the FE gate is the clarity projection. A non-Admin delete now throws a `42501`
 * `AppError` (#534) instead of the silent 0-row no-op this docstring used to describe —
 * `.select('id')` proves the row actually went away.
 * org_id is NEVER sent — RLS scopes the delete. Throws an `AppError` (code preserved) on failure.
 */
export async function deleteIncident(id: string): Promise<void> {
  const { data, error } = await supabase.from('incident_reports').delete().eq('id', id).select('id');
  if (error) throwWrite(error);
  assertWriteLanded(data, 'Incident not found or you do not have permission to delete it.');
}

/** The live attachments of an issue, oldest first (RLS: anyone who reads the issue reads them). */
export async function listIncidentFiles(incidentId: string): Promise<IncidentFileRow[]> {
  const { data, error } = await supabase
    .from('incident_files')
    .select('*')
    .eq('incident_id', incidentId)
    .is('archived_at', null)
    .order('created_at', { ascending: true })
    .limit(50); // bounded: the database allows at most 10 live files per issue
  if (error) throwWrite(error);
  return data ?? [];
}

/**
 * Upload one photo/PDF for an issue: the object first ({org}/{incident}/{file_id}/{filename}), then the row that
 * records it. A failed row insert removes the object so nothing is left orphaned. The org segment comes from the
 * issue row (RLS-scoped), never from the client. The database caps a file at 15 MB, 10 live files per issue.
 */
export async function uploadIncidentFile(input: {
  incident: Pick<IncidentRow, 'id' | 'org_id'>;
  kind: IncidentFileKind;
  file: File;
}): Promise<IncidentFileRow> {
  const { incident, kind, file } = input;
  if (file.size > INCIDENT_FILE_MAX_BYTES) throw new AppError('A file can be at most 15 MB.', 'FILE_TOO_LARGE');
  const fileId = crypto.randomUUID();
  const path = `${incident.org_id}/${incident.id}/${fileId}/${sanitizeFilename(file.name)}`;
  const up = await supabase.storage.from(INCIDENT_FILES_BUCKET).upload(path, file, { contentType: file.type || undefined });
  if (up.error) throw toStorageAppError(up.error);
  const { data, error } = await supabase
    .from('incident_files')
    .insert({ id: fileId, incident_id: incident.id, kind, title: file.name, file_path: path })
    .select()
    .single();
  if (error) {
    await supabase.storage.from(INCIDENT_FILES_BUCKET).remove([path]);
    throwWrite(error);
  }
  return data as IncidentFileRow;
}

/** A short-lived signed URL to view one attachment. */
export async function getIncidentFileUrl(filePath: string): Promise<string> {
  const { data, error } = await supabase.storage.from(INCIDENT_FILES_BUCKET).createSignedUrl(filePath, 300);
  if (error) throw toStorageAppError(error);
  return data.signedUrl;
}

/** Make a task from an issue (managers; one task per issue, refused a second time with the existing task's id in `detail`). */
export async function createTaskFromIncident(incidentId: string): Promise<string> {
  const { data, error } = await supabase.rpc('create_task_from_incident', { p_incident: incidentId });
  if (error) throwWrite(error);
  return data as string;
}
