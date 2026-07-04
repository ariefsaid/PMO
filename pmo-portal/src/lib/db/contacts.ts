import { supabase } from '@/src/lib/supabase/client';
import { AppError } from '@/src/lib/appError';
import type { Tables } from '@/src/lib/supabase/database.types';
import { resolveRange, type PageParams } from '@/src/lib/pagination';

export type ContactRow = Tables<'contacts'>;

/** The fields a create/edit form supplies. org_id is NEVER among them — RLS stamps it. */
export interface ContactInput {
  company_id: string;
  full_name: string;
  title: string | null;
  email: string | null;
  phone: string | null;
  notes: string | null;
}

/** Shape of a PostgREST/Postgres error we surface (only the fields we read). */
interface PostgrestErrorLike {
  message: string;
  code?: string;
}

/**
 * Throws an `AppError` preserving the verbatim message AND the Postgres error `code`
 * (e.g. `42501` RLS-rejected) so the UI can classify the toast via `classifyMutationError`.
 */
function throwWrite(error: PostgrestErrorLike): never {
  throw new AppError(error.message, error.code);
}

/**
 * List the caller's org non-archived contacts ordered by name (AC-CRM-020). org_id is NEVER
 * sent — RLS (contacts_select: org_id = auth_org_id()) scopes rows. Throws an `AppError`
 * (code preserved) on failure.
 *
 * Paginated (data-layer performance hardening #4, OPT-IN): passing `params.page`/
 * `params.pageSize` range-bounds the query; omitting both preserves the original unbounded
 * read for every existing caller (e.g. the ⌘K CommandPalette record search).
 */
export async function listContacts(params?: PageParams): Promise<ContactRow[]> {
  const range = resolveRange(params);
  let query = supabase
    .from('contacts')
    .select('*')
    .is('archived_at', null)
    .order('full_name');
  if (range) query = query.range(range.from, range.to);
  const { data, error } = await query;
  if (error) throwWrite(error);
  return data ?? [];
}

/**
 * List a company's non-archived contacts (AC-CRM-021), ordered by name. org_id is NEVER sent —
 * RLS scopes the rows. Throws an `AppError` (code preserved) on failure.
 */
export async function listContactsByCompany(companyId: string): Promise<ContactRow[]> {
  const { data, error } = await supabase
    .from('contacts')
    .select('*')
    .eq('company_id', companyId)
    .is('archived_at', null)
    .order('full_name');
  if (error) throwWrite(error);
  return data ?? [];
}

/**
 * Fetch a single contact by id (AC-CRM-022), or null when not found / not readable. org_id is
 * NEVER sent — RLS scopes the row. Throws an `AppError` (code preserved) on a genuine query error.
 */
export async function getContact(id: string): Promise<ContactRow | null> {
  const { data, error } = await supabase.from('contacts').select('*').eq('id', id).maybeSingle();
  if (error) throwWrite(error);
  return data ?? null;
}

/**
 * Create a contact (AC-CRM-022). org_id is NEVER sent — the column default + the contacts_write
 * WITH CHECK (org_id = auth_org_id() AND role in the 4 write-roles AND parent company in-org) are
 * the authority. Returns the new row. Throws an `AppError` (code preserved, e.g. `42501`) on failure.
 */
export async function createContact(input: ContactInput): Promise<ContactRow> {
  const { data, error } = await supabase
    .from('contacts')
    .insert({
      company_id: input.company_id,
      full_name: input.full_name,
      title: input.title,
      email: input.email,
      phone: input.phone,
      notes: input.notes,
    })
    .select()
    .single();
  if (error) throwWrite(error);
  return data as ContactRow;
}

/**
 * Update a contact's fields by id (AC-CRM-022). org_id is NEVER sent — RLS (contacts_write)
 * scopes the update to the caller's org and gates the role. Throws an `AppError` on failure.
 */
export async function updateContact(id: string, input: ContactInput): Promise<void> {
  const { error } = await supabase
    .from('contacts')
    .update({
      company_id: input.company_id,
      full_name: input.full_name,
      title: input.title,
      email: input.email,
      phone: input.phone,
      notes: input.notes,
    })
    .eq('id', id);
  if (error) throwWrite(error);
}

/**
 * Soft-archive a contact by stamping `archived_at` (AC-CRM-022) so it drops out of the default
 * list. org_id is NEVER sent — RLS scopes the update. Throws an `AppError` on failure.
 */
export async function archiveContact(id: string): Promise<void> {
  const { error } = await supabase
    .from('contacts')
    .update({ archived_at: new Date().toISOString() })
    .eq('id', id);
  if (error) throwWrite(error);
}

/**
 * Hard-delete a contact by id (AC-CRM-022). org_id is NEVER sent — RLS scopes the delete; the
 * RESTRICTIVE Admin-only DELETE policy is the authority. Deleting a contact cascades its
 * crm_activities. Throws an `AppError` (code preserved) on any failure.
 */
export async function deleteContact(id: string): Promise<void> {
  const { error } = await supabase.from('contacts').delete().eq('id', id);
  if (error) throwWrite(error);
}
