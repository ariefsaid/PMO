import { supabase } from '@/src/lib/supabase/client';
import { AppError } from '@/src/lib/appError';
import type { Tables } from '@/src/lib/supabase/database.types';
import { resolveRange, type PageParams } from '@/src/lib/pagination';

export type NotificationRow = Tables<'notifications'>;

/** Shape of a PostgREST/Postgres error we surface (only the fields we read). */
interface PostgrestErrorLike {
  message: string;
  code?: string;
}

function throwWrite(error: PostgrestErrorLike): never {
  throw new AppError(error.message, error.code);
}

/**
 * List the caller's own notifications, most recent first (FR-AAN-035, AC-AAN-033).
 * org_id/owner_id are NEVER sent — owner-only RLS scopes the rows entirely; a caller never
 * receives another user's notification. Throws an `AppError` (code preserved) on a genuine
 * query error.
 *
 * Paginated (data-layer performance hardening #4, OPT-IN): passing `params.page`/
 * `params.pageSize` range-bounds the query; omitting both preserves the original unbounded
 * read for every existing caller.
 */
export async function listNotifications(params?: PageParams): Promise<NotificationRow[]> {
  const range = resolveRange(params);
  let query = supabase
    .from('notifications')
    .select('*')
    .order('created_at', { ascending: false });
  if (range) query = query.range(range.from, range.to);
  const { data, error } = await query;
  if (error) throwWrite(error);
  return data ?? [];
}

/**
 * Count the caller's own unread notifications (FR-AAN-034, NFR-AAN-PERF-002) via the
 * count:'exact', head:true fast path — a single index-only scan against
 * `notifications_owner_unread_idx` (owner_id) where read_at is null, no row payload transferred.
 */
export async function listUnreadCount(): Promise<number> {
  const { count, error } = await supabase
    .from('notifications')
    .select('*', { count: 'exact', head: true })
    .is('read_at', null);
  if (error) throwWrite(error);
  return count ?? 0;
}

/**
 * Mark a notification read (FR-AAN-036, AC-AAN-013/034) — the single narrow mark-read UPDATE.
 * Sends ONLY `read_at`; the mark-read-only trigger (0048_agent_automations_notifications.sql) and
 * owner-only RLS are the enforcement authority for "only this column, only the owner's own row" —
 * this DAL never attempts to touch `title`/`body`/`severity`/`metadata`. Throws an `AppError`
 * (code preserved, e.g. `42501` on a denied non-owner update).
 */
export async function markNotificationRead(id: string): Promise<void> {
  const { error } = await supabase
    .from('notifications')
    .update({ read_at: new Date().toISOString() })
    .eq('id', id);
  if (error) throwWrite(error);
}
