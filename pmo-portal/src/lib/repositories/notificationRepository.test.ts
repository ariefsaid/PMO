import { describe, it, expect, vi } from 'vitest';

const listNotificationsPage = vi.fn();
const listUnreadCount = vi.fn();
const markNotificationRead = vi.fn();
vi.mock('@/src/lib/db/notifications', () => ({
  listNotificationsPage: (...a: unknown[]) => listNotificationsPage(...a),
  listUnreadCount: (...a: unknown[]) => listUnreadCount(...a),
  markNotificationRead: (...a: unknown[]) => markNotificationRead(...a),
}));

import { notificationRepository } from './notifications';
import { AppError } from '@/src/lib/appError';

describe('notificationRepository', () => {
  it('passes the cursor through and returns the page', async () => {
    const page = { rows: [], nextCursor: null };
    listNotificationsPage.mockResolvedValue(page);
    const cursor = { createdAt: '2026-01-01T00:00:00Z', id: 'n1' };
    expect(await notificationRepository.listPage({ cursor })).toBe(page);
    expect(listNotificationsPage).toHaveBeenCalledWith({ cursor });
  });

  it('returns the unread count and marks one notification read', async () => {
    listUnreadCount.mockResolvedValue(3);
    markNotificationRead.mockResolvedValue(undefined);
    expect(await notificationRepository.unreadCount()).toBe(3);
    await notificationRepository.markRead('n1');
    expect(markNotificationRead).toHaveBeenCalledWith('n1');
  });

  it('normalizes a DAL failure into an AppError', async () => {
    listUnreadCount.mockRejectedValue(new Error('boom'));
    await expect(notificationRepository.unreadCount()).rejects.toBeInstanceOf(AppError);
  });
});
