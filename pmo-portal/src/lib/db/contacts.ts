import { supabase } from '@/src/lib/supabase/client';
import { AppError, assertWriteLanded } from '@/src/lib/appError';
import { fetchAllRowsByKeyset, type PageResult } from '@/src/lib/pagedRead';
import type { Tables } from '@/src/lib/supabase/database.types';

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

/** One server page of the directory + the exact total matching the filter/search. */
export interface ContactDirectoryPage {
  rows: ContactRow[];
  /** The exact count of contacts matching the filter/search over the WHOLE org — never the page length. */
  total: number;
}

/**
 * Escape a user-typed term for a quoted PostgREST `ilike` pattern: `%`/`_` are LIKE
 * metacharacters, `\\` is the escape character they are escaped with, and `"` would terminate the
 * quoted value. Without this, a search for `100%` would match every row.
 */
function likeAny(value: string): string {
  return `"%${value.replace(/[\\%_"]/g, '\\$&')}%"`;
}

/**
 * ONE server page of the Contacts directory (issue #1989, the Master-data pattern): the company
 * filter and the name/email search are applied on the SERVER *before* the range (so a match on
 * page 7 is found and counted). Ordering is TOTAL: `full_name` then `id` — equal names are common
 * in a directory, and an OFFSET page over a non-total order can repeat one contact and skip
 * another. Archived rows are hidden. org_id is NEVER sent — RLS scopes the rows.
 *
 * A missing exact count is an ERROR (`COUNT_UNRESOLVED`), never `0`: a count the server failed to
 * answer must not render a verified-looking empty directory (the AdminUsers ruling).
 */
export async function listContactsPage(input: {
  page: number;
  pageSize: number;
  companyId?: string;
  search?: string;
}): Promise<ContactDirectoryPage> {
  const from = Math.max(0, input.page - 1) * input.pageSize;
  let query = supabase
    .from('contacts')
    .select('*', { count: 'exact' })
    .is('archived_at', null);
  if (input.companyId) query = query.eq('company_id', input.companyId);
  const term = input.search?.trim();
  if (term) {
    const pattern = likeAny(term);
    query = query.or(`full_name.ilike.${pattern},email.ilike.${pattern}`);
  }
  const { data, error, count } = await query
    .order('full_name')
    .order('id')
    .range(from, from + input.pageSize - 1);
  if (error) throwWrite(error);
  if (count === null || count === undefined) {
    throw new AppError('The contacts directory total could not be resolved.', 'COUNT_UNRESOLVED');
  }
  return { rows: (data ?? []) as ContactRow[], total: count };
}

/**
 * The exact number of non-archived contacts in the org — the "of Y" behind a filtered
 * "Showing X of Y" on the directory (#1989). A head count: `head: true` sends no body bytes.
 */
export async function countContacts(): Promise<number> {
  const { count, error } = await supabase
    .from('contacts')
    .select('id', { count: 'exact', head: true })
    .is('archived_at', null);
  if (error) throwWrite(error);
  return count ?? 0;
}

/**
 * List the caller's org non-archived contacts ordered by name (AC-CRM-020). org_id is NEVER
 * sent — RLS (contacts_select: org_id = auth_org_id()) scopes rows.
 *
 * #1989: an optional `companyId` and `search` narrow the set SERVER-side inside the keyset read,
 * so the full-set export matches exactly what the directory's server page shows for the same
 * filter/search.
 *
 * DAL01-005: reads EVERY keyset page (ordered by id — the only unique, total order) so the
 * directory, pickers and export stay complete past PostgREST's single-response cap; the
 * name-ordered contract is restored in memory. A page error throws (code preserved) — a partial
 * directory can never be mistaken for a complete one.
 */
export async function listContacts(params?: {
  companyId?: string;
  search?: string;
}): Promise<ContactRow[]> {
  const term = params?.search?.trim();
  const rows = await fetchAllRowsByKeyset<ContactRow>((afterId, limit) => {
    let query = supabase
      .from('contacts')
      .select('*')
      .is('archived_at', null)
      .order('id', { ascending: true })
      .limit(limit);
    if (params?.companyId) query = query.eq('company_id', params.companyId);
    if (term) {
      const pattern = likeAny(term);
      query = query.or(`full_name.ilike.${pattern},email.ilike.${pattern}`);
    }
    if (afterId !== null) query = query.gt('id', afterId);
    return query as unknown as PromiseLike<PageResult<ContactRow>>;
  });
  return rows.sort((a, b) => a.full_name.localeCompare(b.full_name));
}

/**
 * List a company's non-archived contacts (AC-CRM-021), ordered by name. org_id is NEVER sent —
 * RLS scopes the rows. DAL01-005: reads EVERY keyset page (ordered by id) so the company's
 * contact directory stays complete past PostgREST's single-response cap; the name-ordered
 * contract is restored in memory. Throws an `AppError` (code preserved) on failure.
 */
export async function listContactsByCompany(companyId: string): Promise<ContactRow[]> {
  const rows = await fetchAllRowsByKeyset<ContactRow>((afterId, limit) => {
    let query = supabase
      .from('contacts')
      .select('*')
      .eq('company_id', companyId)
      .is('archived_at', null)
      .order('id', { ascending: true })
      .limit(limit);
    if (afterId !== null) query = query.gt('id', afterId);
    return query as unknown as PromiseLike<PageResult<ContactRow>>;
  });
  return rows.sort((a, b) => a.full_name.localeCompare(b.full_name));
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
  const { data, error } = await supabase
    .from('contacts')
    .update({
      company_id: input.company_id,
      full_name: input.full_name,
      title: input.title,
      email: input.email,
      phone: input.phone,
      notes: input.notes,
    })
    .eq('id', id)
    .select('id');
  if (error) throwWrite(error);
  assertWriteLanded(data, 'Contact not found or you do not have permission to edit it.');
}

/**
 * Soft-archive a contact by stamping `archived_at` (AC-CRM-022) so it drops out of the default
 * list. org_id is NEVER sent — RLS scopes the update. Throws an `AppError` on failure.
 */
export async function archiveContact(id: string): Promise<void> {
  const { data, error } = await supabase
    .from('contacts')
    .update({ archived_at: new Date().toISOString() })
    .eq('id', id)
    .select('id');
  if (error) throwWrite(error);
  assertWriteLanded(data, 'Contact not found or you do not have permission to archive it.');
}

/**
 * Hard-delete a contact by id (AC-CRM-022). org_id is NEVER sent — RLS scopes the delete; the
 * RESTRICTIVE Admin-only DELETE policy is the authority. Deleting a contact cascades its
 * crm_activities. Throws an `AppError` (code preserved) on any failure.
 */
export async function deleteContact(id: string): Promise<void> {
  const { data, error } = await supabase.from('contacts').delete().eq('id', id).select('id');
  if (error) throwWrite(error);
  assertWriteLanded(data, 'Contact not found or you do not have permission to delete it.');
}
