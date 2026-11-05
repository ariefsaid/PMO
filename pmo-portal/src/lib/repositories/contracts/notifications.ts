/** Notification repository contract: the caller's inbox pages, unread count and mark-read the shell bell uses. */
import type { NotificationCursor, NotificationPage } from '@/src/lib/db/notifications';

export interface NotificationRepository {
  /** One inbox page, newest first; pass the previous page's cursor to continue. */
  listPage(opts?: { cursor?: NotificationCursor | null }): Promise<NotificationPage>;
  /** Count of the caller's unread notifications. */
  unreadCount(): Promise<number>;
  /** Mark one notification read. */
  markRead(id: string): Promise<void>;
}
