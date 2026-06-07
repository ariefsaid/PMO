import { supabase } from '@/src/lib/supabase/client';
import { AppError } from '@/src/lib/appError';
import type { Tables } from '@/src/lib/supabase/database.types';

export type CompanyRow = Tables<'companies'>;
export type CompanyType = CompanyRow['type'];

/** The fields a create/edit form supplies. org_id is NEVER among them — RLS stamps it. */
export interface CompanyInput {
  name: string;
  type: CompanyType;
}

/** Shape of a PostgREST/Postgres error we surface (only the fields we read). */
interface PostgrestErrorLike {
  message: string;
  code?: string;
}

/**
 * Throws an `AppError` preserving the verbatim message AND the Postgres error `code`
 * (e.g. `42501` RLS-rejected, `23503` foreign_key_violation on an in-use company delete,
 * `23505` duplicate) so the UI can classify the toast via `classifyMutationError`.
 */
function throwWrite(error: PostgrestErrorLike): never {
  throw new AppError(error.message, error.code);
}

/**
 * Client companies in the caller's org (for the client filter dropdown / FK picker). RLS scopes org.
 * Kept for the existing project/opportunity FK pickers (FR-DAL-005). Archived companies
 * (archived_at IS NOT NULL) are excluded so a soft-archived company can never be selected as the
 * client on a new project/opportunity (ADR-0018 soft-archive contract).
 */
export async function listClientCompanies(): Promise<CompanyRow[]> {
  const { data, error } = await supabase
    .from('companies')
    .select('*')
    .eq('type', 'Client')
    .is('archived_at', null);
  if (error) throw new Error(error.message);
  return data ?? [];
}

/**
 * List ALL companies in the caller's org for the Companies index (AC-CO-001). org_id is NEVER sent
 * — RLS (companies_select: org_id = auth_org_id()) scopes rows. Archived rows (archived_at IS NOT NULL)
 * are hidden by default; pass `type` to filter to one company_type (Internal / Client / Vendor).
 * Ordered by name for a stable, scannable list. Throws an `AppError` (code preserved) on failure.
 */
export async function listCompanies(params?: { type?: CompanyType }): Promise<CompanyRow[]> {
  let query = supabase.from('companies').select('*').is('archived_at', null);
  if (params?.type) query = query.eq('type', params.type);
  const { data, error } = await query.order('name');
  if (error) throwWrite(error);
  return data ?? [];
}

/**
 * Fetch a single company by id (AC-CO-002), or null when not found / not readable. org_id is NEVER
 * sent — RLS scopes the row. Throws an `AppError` (code preserved) on a genuine query error.
 */
export async function getCompany(id: string): Promise<CompanyRow | null> {
  const { data, error } = await supabase.from('companies').select('*').eq('id', id).maybeSingle();
  if (error) throwWrite(error);
  return data ?? null;
}

/**
 * Create a company (AC-CO-003). org_id is NEVER sent — the column default + the `companies_write`
 * WITH CHECK (org_id = auth_org_id() AND role in the 4 write-roles) are the authority. Returns the
 * new row. Throws an `AppError` (code preserved, e.g. `42501` when a non-write-role is denied) on failure.
 */
export async function createCompany(input: CompanyInput): Promise<CompanyRow> {
  const { data, error } = await supabase
    .from('companies')
    .insert({ name: input.name, type: input.type })
    .select()
    .single();
  if (error) throwWrite(error);
  return data as CompanyRow;
}

/**
 * Update a company's name + type by id (AC-CO-004). org_id is NEVER sent — RLS (companies_write)
 * scopes the update to the caller's org and gates the role. Throws an `AppError` (code preserved) on failure.
 */
export async function updateCompany(id: string, input: CompanyInput): Promise<void> {
  const { error } = await supabase
    .from('companies')
    .update({ name: input.name, type: input.type })
    .eq('id', id);
  if (error) throwWrite(error);
}

/**
 * Soft-archive a company by stamping `archived_at` (AC-CO-005) so it drops out of the default list.
 * org_id is NEVER sent — RLS scopes the update. Throws an `AppError` (code preserved) on failure.
 */
export async function archiveCompany(id: string): Promise<void> {
  const { error } = await supabase
    .from('companies')
    .update({ archived_at: new Date().toISOString() })
    .eq('id', id);
  if (error) throwWrite(error);
}

/**
 * Hard-delete a company by id (AC-CO-006). org_id is NEVER sent — RLS scopes the delete. A company
 * referenced by a profile / project / procurement cannot be deleted: the FK guard surfaces as a
 * Postgres `23503` foreign_key_violation, re-thrown as an `AppError` preserving that code so the UI
 * can show an "in use, archive instead" message. Throws an `AppError` (code preserved) on any failure.
 */
export async function deleteCompany(id: string): Promise<void> {
  const { error } = await supabase.from('companies').delete().eq('id', id);
  if (error) throwWrite(error);
}
