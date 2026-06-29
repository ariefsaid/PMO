import { supabase } from '@/src/lib/supabase/client';
import { AppError } from '@/src/lib/appError';
import type { Tables } from '@/src/lib/supabase/database.types';

export type UserViewRow = Tables<'user_views'>;
export type UserViewScope = UserViewRow['scope'];

/**
 * The fields a create/edit form supplies for a saved view (Issue I1, ADR-0036 §6).
 * org_id and user_id are NEVER among them — RLS stamps them server-side (the column
 * defaults + WITH CHECK pin org_id = auth_org_id() and user_id = auth.uid()). The `spec`
 * is treated as opaque JSON (FR-UV-004): stored and returned verbatim, never parsed here.
 */
export interface UserViewInput {
  name: string;
  description?: string | null;
  spec: UserViewRow['spec'];
  scope?: string;
}

/** Shape of a PostgREST/Postgres error we surface (only the fields we read). */
interface PostgrestErrorLike {
  message: string;
  code?: string;
}

/**
 * Throws an `AppError` preserving the verbatim message AND the Postgres error `code`
 * (e.g. `42501` RLS-rejected on a spoofed cross-org/owner insert) so the UI can classify
 * the toast via `classifyMutationError` (ADR-0017 seam contract).
 */
function throwWrite(error: PostgrestErrorLike): never {
  throw new AppError(error.message, error.code);
}

/**
 * List the caller's non-archived (`archived_at is null`) visible views, newest write first
 * (AC-UV-007, FR-UV-009). org_id/user_id are NEVER sent — RLS (user_views_select: owner OR
 * shared_org-in-org) scopes the rows. Throws an `AppError` (code preserved) on failure.
 */
export async function listUserViews(): Promise<UserViewRow[]> {
  const { data, error } = await supabase
    .from('user_views')
    .select('*')
    .is('archived_at', null)
    .order('updated_at', { ascending: false });
  if (error) throwWrite(error);
  return data ?? [];
}

/**
 * Fetch a single view by id (FR-UV-010), or null when not found / not readable (RLS-scoped out).
 * org_id/user_id are NEVER sent. Throws an `AppError` (code preserved) on a genuine query error.
 */
export async function getUserView(id: string): Promise<UserViewRow | null> {
  const { data, error } = await supabase
    .from('user_views')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (error) throwWrite(error);
  return data ?? null;
}

/**
 * Create a view (FR-UV-010). org_id + user_id are NEVER sent — the column defaults + the
 * user_views_insert WITH CHECK (org_id = auth_org_id() AND user_id = auth.uid()) are the
 * authority. The payload object is built explicitly (no spread) so neither can ever leak.
 * `spec` is stored opaquely (FR-UV-004). Returns the new row. Throws an `AppError`
 * (code preserved, e.g. `42501` on a denied/spoofed insert) on failure.
 */
export async function createUserView(input: UserViewInput): Promise<UserViewRow> {
  const { data, error } = await supabase
    .from('user_views')
    .insert({
      name: input.name,
      description: input.description ?? null,
      spec: input.spec,
      scope: input.scope,
    })
    .select()
    .single();
  if (error) throwWrite(error);
  return data as UserViewRow;
}

/**
 * Update a view's editable fields by id (FR-UV-010). org_id/user_id are NEVER sent — RLS
 * (user_views_update: owner OR Admin, org-scoped) is the authority. `updated_at` is bumped
 * explicitly here (OQ-2: no DB trigger exists in the schema). Throws an `AppError`
 * (code preserved) on failure.
 */
export async function updateUserView(id: string, input: UserViewInput): Promise<void> {
  const { error } = await supabase
    .from('user_views')
    .update({
      name: input.name,
      description: input.description ?? null,
      spec: input.spec,
      scope: input.scope,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id);
  if (error) throwWrite(error);
}

/**
 * Soft-archive a view by stamping `archived_at` (FR-UV-010, ADR-0018) so it drops out of the
 * default list. `updated_at` is bumped alongside (OQ-2). org_id/user_id are NEVER sent — RLS
 * scopes the update. Throws an `AppError` (code preserved) on failure.
 */
export async function archiveUserView(id: string): Promise<void> {
  const now = new Date().toISOString();
  const { error } = await supabase
    .from('user_views')
    .update({ archived_at: now, updated_at: now })
    .eq('id', id);
  if (error) throwWrite(error);
}

/**
 * Hard-delete a view by id (FR-UV-010; owner/Admin at the RLS layer, OD-3). org_id/user_id are
 * NEVER sent — RLS (user_views_delete) scopes the delete. Throws an `AppError` (code preserved)
 * on failure.
 */
export async function deleteUserView(id: string): Promise<void> {
  const { error } = await supabase.from('user_views').delete().eq('id', id);
  if (error) throwWrite(error);
}
