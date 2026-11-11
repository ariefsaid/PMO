import { supabase } from '@/src/lib/supabase/client';
import { fetchAllPages } from '@/src/lib/pagedRead';
import { AppError, assertWriteLanded, toAppError } from '@/src/lib/appError';
import { invokeWithTimeout } from '@/src/lib/supabase/invokeWithTimeout';
import type { Tables } from '@/src/lib/supabase/database.types';

/**
 * Administration › Users DAL (CRUD+RBAC program, plan §9.10). Reads + writes the
 * `profiles` table. The enforcement authority is the `profiles_admin_write` RLS policy
 * (migration 0002): only an Admin in the caller's org may UPDATE another profile's role
 * or manager_id. This module NEVER sends org_id — RLS (profiles_select / profiles_admin_write)
 * scopes the org. There is no migration: the role/manager write paths already exist server-side.
 */

export type UserRow = Tables<'profiles'>;
export type UserRole = UserRow['role'];

/** Shape of a PostgREST/Postgres error we surface (only the fields we read). */
interface PostgrestErrorLike {
  message: string;
  code?: string;
}

/**
 * Throws an `AppError` preserving the verbatim message AND the Postgres error `code`
 * (e.g. `42501` when `profiles_admin_write` denies a non-Admin) so the UI can classify
 * the toast via `classifyMutationError`.
 */
function throwWrite(error: PostgrestErrorLike): never {
  throw new AppError(error.message, error.code);
}

/**
 * List all profiles in the caller's org for the Administration › Users directory (AC-AU-001).
 * org_id is NEVER sent — RLS (profiles_select: org_id = auth_org_id()) scopes the rows.
 * Ordered by full_name for a stable, scannable directory. Throws an `AppError`
 * (code preserved) on failure.
 */
export async function listUsers(): Promise<UserRow[]> {
  // `id` tiebreak keeps the offset scan's order total (equal names would otherwise reorder across pages).
  return fetchAllPages<UserRow>((from, to) =>
    supabase.from('profiles').select('*').order('full_name').order('id').range(from, to),
  );
}

/**
 * The exact columns the Administration › Users DIRECTORY renders, searches, authorizes and
 * formats on — nothing else. It is deliberately NOT `select('*')`: the profile row carries
 * columns this page never reads (skills, title, location, utilization, locale, number_locale,
 * timezone, company_id, avatar data, timestamps), and the directory is a whole-org list.
 *
 * `manager` is the row's manager NAME resolved server-side. The hint is the FK COLUMN
 * (`!manager_id`), deliberately not the constraint name: PostgREST resolves a SELF-referencing
 * embed only by column hint — `profiles!profiles_manager_id_fkey(...)` answers
 * PGRST200 "no matches were found" and the whole directory read fails (verified against the local
 * API; the same holds for `tasks!tasks_parent_task_id_fkey`). With a server page the manager may
 * not be on the visible page, so the name must travel with the row — the previous same-list lookup
 * would silently render "No manager" for every manager past the page boundary.
 */
export const USER_DIRECTORY_COLUMNS =
  'id,full_name,email,role,status,org_id,manager_id,manager:profiles!manager_id(full_name)';

/** Why the projection is not `UserRow`: the directory never receives the columns it does not read. */
export interface UserDirectoryRow {
  id: string;
  full_name: string;
  email: string;
  role: UserRole;
  status: UserRow['status'];
  org_id: string;
  manager_id: string | null;
  manager: { full_name: string } | null;
}

export interface UserDirectoryPage {
  rows: UserDirectoryRow[];
  /** The exact count of rows matching the search, over the WHOLE org — never the page length. */
  total: number;
}

/** One server page of the users directory. 50 matches the established Odoo-directory page size. */
export const USER_DIRECTORY_PAGE_SIZE = 50;

/**
 * Escape a user-typed term for a quoted PostgREST `ilike` pattern: `%`/`_` are LIKE
 * metacharacters, `\` is the escape character they are escaped with, and `"` would terminate the
 * quoted value. Without this, a search for `100%` would match every row.
 */
function likeAny(value: string): string {
  return `"%${value.replace(/[\\%_"]/g, '\\$&')}%"`;
}

/**
 * ONE server page of the caller's org directory, with the exact total and a name/email search
 * applied on the SERVER *before* the range (so a match on page 7 is found and counted).
 *
 * Ordering is TOTAL: `full_name` then `id`. Equal names are common in a directory, and an
 * OFFSET page over a non-total order can repeat one person and skip another.
 *
 * org_id is NEVER sent — `profiles_select` RLS scopes the rows. Throws an `AppError` (code
 * preserved) on failure; a page error is never reported as an empty page.
 */
export async function listUsersPage(input: {
  page: number;
  pageSize: number;
  search?: string;
}): Promise<UserDirectoryPage> {
  const from = Math.max(0, input.page - 1) * input.pageSize;
  let query = supabase.from('profiles').select(USER_DIRECTORY_COLUMNS, { count: 'exact' });
  const term = input.search?.trim();
  if (term) {
    const pattern = likeAny(term);
    query = query.or(`full_name.ilike.${pattern},email.ilike.${pattern}`);
  }
  const { data, error, count } = await query
    .order('full_name')
    .order('id')
    .range(from, from + input.pageSize - 1);
  if (error) throw toAppError(error);
  // An absent exact count is the server failing to answer "how many people match". Converting it
  // to `0` would render a verified-looking "0 of 0" / empty directory over a set that may hold
  // rows, so the read is reported as unresolved — the page shows its error + retry instead.
  if (count === null || count === undefined) {
    throw new AppError('The users directory total could not be resolved.', 'COUNT_UNRESOLVED');
  }
  return { rows: (data ?? []) as unknown as UserDirectoryRow[], total: count };
}

/**
 * The manager picker's choice list: EVERY person in the caller's org, with only the three fields
 * the picker renders (identity, name, role label). It is deliberately NOT the whole profile row —
 * opening a picker must not download every column of the directory — and it is read lazily, only
 * while the change-manager dialog is open.
 *
 * Completeness: a picker must offer everyone, so the set is read across ALL pages (no silent
 * 1000-row cap that would quietly make people unassignable). Ordering is total (`full_name`, `id`).
 * org_id is never sent — `profiles_select` RLS scopes the rows.
 */
export const MANAGER_CHOICE_COLUMNS = 'id,full_name,role';

export interface UserManagerChoice {
  id: string;
  full_name: string;
  role: UserRole;
}

export async function listManagerChoices(): Promise<UserManagerChoice[]> {
  return fetchAllPages<UserManagerChoice>((from, to) =>
    supabase.from('profiles').select(MANAGER_CHOICE_COLUMNS).order('full_name').order('id').range(from, to),
  );
}

/**
 * Active Admins per org — the truth behind "the only active Admin cannot be disabled". A HEAD
 * `count` per org over the WHOLE org, so it stays correct when the directory shows one page and
 * when the row is not on the visible page at all (the old predicate inferred it from the full
 * loaded list, which a server page cannot provide).
 *
 * `org_id` IS sent here, deliberately: it NARROWS a count to the row's own org when an Operator
 * reads more than one org. RLS (`profiles_select`) remains the authority — the filter can only
 * ever exclude rows, never widen the caller's reach.
 *
 * A missing count is reported as `null` (UNRESOLVED), never as zero: "we could not read it" and
 * "there are no active Admins" must not be conflated. Throws on a read error.
 */
export async function countActiveAdminsByOrg(orgIds: readonly string[]): Promise<Record<string, number | null>> {
  const unique = [...new Set(orgIds.filter(Boolean))];
  const entries = await Promise.all(unique.map(async (orgId) => {
    const { count, error } = await supabase
      .from('profiles')
      .select('id', { count: 'exact', head: true })
      .eq('org_id', orgId)
      .eq('role', 'Admin')
      .eq('status', 'active');
    if (error) throw toAppError(error);
    return [orgId, count ?? null] as const;
  }));
  return Object.fromEntries(entries);
}

/** Where a person sits in the full_name/id directory order (for a bounded page jump to them). */
export interface UserFocusLocation {
  page: number;
  email: string;
  full_name: string;
}

/** Quote a PostgREST filter VALUE (names may contain `,` `.` `(` `)` or a quote). */
function quoteValue(value: string): string {
  return `"${value.replace(/[\\"]/g, '\\$&')}"`;
}

/**
 * Locate the page that holds ONE person, in the SAME total order the directory reads
 * (`full_name`, then `id`) and with no search applied — the "show me that manager" jump must find
 * them even when the current search would exclude them.
 *
 * Bounded: one exact-row read for the person, then ONE `HEAD` count of the rows that sort before
 * them. It never scans the directory and never reads a second page of rows to count them.
 */
export async function findUserPage(input: { userId: string; pageSize: number }): Promise<UserFocusLocation | null> {
  const { data, error } = await supabase
    .from('profiles')
    .select('id,full_name,email')
    .eq('id', input.userId)
    .maybeSingle();
  if (error) throw toAppError(error);
  if (!data) return null;
  const name = quoteValue(data.full_name as string);
  const before = `full_name.lt.${name},and(full_name.eq.${name},id.lt.${data.id})`;
  const { count, error: countError } = await supabase
    .from('profiles')
    .select('id', { count: 'exact', head: true })
    .or(before);
  if (countError) throw toAppError(countError);
  // An absent exact count is the server failing to answer "how many people sort before them".
  // Converting it to `0` would claim page one and announce the person as showing there, so the
  // position is reported as unresolved — the focus notice shows its error + retry instead.
  if (count === null || count === undefined) {
    throw new AppError('The position of the user in the directory could not be resolved.', 'COUNT_UNRESOLVED');
  }
  return {
    page: Math.floor(count / input.pageSize) + 1,
    email: data.email as string,
    full_name: data.full_name as string,
  };
}

/**
 * Change a user's role (AC-AU-003). High-impact: the call-site routes it through a confirm.
 * org_id is NEVER sent — `profiles_admin_write` (USING + WITH CHECK auth_role() = 'Admin')
 * is the authority; a non-Admin caller is rejected with `42501`, re-thrown as an `AppError`
 * preserving the code. Throws an `AppError` (code preserved) on any failure.
 */
export async function updateUserRole(id: string, role: UserRole): Promise<void> {
  const { data, error } = await supabase.from('profiles').update({ role }).eq('id', id).select('id');
  if (error) throwWrite(error);
  assertWriteLanded(data, 'User not found or you do not have permission to change their role.');
}

/**
 * Assign (or clear, with null) a user's line manager (AC-AU-004) for timesheet-approval
 * routing (FR-TS-007). org_id is NEVER sent — `profiles_admin_write` is the authority.
 * Throws an `AppError` (code preserved) on failure.
 */
export async function assignUserManager(id: string, managerId: string | null): Promise<void> {
  const { data, error } = await supabase
    .from('profiles')
    .update({ manager_id: managerId })
    .eq('id', id)
    .select('id');
  if (error) throwWrite(error);
  assertWriteLanded(data, 'User not found or you do not have permission to assign their manager.');
}

export interface InviteUserInput {
  email: string;
  role: UserRole;
  /** Operator-only: target a specific org (server-validated). Ignored for a non-Operator caller. */
  pOrgId?: string | null;
}

/**
 * Invite a new user (FR-INV-004/005, ops-admin-surface S4/S3). Calls the `admin-invite-user`
 * edge fn — issuance only (Supabase auth invite + profiles row insert). Authorization (Admin-
 * in-org OR Operator) is re-asserted server-side; the edge fn's error `code` (e.g.
 * `DUPLICATE_EMAIL`, `INVITE_UNAUTHORIZED`, `INVALID_ROLE`, `UNKNOWN_ORG`) is preserved on the
 * thrown `AppError` so the UI can classify it. org_id is NEVER client-decided for an org-Admin
 * (the edge fn pins it to the caller's own org); `pOrgId` is the Operator-only override.
 */
export async function inviteUser(input: InviteUserInput): Promise<void> {
  const { data, error } = await invokeWithTimeout(
    supabase.functions.invoke<{ error?: string }>('admin-invite-user', {
      body: { email: input.email, role: input.role, p_org_id: input.pOrgId ?? null },
    }),
  );
  if (error) {
    // FunctionsHttpError doesn't parse the JSON body — read our error code off the raw Response
    // when present (context is the Response for FunctionsHttpError), falling back to the
    // generic error message otherwise.
    const context = (error as { context?: Response }).context;
    let code: string | undefined;
    if (context && typeof context.clone === 'function') {
      try {
        const body = (await context.clone().json()) as { error?: string };
        code = body.error;
      } catch {
        // non-JSON body — fall through with no code.
      }
    }
    const message = (error as { message?: string } | null)?.message;
    throw new AppError(code ?? message ?? 'Invite failed', code);
  }
  if (data?.error) throw new AppError(data.error, data.error);
}

export interface SetUserStatusInput {
  id: string;
  status: 'active' | 'disabled';
  /** Re-validated server-side against the target's real org (admin_set_user_status RPC). */
  orgId: string;
}

/**
 * Disable or re-enable a user (AC-INV-003/004, ops-admin-surface S1/S4). Calls the
 * `admin_set_user_status` security-definer RPC — Admin-in-org OR Operator authority, with a
 * caller-agnostic sole-/self-Admin lockout guard (raises `P0001` "lockout", classified by
 * `classifyMutationError`). Throws an `AppError` (code preserved) on failure.
 */
export async function setUserStatus(input: SetUserStatusInput): Promise<void> {
  const { error } = await supabase.rpc('admin_set_user_status', {
    p_profile_id: input.id,
    p_status: input.status,
    p_org_id: input.orgId,
  });
  if (error) throwWrite(error);
}
