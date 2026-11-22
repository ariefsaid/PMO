/** #2685 AC-MRI-016 — a material-request notification opens that request from the bell. */
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

describe('AC-MRI-016 bell opens the material request', () => {
  it('navigates to the request detail', async () => {
    listNotifications.mockResolvedValue([{
      id: 'n1', org_id: 'org-1', owner_id: 'u1', severity: 'info', title: 'Material request awaiting your approval',
      body: 'MR-0007 · Stock check', metadata: { entity: { type: 'material_request', id: 'mr-7', label: 'MR-0007' }, mrq_step_id: 's1' },
      read_at: null, created_at: '2026-11-21T08:00:00.000Z',
    }]);
    render(<MemoryRouter><NotificationBell /></MemoryRouter>);
    await userEvent.click(await screen.findByRole('button', { name: /notifications/i }));
    await userEvent.click(await screen.findByRole('button', { name: /material request awaiting your approval/i }));
    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('/material-requests/mr-7'));
  });
});
