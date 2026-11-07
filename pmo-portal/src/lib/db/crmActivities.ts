import { supabase } from '@/src/lib/supabase/client';
import { AppError, assertWriteLanded } from '@/src/lib/appError';
import { fetchAllRowsByKeyset, type PageResult } from '@/src/lib/pagedRead';
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
 * RLS (crm_activities_select: org_id = auth_org_id()) scopes rows.
 *
 * DAL01-005: reads EVERY keyset page (ordered by id — the only unique, total order) so a long
 * timeline stays complete past PostgREST's single-response cap; the newest-first contract is
 * restored in memory (occurred_at desc, id desc as the total tie-break). A page error throws
 * (code preserved) — a partial timeline can never be mistaken for a complete one.
 */
export async function listActivities(contactId: string): Promise<CrmActivityRow[]> {
  const rows = await fetchAllRowsByKeyset<CrmActivityRow>((afterId, limit) => {
    let query = supabase
      .from('crm_activities')
      .select('*')
      .eq('contact_id', contactId)
      .order('id', { ascending: true })
      .limit(limit);
    if (afterId !== null) query = query.gt('id', afterId);
    return query as unknown as PromiseLike<PageResult<CrmActivityRow>>;
  });
  return rows.sort(
    (a, b) => b.occurred_at.localeCompare(a.occurred_at) || b.id.localeCompare(a.id),
  );
}

/**
 * Batch-fetch activities for N contacts in ONE query (C3 — replaces per-contact N+1 in
 * useCompanyActivities). Uses the crm_activities_contact_idx index for O(log n) per batch.
 * org_id is NEVER sent — RLS scopes rows. Returns rows merged and sorted newest-first by
 * occurred_at (id desc tie-break), matching the per-contact `listActivities` sort.
 * DAL01-005: reads EVERY keyset page so a large timeline stays complete past PostgREST's
 * single-response cap. Throws an `AppError` on failure. When `contactIds` is empty, returns []
 * without hitting the DB.
 */
export async function listActivitiesForContacts(
  contactIds: string[],
): Promise<CrmActivityRow[]> {
  if (contactIds.length === 0) return [];
  const rows = await fetchAllRowsByKeyset<CrmActivityRow>((afterId, limit) => {
    let query = supabase
      .from('crm_activities')
      .select('*')
      .in('contact_id', contactIds)
      .order('id', { ascending: true })
      .limit(limit);
    if (afterId !== null) query = query.gt('id', afterId);
    return query as unknown as PromiseLike<PageResult<CrmActivityRow>>;
  });
  return rows.sort(
    (a, b) => b.occurred_at.localeCompare(a.occurred_at) || b.id.localeCompare(a.id),
  );
}

/** Activities per timeline page (#1990): the record pages show the newest page, "Show more" loads the next. */
export const ACTIVITY_PAGE_SIZE = 20;

/** Keyset cursor on the timeline's total order (occurred_at desc, id desc). */
export interface ActivityCursor {
  occurred_at: string;
  id: string;
}

export interface ActivityPage {
  rows: CrmActivityRow[];
  /** Null when nothing older exists. */
  nextCursor: ActivityCursor | null;
}

const selectActivities = () => supabase.from('crm_activities').select('*');
type ActivityQuery = ReturnType<typeof selectActivities>;

/**
 * One timeline page, newest-first (#1990). Keyset on (occurred_at desc, id desc) — a total
 * order, so a row logged mid-scroll can neither repeat nor skip a row. Asks for one extra row
 * to prove older activity exists, so the caller's "Show more" never dangles. org_id is NEVER
 * sent — RLS scopes rows. A read error throws (code preserved).
 */
async function readActivityPage(
  scope: (q: ActivityQuery) => ActivityQuery,
  cursor: ActivityCursor | null,
): Promise<ActivityPage> {
  let query = scope(selectActivities())
    .order('occurred_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(ACTIVITY_PAGE_SIZE + 1);
  if (cursor) {
    query = query.or(
      `occurred_at.lt.${cursor.occurred_at},and(occurred_at.eq.${cursor.occurred_at},id.lt.${cursor.id})`,
    );
  }
  const { data, error } = (await query) as unknown as PageResult<CrmActivityRow>;
  if (error) throw new AppError(error.message, error.code);
  const all = data ?? [];
  const rows = all.slice(0, ACTIVITY_PAGE_SIZE);
  const last = rows[rows.length - 1];
  return {
    rows,
    nextCursor: all.length > ACTIVITY_PAGE_SIZE ? { occurred_at: last.occurred_at, id: last.id } : null,
  };
}

/** One page of a contact's timeline (#1990), newest-first. */
export function listActivitiesPage(contactId: string, cursor: ActivityCursor | null): Promise<ActivityPage> {
  return readActivityPage((q) => q.eq('contact_id', contactId), cursor);
}

/** One page of the merged timeline for N contacts in ONE query (#1990), newest-first. */
export async function listActivitiesForContactsPage(
  contactIds: string[],
  cursor: ActivityCursor | null,
): Promise<ActivityPage> {
  if (contactIds.length === 0) return { rows: [], nextCursor: null };
  return readActivityPage((q) => q.in('contact_id', contactIds), cursor);
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
  const { data, error } = await supabase
    .from('crm_activities')
    .update(patch)
    .eq('id', id)
    .select('id');
  if (error) throwWrite(error);
  assertWriteLanded(data, 'Activity not found or you do not have permission to edit it.');
}

/**
 * Hard-delete an activity by id.
 * RLS (crm_activities_write for ALL with org + role guard) is the authority — the same
 * MASTER_DATA roles that can create can also delete (no SoD axis on activity deletion).
 * Throws an `AppError` (code preserved) on failure.
 */
export async function deleteActivity(id: string): Promise<void> {
  const { data, error } = await supabase
    .from('crm_activities')
    .delete()
    .eq('id', id)
    .select('id');
  if (error) throwWrite(error);
  assertWriteLanded(data, 'Activity not found or you do not have permission to delete it.');
}
