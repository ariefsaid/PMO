/** Notification repository implementation. */
import { listNotificationsPage, listUnreadCount, markNotificationRead } from '@/src/lib/db/notifications';
import { wrap } from './repositoryErrors';
import type { NotificationRepository } from './contracts/notifications';

export const notificationRepository: NotificationRepository = {
  listPage: (opts) => wrap(() => listNotificationsPage(opts)),
  unreadCount: () => wrap(() => listUnreadCount()),
  markRead: (id) => wrap(() => markNotificationRead(id)),
};
