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

describe('fix-waiting item 4: a return notification says what was returned and why, and opens it', () => {
  it('JOB-WAIT-4 shows the reason and the record label, and opens a returned daily report', async () => {
    listNotifications.mockResolvedValue([{
      id: 'n2', org_id: 'org-1', owner_id: 'u1', severity: 'warning', title: 'Your daily report was sent back', message_key: 'literal', message_params: { body: 'Photo is blurred' },
      body: 'Photo is blurred', metadata: { entity: { type: 'daily_site_report', id: 'dr-1', label: 'WO-7 · Slab · 2026-11-20' } },
      read_at: null, created_at: '2026-11-21T08:00:00.000Z',
    }]);
    render(<MemoryRouter><NotificationBell /></MemoryRouter>);
    await userEvent.click(await screen.findByRole('button', { name: /notifications/i }));
    expect(await screen.findByTestId('notification-entity-label')).toHaveTextContent('WO-7 · Slab · 2026-11-20');
    expect(screen.getByText('Photo is blurred')).toBeInTheDocument();
    await userEvent.click(await screen.findByRole('button', { name: /your daily report was sent back/i }));
    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('/site-reports/dr-1'));
  });
});
