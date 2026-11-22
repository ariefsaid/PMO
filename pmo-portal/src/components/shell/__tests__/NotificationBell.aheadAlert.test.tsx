/** material-vs-progress AC-MVP-014 — an ahead-of-progress notification opens the work order from the bell. */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import React from 'react';

const mockNavigate = vi.fn();
vi.mock('react-router', async (importOriginal) => {
  const real = await importOriginal<typeof import('react-router')>();
  return { ...real, useNavigate: () => mockNavigate };
});
vi.mock('@/src/hooks/useAssistantPanel', () => ({ useAssistantPanel: () => ({ openPanel: vi.fn(), openThread: vi.fn() }) }));

const listNotifications = vi.fn();
vi.mock('@/src/lib/db/notifications', () => ({
  listUnreadCount: async () => 1,
  listNotificationsPage: async () => ({ rows: await listNotifications(), nextCursor: null }),
  markNotificationRead: vi.fn(),
}));

import { NotificationBell } from '../NotificationBell';

beforeEach(() => mockNavigate.mockClear());

describe('AC-MVP-014 bell opens the work order', () => {
  it('navigates to the work-order page', async () => {
    listNotifications.mockResolvedValue([{
      id: 'n1', org_id: 'org-1', owner_id: 'u1', severity: 'info', title: 'Material issued ahead of progress',
      body: 'Welding rod on work order WO-7: issued 60% of planned, progress 20%, 40.0 points ahead.', metadata: { entity: { type: 'work_order', id: 'wo-7', label: 'WO-7' } },
      read_at: null, created_at: '2026-11-21T08:00:00.000Z',
    }]);
    render(<MemoryRouter><NotificationBell /></MemoryRouter>);
    await userEvent.click(await screen.findByRole('button', { name: /notifications/i }));
    await userEvent.click(await screen.findByRole('button', { name: /material issued ahead of progress/i }));
    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('/work-orders/wo-7'));
  });
});
