import { supabase } from '@/src/lib/supabase/client';
import { AppError, assertWriteLanded } from '@/src/lib/appError';
import { fetchAllRowsByKeyset, type PageResult } from '@/src/lib/pagedRead';
import type { Tables } from '@/src/lib/supabase/database.types';
import { BY_IDS_CHUNK } from './opportunity';
import type { VendorTaxDefaultsInput } from '@/src/lib/vendorWithholding';

export type CompanyRow = Tables<'companies'>;
export type CompanyType = CompanyRow['type'];

/** The fields a create/edit form supplies. org_id is NEVER among them — RLS stamps it. */
export interface CompanyInput {
  name: string;
  type: CompanyType;
  short_name?: string | null;
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
 * The exact columns the Companies DIRECTORY renders, searches, exports and edits on — nothing
 * else (#1989, the Master-data/AdminUsers pattern). It is deliberately NOT `select('*')`: the
 * company row carries columns the directory never reads (org_id, ERP anchors, tax defaults,
 * timestamps), and the directory is a whole-org list — the wide row WAS its response cost.
 */
export type CompanyListRow = Pick<
  CompanyRow,
  'id' | 'name' | 'short_name' | 'type' | 'client_number_segment'
>;

export const COMPANY_LIST_COLUMNS = 'id,name,short_name,type,client_number_segment';

/** The directory's display row for pickers/exports that must offer EVERY company. */
export type CompanyOptionRow = Pick<CompanyRow, 'id' | 'name' | 'short_name'>;

/** One server page of the directory + the exact total matching the filter/search. */
export interface CompanyDirectoryPage {
  rows: CompanyListRow[];
  /** The exact count of companies matching the filter/search over the WHOLE org — never the page length. */
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
 * ONE server page of the Companies directory (issue #1989, the Master-data pattern): the type
 * filter and the name/short-name search are applied on the SERVER *before* the range (so a match
 * on page 7 is found and counted). Ordering is TOTAL: `name` then `id` — equal names are common
 * in a directory, and an OFFSET page over a non-total order can repeat one company and skip
 * another. Archived rows are hidden. org_id is NEVER sent — RLS scopes the rows.
 *
 * A missing exact count is an ERROR (`COUNT_UNRESOLVED`), never `0`: a count the server failed to
 * answer must not render a verified-looking empty directory (the AdminUsers ruling).
 */
export async function listCompaniesPage(input: {
  page: number;
  pageSize: number;
  type?: CompanyType;
  search?: string;
}): Promise<CompanyDirectoryPage> {
  const from = Math.max(0, input.page - 1) * input.pageSize;
  const term = input.search?.trim();
  const pattern = term ? likeAny(term) : null;
  const filtered = <Q extends { eq: (c: string, v: string) => Q; or: (f: string) => Q }>(q: Q): Q => {
    if (input.type) q = q.eq('type', input.type);
    return pattern ? q.or(`name.ilike.${pattern},short_name.ilike.${pattern}`) : q;
  };
  const { data, error, count } = await filtered(
    supabase.from('companies').select(COMPANY_LIST_COLUMNS, { count: 'exact' }).is('archived_at', null),
  )
    .order('name')
    .order('id')
    .range(from, from + input.pageSize - 1);
  // An OFFSET past the last page (rows archived since the pager was drawn) is answered 416 /
  // PGRST103: that is an EMPTY page over the real total, so the pager can correct down — not an error.
  if (error?.code === 'PGRST103') {
    const head = await filtered(
      supabase.from('companies').select('id', { count: 'exact', head: true }).is('archived_at', null),
    );
    if (head.error) throwWrite(head.error);
    return { rows: [], total: head.count ?? 0 };
  }
  if (error) throwWrite(error);
  if (count === null || count === undefined) {
    throw new AppError('The companies directory total could not be resolved.', 'COUNT_UNRESOLVED');
  }
  return { rows: (data ?? []) as CompanyListRow[], total: count };
}

/**
 * The exact number of non-archived companies in the org — the "of Y" behind a filtered
 * "Showing X of Y" on the directory (#1989). A head count: `head: true` sends no body bytes.
 */
export async function countCompanies(): Promise<number> {
  const { count, error } = await supabase
    .from('companies')
    .select('id', { count: 'exact', head: true })
    .is('archived_at', null);
  if (error) throwWrite(error);
  return count ?? 0;
}

/**
 * EVERY non-archived company as a display row (id + name fields only) — the Contacts page's
 * filter options, export names and create/edit select (#1989). A picker must offer everyone,
 * not one page (the AdminUsers ruling), so this traverses EVERY keyset page like `listCompanies`
 * and restores the name-ordered contract in memory over the complete set. The narrow projection
 * keeps the whole-directory picker read at a fraction of the wide row's size.
 */
export async function listCompanyOptions(): Promise<CompanyOptionRow[]> {
  const rows = await fetchAllRowsByKeyset<CompanyOptionRow>((afterId, limit) => {
    let query = supabase
      .from('companies')
      .select('id,name,short_name')
      .is('archived_at', null)
      .order('id', { ascending: true })
      .limit(limit);
    if (afterId !== null) query = query.gt('id', afterId);
    return query as unknown as PromiseLike<PageResult<CompanyOptionRow>>;
  });
  return rows.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Client companies in the caller's org (for the client filter dropdown / FK picker). RLS scopes org.
 * Kept for the existing project/opportunity FK pickers (FR-DAL-005). Archived companies
 * (archived_at IS NOT NULL) are excluded so a soft-archived company can never be selected as the
 * client on a new project/opportunity (ADR-0018 soft-archive contract).
 *
 * DAL01-005: reads EVERY keyset page (ordered by id — the only unique, total order) so a directory
 * past PostgREST's single-response cap cannot silently omit records; the name-ordered contract is
 * restored in memory. A page error throws (code preserved) — a partial directory can never be
 * mistaken for a complete one.
 */
export async function listClientCompanies(): Promise<CompanyRow[]> {
  const rows = await fetchAllRowsByKeyset<CompanyRow>((afterId, limit) => {
    let query = supabase
      .from('companies')
      .select('*')
      .eq('type', 'Client')
      .is('archived_at', null)
      .order('id', { ascending: true })
      .limit(limit);
    if (afterId !== null) query = query.gt('id', afterId);
    return query as unknown as PromiseLike<PageResult<CompanyRow>>;
  });
  return rows.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * List ALL companies in the caller's org for the Companies index (AC-CO-001). org_id is NEVER sent
 * — RLS (companies_select: org_id = auth_org_id()) scopes rows. Archived rows (archived_at IS NOT NULL)
 * are hidden by default; pass `type` to filter to one company_type (Internal / Client / Vendor).
 *
 * DAL01-005: reads EVERY keyset page (ordered by id) so the index, FK pickers and export see the
 * complete directory even past PostgREST's single-response cap; the name-ordered contract is
 * restored in memory. Throws an `AppError` (code preserved) on failure — never a partial set.
 */
export async function listCompanies(
  params?: { type?: CompanyType; search?: string },
): Promise<CompanyRow[]> {
  // The search is applied SERVER-side inside the keyset read (#1989) so the full-set export
  // matches exactly what the directory's server page shows for the same filter/search.
  const term = params?.search?.trim();
  const rows = await fetchAllRowsByKeyset<CompanyRow>((afterId, limit) => {
    let query = supabase.from('companies').select('*').is('archived_at', null).order('id', { ascending: true }).limit(limit);
    if (params?.type) query = query.eq('type', params.type);
    if (term) {
      const pattern = likeAny(term);
      query = query.or(`name.ilike.${pattern},short_name.ilike.${pattern}`);
    }
    if (afterId !== null) query = query.gt('id', afterId);
    return query as unknown as PromiseLike<PageResult<CompanyRow>>;
  });
  return rows.sort((a, b) => a.name.localeCompare(b.name));
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

/** Companies readable by the caller among `ids`; inaccessible ids are simply absent. Reads in chunks. */
export async function getCompaniesByIds(ids: readonly string[]): Promise<CompanyRow[]> {
  const unique = [...new Set(ids)];
  const out: CompanyRow[] = [];
  for (let i = 0; i < unique.length; i += BY_IDS_CHUNK) {
    const { data, error } = await supabase.from('companies').select('*').in('id', unique.slice(i, i + BY_IDS_CHUNK));
    if (error) throwWrite(error);
    out.push(...(data ?? []));
  }
  return out;
}

/**
 * Create a company (AC-CO-003). org_id is NEVER sent — the column default + the `companies_write`
 * WITH CHECK (org_id = auth_org_id() AND role in the 4 write-roles) are the authority. Returns the
 * new row. Throws an `AppError` (code preserved, e.g. `42501` when a non-write-role is denied) on failure.
 */
export async function createCompany(input: CompanyInput): Promise<CompanyRow> {
  const { data, error } = await supabase
    .from('companies')
    .insert({ name: input.name, type: input.type, ...(input.short_name !== undefined ? { short_name: input.short_name?.trim() || null } : {}) })
    .select()
    .single();
  if (error) throwWrite(error);
  return data as CompanyRow;
}

/**
 * Update a company's legal name, type, and optional PMO short name by id (AC-CO-004). org_id is NEVER sent — RLS (companies_write)
 * scopes the update to the caller's org and gates the role. Throws an `AppError` (code preserved) on failure.
 */
export async function updateCompany(id: string, input: CompanyInput): Promise<void> {
  const { data, error } = await supabase
    .from('companies')
    .update({ name: input.name, type: input.type, ...(input.short_name !== undefined ? { short_name: input.short_name?.trim() || null } : {}) })
    .eq('id', id)
    .select('id');
  if (error) throwWrite(error);
  assertWriteLanded(data, 'Company not found or you do not have permission to edit it.');
}

/**
 * Soft-archive a company by stamping `archived_at` (AC-CO-005) so it drops out of the default list.
 * org_id is NEVER sent — RLS scopes the update. Throws an `AppError` (code preserved) on failure.
 */
/** Update only the PMO-local project-number segment, never the ERP-native company payload. */
export async function setCompanyProjectNumberSegment(id: string, segment: string | null): Promise<void> {
  const { data, error } = await supabase
    .from('companies')
    .update({ client_number_segment: segment?.trim() || null })
    .eq('id', id)
    .select('id');
  if (error) throwWrite(error);
  assertWriteLanded(data, 'Company not found or you do not have permission to edit it.');
}

export async function archiveCompany(id: string): Promise<void> {
  const { data, error } = await supabase
    .from('companies')
    .update({ archived_at: new Date().toISOString() })
    .eq('id', id)
    .select('id');
  if (error) throwWrite(error);
  assertWriteLanded(data, 'Company not found or you do not have permission to archive it.');
}

/**
 * Hard-delete a company by id (AC-CO-006). org_id is NEVER sent — RLS scopes the delete. A company
 * referenced by a profile / project / procurement cannot be deleted: the FK guard surfaces as a
 * Postgres `23503` foreign_key_violation, re-thrown as an `AppError` preserving that code so the UI
 * can show an "in use, archive instead" message. Throws an `AppError` (code preserved) on any failure.
 */
export async function deleteCompany(id: string): Promise<void> {
  const { data, error } = await supabase.from('companies').delete().eq('id', id).select('id');
  if (error) throwWrite(error);
  assertWriteLanded(data, 'Company not found or you do not have permission to delete it.');
}

/** PMO enhancement only: the native-field guard and RLS remain the write authority. */
export async function updateCompanyShortName(id: string, shortName: string | null): Promise<void> {
  const { data, error } = await supabase.from('companies')
    .update({ short_name: shortName?.trim() || null }).eq('id', id).select('id');
  if (error) throwWrite(error);
  assertWriteLanded(data, 'Company not found or you do not have permission to edit it.');
}

/**
 * #876 slice 2 (DD-VWH-11): set a vendor's default tax treatment through `set_vendor_tax_defaults` (0273) — the only
 * client path past the companies guard trigger. A null value is not sent, so the RPC's own `default null` clears it.
 */
export async function setCompanyTaxDefaults(id: string, input: VendorTaxDefaultsInput): Promise<void> {
  const { error } = await supabase.rpc('set_vendor_tax_defaults', {
    p_company_id: id,
    p_vat_rate: input.vatRate ?? undefined,
    p_pph_type: input.pphType ?? undefined,
    p_pph_rate: input.pphRate ?? undefined,
  });
  if (error) throwWrite(error);
}
