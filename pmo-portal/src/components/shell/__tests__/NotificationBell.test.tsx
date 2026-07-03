/**
 * NotificationBell — AC-AAN-032..035, NFR-AAN-A11Y-001..003.
 *
 * Own component, own query (REC-3 — no `notificationCount` prop; the bell owns its
 * unread-count + inbox query against the notifications DAL). Mocks `@/src/lib/db/notifications`
 * (`listUnreadCount`/`listNotifications`/`markNotificationRead`) — no DB access in this test.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import React from 'react';

const mockNavigate = vi.fn();
vi.mock('react-router-dom', async (importOriginal) => {
  const real = await importOriginal<typeof import('react-router-dom')>();
  return { ...real, useNavigate: () => mockNavigate };
});

const openPanel = vi.fn();
const openThread = vi.fn();
vi.mock('@/src/hooks/useAssistantPanel', () => ({
  useAssistantPanel: () => ({ openPanel, openThread }),
}));

const listUnreadCount = vi.fn();
const listNotifications = vi.fn();
const markNotificationRead = vi.fn();
vi.mock('@/src/lib/db/notifications', () => ({
  listUnreadCount: (...args: unknown[]) => listUnreadCount(...args),
  listNotifications: (...args: unknown[]) => listNotifications(...args),
  markNotificationRead: (...args: unknown[]) => markNotificationRead(...args),
}));

import { NotificationBell } from '../NotificationBell';

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: 'n1',
    org_id: 'org-1',
    owner_id: 'u1',
    severity: 'info',
    title: 'Automation finished',
    body: 'Your weekly report is ready.',
    metadata: null,
    read_at: null,
    created_at: '2026-07-03T08:00:00.000Z',
    ...overrides,
  };
}

const renderBell = () => render(<MemoryRouter><NotificationBell /></MemoryRouter>);

beforeEach(() => {
  mockNavigate.mockClear();
  openPanel.mockClear();
  openThread.mockClear();
  listUnreadCount.mockReset();
  listNotifications.mockReset();
  markNotificationRead.mockReset();
  listUnreadCount.mockResolvedValue(0);
  listNotifications.mockResolvedValue([]);
  markNotificationRead.mockResolvedValue(undefined);
});

describe('NotificationBell', () => {
  it('AC-AAN-032 the badge reflects the unread count and the accessible name includes it', async () => {
    listUnreadCount.mockResolvedValue(3);
    renderBell();
    const bell = await screen.findByRole('button', { name: /notifications.*3 unread/i });
    expect(bell).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument();
  });

  it('NFR-AAN-A11Y-003 the badge region is aria-live=polite', async () => {
    listUnreadCount.mockResolvedValue(2);
    renderBell();
    await screen.findByText('2');
    const live = document.querySelector('[aria-live="polite"]');
    expect(live).not.toBeNull();
  });

  it('empty state: zero unread hides the numeric badge but the bell stays accessible', async () => {
    listUnreadCount.mockResolvedValue(0);
    renderBell();
    const bell = await screen.findByRole('button', { name: /notifications.*0 unread/i });
    expect(bell).toBeInTheDocument();
    expect(screen.queryByText('0')).not.toBeInTheDocument();
  });

  it('AC-AAN-033 opening the bell lists notifications most-recent-first as a semantic list', async () => {
    listUnreadCount.mockResolvedValue(2);
    listNotifications.mockResolvedValue([
      row({ id: 'newer', title: 'Newer', created_at: '2026-07-03T10:00:00.000Z' }),
      row({ id: 'older', title: 'Older', created_at: '2026-07-01T10:00:00.000Z', read_at: '2026-07-01T11:00:00.000Z' }),
    ]);
    renderBell();
    const bell = await screen.findByRole('button', { name: /notifications/i });
    await userEvent.click(bell);

    const list = await screen.findByRole('list', { name: /notifications/i });
    const items = within(list).getAllByRole('listitem');
    expect(items).toHaveLength(2);
    expect(within(items[0]).getByText('Newer')).toBeInTheDocument();
    expect(within(items[1]).getByText('Older')).toBeInTheDocument();
    // Read/unread conveyed via text, not color alone (NFR-AAN-A11Y-002).
    expect(within(items[0]).getByText('Unread')).toBeInTheDocument();
    expect(within(items[1]).getByText('Read')).toBeInTheDocument();
  });

  it('loading state: shows a loading indicator while the inbox list resolves', async () => {
    let resolveList: (v: unknown) => void = () => {};
    listNotifications.mockReturnValue(new Promise((res) => { resolveList = res; }));
    listUnreadCount.mockResolvedValue(1);
    renderBell();
    const bell = await screen.findByRole('button', { name: /notifications/i });
    await userEvent.click(bell);
    expect(screen.getByText(/loading/i)).toBeInTheDocument();
    resolveList([]);
    await waitFor(() => expect(screen.queryByText(/loading/i)).not.toBeInTheDocument());
  });

  it('empty inbox: opening with zero notifications shows an empty-state message, not a blank panel', async () => {
    listUnreadCount.mockResolvedValue(0);
    listNotifications.mockResolvedValue([]);
    renderBell();
    const bell = await screen.findByRole('button', { name: /notifications/i });
    await userEvent.click(bell);
    expect(await screen.findByText(/no notifications/i)).toBeInTheDocument();
  });

  it('error state: a failed inbox load shows an error message, not a crash', async () => {
    listUnreadCount.mockResolvedValue(1);
    listNotifications.mockRejectedValue(new Error('network down'));
    renderBell();
    const bell = await screen.findByRole('button', { name: /notifications/i });
    await userEvent.click(bell);
    expect(await screen.findByText(/couldn't load|could not load|failed to load/i)).toBeInTheDocument();
  });

  it('AC-AAN-034 selecting an unread notification marks it read and decrements the badge', async () => {
    listUnreadCount.mockResolvedValue(1);
    listNotifications.mockResolvedValue([row({ id: 'n1', read_at: null })]);
    renderBell();
    const bell = await screen.findByRole('button', { name: /notifications.*1 unread/i });
    await userEvent.click(bell);
    const item = await screen.findByRole('button', { name: /automation finished/i });
    await userEvent.click(item);

    await waitFor(() => expect(markNotificationRead).toHaveBeenCalledWith('n1'));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /notifications.*0 unread/i })).toBeInTheDocument(),
    );
    expect(screen.queryByText('1')).not.toBeInTheDocument();
  });

  it('AC-AAN-035 selecting a notification with metadata.entity navigates to that record', async () => {
    listUnreadCount.mockResolvedValue(1);
    listNotifications.mockResolvedValue([
      row({
        id: 'n1',
        title: 'Case updated',
        metadata: { entity: { type: 'procurement_case', id: 'pc-42', label: 'PC-42' } },
      }),
    ]);
    renderBell();
    const bell = await screen.findByRole('button', { name: /notifications/i });
    await userEvent.click(bell);
    const item = await screen.findByRole('button', { name: /case updated/i });
    await userEvent.click(item);

    await waitFor(() => expect(markNotificationRead).toHaveBeenCalledWith('n1'));
    expect(mockNavigate).toHaveBeenCalledWith('/procurement/pc-42');
  });

  it('AC-AAN-035 selecting a notification with only metadata.run_id opens that run', async () => {
    listUnreadCount.mockResolvedValue(1);
    listNotifications.mockResolvedValue([
      row({ id: 'n1', title: 'Run finished', metadata: { run_id: 'run-9' } }),
    ]);
    renderBell();
    const bell = await screen.findByRole('button', { name: /notifications/i });
    await userEvent.click(bell);
    const item = await screen.findByRole('button', { name: /run finished/i });
    await userEvent.click(item);

    await waitFor(() => expect(markNotificationRead).toHaveBeenCalledWith('n1'));
    expect(openPanel).toHaveBeenCalled();
    expect(openThread).toHaveBeenCalledWith('run-9');
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it('AC-AAN-035 selecting a notification with neither entity nor run_id only marks it read', async () => {
    listUnreadCount.mockResolvedValue(1);
    listNotifications.mockResolvedValue([row({ id: 'n1', title: 'Plain notice', metadata: null })]);
    renderBell();
    const bell = await screen.findByRole('button', { name: /notifications/i });
    await userEvent.click(bell);
    const item = await screen.findByRole('button', { name: /plain notice/i });
    await userEvent.click(item);

    await waitFor(() => expect(markNotificationRead).toHaveBeenCalledWith('n1'));
    expect(mockNavigate).not.toHaveBeenCalled();
    expect(openThread).not.toHaveBeenCalled();
  });

  it('severity is conveyed by a quiet dot + label, never a loud filled slab (monochrome-calm)', async () => {
    listUnreadCount.mockResolvedValue(1);
    listNotifications.mockResolvedValue([row({ id: 'n1', severity: 'critical', title: 'Budget breach' })]);
    renderBell();
    const bell = await screen.findByRole('button', { name: /notifications/i });
    await userEvent.click(bell);
    const item = await screen.findByRole('button', { name: /budget breach/i });
    // Severity label text is present (never color-only).
    expect(within(item).getByText(/critical/i)).toBeInTheDocument();
    // The dot marker exists but carries no visible text of its own (decorative).
    const dot = item.querySelector('[data-severity-dot]');
    expect(dot).not.toBeNull();
    expect(dot).toHaveAttribute('aria-hidden', 'true');
  });

  it('keyboard: the bell is reachable and togglable via keyboard (Enter)', async () => {
    listUnreadCount.mockResolvedValue(1);
    listNotifications.mockResolvedValue([row()]);
    renderBell();
    const bell = await screen.findByRole('button', { name: /notifications/i });
    bell.focus();
    expect(bell).toHaveFocus();
    await userEvent.keyboard('{Enter}');
    expect(await screen.findByRole('list', { name: /notifications/i })).toBeInTheDocument();
  });
});
