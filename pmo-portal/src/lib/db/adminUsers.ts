import { supabase } from '@/src/lib/supabase/client';
import { AppError } from '@/src/lib/appError';
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
  const { data, error } = await supabase.from('profiles').select('*').order('full_name');
  if (error) throwWrite(error);
  return data ?? [];
}

/**
 * Change a user's role (AC-AU-003). High-impact: the call-site routes it through a confirm.
 * org_id is NEVER sent — `profiles_admin_write` (USING + WITH CHECK auth_role() = 'Admin')
 * is the authority; a non-Admin caller is rejected with `42501`, re-thrown as an `AppError`
 * preserving the code. Throws an `AppError` (code preserved) on any failure.
 */
export async function updateUserRole(id: string, role: UserRole): Promise<void> {
  const { error } = await supabase.from('profiles').update({ role }).eq('id', id);
  if (error) throwWrite(error);
}

/**
 * Assign (or clear, with null) a user's line manager (AC-AU-004) for timesheet-approval
 * routing (FR-TS-007). org_id is NEVER sent — `profiles_admin_write` is the authority.
 * Throws an `AppError` (code preserved) on failure.
 */
export async function assignUserManager(id: string, managerId: string | null): Promise<void> {
  const { error } = await supabase.from('profiles').update({ manager_id: managerId }).eq('id', id);
  if (error) throwWrite(error);
}
