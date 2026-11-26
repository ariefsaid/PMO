import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, useLocation } from 'react-router';
import { makeTestQueryClient } from '@/test/testQueryClient';

const listPage = vi.fn();
const markRead = vi.fn();
vi.mock('@/src/lib/repositories', () => ({ repositories: { notification: { listPage: (...a: unknown[]) => listPage(...a), markRead: (...a: unknown[]) => markRead(...a) } } }));
vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: { id: 'u1' } }) }));

import { MyNotices } from './MyNotices';

const row = (id: string, over: Record<string, unknown> = {}) => ({
  id, severity: 'warning', title: `Notice ${id}`, body: null, read_at: null, created_at: new Date().toISOString(),
  metadata: { entity: { type: 'expiry_document', id: 'd1' } }, ...over,
});
const Where: React.FC = () => <span data-testid="where">{useLocation().pathname}</span>;
const show = () => render(
  <QueryClientProvider client={makeTestQueryClient()}><MemoryRouter initialEntries={['/my']}><MyNotices /><Where /></MemoryRouter></QueryClientProvider>,
);

describe('MyNotices (#2887)', () => {
  beforeEach(() => { listPage.mockReset(); markRead.mockReset(); markRead.mockResolvedValue(undefined); });

  it('JOB-2887-1 lists my notices in the order served, unread marked', async () => {
    listPage.mockResolvedValue({ rows: [row('a'), row('b', { read_at: '2026-01-01T00:00:00Z' })], nextCursor: null });
    show();
    const list = await screen.findByRole('list', { name: 'Notifications' });
    const items = list.querySelectorAll('li');
    expect(items[0]).toHaveTextContent('Notice a');
    expect(items[0]).toHaveTextContent('Unread');
    expect(items[1]).toHaveTextContent('Read');
  });

  it('JOB-2887-2 opening a notice marks it read and stays on My work when a field account cannot open its record', async () => {
    listPage.mockResolvedValue({ rows: [row('a')], nextCursor: null });
    markRead.mockImplementation(async () => { listPage.mockResolvedValue({ rows: [row('a', { read_at: '2026-01-01T00:00:00Z' })], nextCursor: null }); });
    show();
    await userEvent.click(await screen.findByRole('button', { name: /Notice a/ }));
    await waitFor(() => expect(markRead).toHaveBeenCalledWith('a'));
    expect(screen.getByTestId('where')).toHaveTextContent('/my');
    await waitFor(() => expect(screen.getByRole('button', { name: /Notice a/ })).toHaveTextContent(/Read/));
  });

  it('JOB-2887-3 omits the empty notices section', async () => {
    listPage.mockResolvedValue({ rows: [], nextCursor: null });
    show();
    await waitFor(() => expect(listPage).toHaveBeenCalled());
    await waitFor(() => expect(screen.queryByText('Loading notifications…')).not.toBeInTheDocument());
    expect(screen.queryByRole('heading', { name: 'Notices' })).not.toBeInTheDocument();
  });

  it('F2 renders every fetched notice, not only the first ten', async () => {
    const rows = Array.from({ length: 12 }, (_, i) => row(`n${i + 1}`));
    listPage.mockResolvedValue({ rows, nextCursor: null });
    show();
    const list = await screen.findByRole('list', { name: 'Notifications' });
    await waitFor(() => expect(list.querySelectorAll('li')).toHaveLength(12));
    expect(screen.getByRole('button', { name: /Notice n12/ })).toBeInTheDocument();
  });

  it('F2 "Load more" fetches the next page and appends its notices', async () => {
    const firstPage = Array.from({ length: 10 }, (_, i) => row(`p1-${i + 1}`));
    const secondPage = Array.from({ length: 5 }, (_, i) => row(`p2-${i + 1}`));
    const cursor = { createdAt: '2026-01-01T00:00:00Z', id: 'p1-10' };
    listPage.mockResolvedValueOnce({ rows: firstPage, nextCursor: cursor })
      .mockResolvedValueOnce({ rows: secondPage, nextCursor: null });
    show();
    const list = await screen.findByRole('list', { name: 'Notifications' });
    expect(screen.getByRole('button', { name: 'Load more' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Load more' }));
    await waitFor(() => expect(listPage).toHaveBeenCalledWith({ cursor }));
    await waitFor(() => expect(screen.getByRole('button', { name: /Notice p2-5/ })).toBeInTheDocument());
    expect(list.querySelectorAll('li')).toHaveLength(15);
  });
});
