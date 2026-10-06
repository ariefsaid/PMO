import { supabase } from '@/src/lib/supabase/client';
import { AppError, assertWriteLanded } from '@/src/lib/appError';
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

/** Columns the inbox list renders — explicit list, never `select('*')` (#843). */
const NOTIFICATION_LIST_COLUMNS = 'id,title,body,severity,metadata,read_at,created_at';

export type NotificationListItem = Pick<
  NotificationRow,
  'id' | 'title' | 'body' | 'severity' | 'metadata' | 'read_at' | 'created_at'
>;

/** Keyset position of the last row of a page: the order key `(created_at desc, id desc)`. */
export interface NotificationCursor {
  createdAt: string;
  id: string;
}

export interface NotificationPage {
  rows: NotificationListItem[];
  /** Pass back as `cursor` to fetch the next page; `null` when this was the last page. */
  nextCursor: NotificationCursor | null;
}

export const NOTIFICATION_PAGE_SIZE = 20;

/**
 * One keyset-paged slice of the caller's own notifications (#843, AC-843-001..004). Stable order
 * `created_at desc, id desc` (served by `notifications_owner_created_idx`); fetches `pageSize + 1`
 * rows so `nextCursor` is known without a count query. Owner-only RLS scopes the rows; org/owner
 * ids are never sent or selected.
 */
export async function listNotificationsPage(opts?: {
  pageSize?: number;
  cursor?: NotificationCursor | null;
  unreadOnly?: boolean;
}): Promise<NotificationPage> {
  const pageSize = opts?.pageSize ?? NOTIFICATION_PAGE_SIZE;
  let query = supabase
    .from('notifications')
    .select(NOTIFICATION_LIST_COLUMNS)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(pageSize + 1);
  if (opts?.unreadOnly) query = query.is('read_at', null);
  if (opts?.cursor) {
    const { createdAt, id } = opts.cursor;
    query = query.or(`created_at.lt.${createdAt},and(created_at.eq.${createdAt},id.lt.${id})`);
  }
  const { data, error } = await query;
  if (error) throwWrite(error);
  const fetched = (data ?? []) as NotificationListItem[];
  const rows = fetched.slice(0, pageSize);
  const last = rows[rows.length - 1];
  const nextCursor =
    fetched.length > pageSize && last ? { createdAt: last.created_at, id: last.id } : null;
  return { rows, nextCursor };
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
  const { data, error } = await supabase
    .from('notifications')
    .update({ read_at: new Date().toISOString() })
    .eq('id', id)
    .select('id');
  if (error) throwWrite(error);
  assertWriteLanded(data, 'Notification not found or you do not have permission to update it.');
}
