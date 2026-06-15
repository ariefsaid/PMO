import { supabase } from '@/src/lib/supabase/client';
import { AppError } from '@/src/lib/appError';
import type { Tables } from '@/src/lib/supabase/database.types';

export type CrmActivityRow = Tables<'crm_activities'>;
export type CrmActivityKind = CrmActivityRow['kind']; // 'Call' | 'Email' | 'Meeting' | 'Note'

/** The fields a "log activity" form supplies. org_id is NEVER sent — the BEFORE INSERT trigger
 *  stamps it from the parent contact. */
export interface CrmActivityInput {
  contact_id: string;
  kind: CrmActivityKind;
  subject: string | null;
  body: string | null;
  occurred_at: string; // ISO; defaults to now() at the form
  company_id: string | null;
  project_id: string | null;
}

interface PostgrestErrorLike {
  message: string;
  code?: string;
}

function throwWrite(error: PostgrestErrorLike): never {
  throw new AppError(error.message, error.code);
}

/**
 * List a contact's activities newest-first by occurred_at (AC-CRM-023). org_id is NEVER sent —
 * RLS (crm_activities_select: org_id = auth_org_id()) scopes rows. Throws an `AppError`
 * (code preserved) on failure.
 */
export async function listActivities(contactId: string): Promise<CrmActivityRow[]> {
  const { data, error } = await supabase
    .from('crm_activities')
    .select('*')
    .eq('contact_id', contactId)
    .order('occurred_at', { ascending: false });
  if (error) throwWrite(error);
  return data ?? [];
}

/**
 * Batch-fetch activities for N contacts in ONE query (C3 — replaces per-contact N+1 in
 * useCompanyActivities). Uses the crm_activities_contact_idx index for O(log n) per batch.
 * org_id is NEVER sent — RLS scopes rows. Returns rows merged and sorted newest-first by
 * occurred_at, matching the per-contact `listActivities` sort. Throws an `AppError` on failure.
 * When `contactIds` is empty, returns [] without hitting the DB.
 */
export async function listActivitiesForContacts(
  contactIds: string[],
): Promise<CrmActivityRow[]> {
  if (contactIds.length === 0) return [];
  const { data, error } = await supabase
    .from('crm_activities')
    .select('*')
    .in('contact_id', contactIds)
    .order('occurred_at', { ascending: false });
  if (error) throwWrite(error);
  return data ?? [];
}

/**
 * Create an activity on a contact (AC-CRM-023). org_id is NEVER sent — the BEFORE INSERT trigger
 * inherits it from the parent contact; the crm_activities_write WITH CHECK (role + parent-org
 * guard) is the authority. `logged_by_id` is stamped from the caller's profile id. Returns the
 * new row. Throws an `AppError` (code preserved, e.g. `42501`) on failure.
 */
export async function createActivity(
  input: CrmActivityInput,
  loggedById: string | null,
): Promise<CrmActivityRow> {
  const { data, error } = await supabase
    .from('crm_activities')
    .insert({
      contact_id: input.contact_id,
      kind: input.kind,
      subject: input.subject,
      body: input.body,
      occurred_at: input.occurred_at,
      company_id: input.company_id,
      project_id: input.project_id,
      logged_by_id: loggedById,
    })
    .select()
    .single();
  if (error) throwWrite(error);
  return data as CrmActivityRow;
}

export interface CrmActivityPatch {
  kind?: CrmActivityKind;
  subject?: string | null;
  body?: string | null;
  occurred_at?: string;
}

/**
 * Update an activity's editable fields (kind/subject/body/occurred_at).
 * org_id is never touched — RLS (crm_activities_write for ALL) enforces org-scope + role.
 * Throws an `AppError` (code preserved, e.g. `42501`) on failure.
 */
export async function updateActivity(id: string, patch: CrmActivityPatch): Promise<void> {
  const { error } = await supabase
    .from('crm_activities')
    .update(patch)
    .eq('id', id);
  if (error) throwWrite(error);
}

/**
 * Hard-delete an activity by id.
 * RLS (crm_activities_write for ALL with org + role guard) is the authority — the same
 * MASTER_DATA roles that can create can also delete (no SoD axis on activity deletion).
 * Throws an `AppError` (code preserved) on failure.
 */
export async function deleteActivity(id: string): Promise<void> {
  const { error } = await supabase
    .from('crm_activities')
    .delete()
    .eq('id', id);
  if (error) throwWrite(error);
}
