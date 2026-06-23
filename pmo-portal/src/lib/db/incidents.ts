import { supabase } from '@/src/lib/supabase/client';
import { AppError } from '@/src/lib/appError';
import type { Tables, TablesInsert, TablesUpdate } from '@/src/lib/supabase/database.types';

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
}

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

/**
 * List incident reports in the caller's org for the Incidents index (AC-IN-001). org_id is
 * NEVER sent — RLS (incident_reports_select: org_id = auth_org_id()) scopes the rows. Pass
 * `status` to narrow to one workflow state (Open / Investigating / Closed). Ordered by
 * incident_date descending (newest first) for a stable, scannable register. Throws an
 * `AppError` (code preserved) on failure.
 */
export async function listIncidents(params?: { status?: IncidentStatus }): Promise<IncidentRow[]> {
  let query = supabase.from('incident_reports').select('*');
  if (params?.status) query = query.eq('status', params.status);
  const { data, error } = await query.order('incident_date', { ascending: false });
  if (error) throwWrite(error);
  return data ?? [];
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
  };
  const { error } = await supabase.from('incident_reports').update(patch).eq('id', id);
  if (error) throwWrite(error);
}

/**
 * Advance an incident's workflow status (AC-IN-004): Open → Investigating → Closed. Sets
 * ONLY the `status` column by id; org_id is NEVER sent. The `incident_reports_update` RLS
 * policy (Admin/Exec/PM/Finance) is the enforcement authority — a non-manager attempt is
 * rejected (42501) or hidden (no-op). Throws an `AppError` (code preserved) on failure.
 */
export async function transitionIncident(id: string, status: IncidentStatus): Promise<void> {
  const { error } = await supabase.from('incident_reports').update({ status }).eq('id', id);
  if (error) throwWrite(error);
}

/**
 * Hard-delete an incident by id (AC-IN-005) — Admin only. The `incident_reports_delete_admin_only`
 * RLS policy (migration 0017: org_id = auth_org_id() AND auth_role() = 'Admin') is the server
 * authority; the FE gate is the clarity projection. A non-Admin delete is a silent 0-row no-op.
 * org_id is NEVER sent — RLS scopes the delete. Throws an `AppError` (code preserved) on failure.
 */
export async function deleteIncident(id: string): Promise<void> {
  const { error } = await supabase.from('incident_reports').delete().eq('id', id);
  if (error) throwWrite(error);
}
