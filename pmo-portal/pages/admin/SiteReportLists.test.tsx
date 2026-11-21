/** #2621 (FR-DSR-003/004) — Administration › Projects › Site report lists: an Admin adds, renames and archives/restores. */
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ToastProvider } from '@/src/components/ui';

const h = vi.hoisted(() => ({ canManage: true, list: vi.fn(), add: vi.fn(), rename: vi.fn(), archive: vi.fn() }));
vi.mock('@/src/lib/repositories', () => ({
  repositories: { dailySiteReport: { listListItems: h.list, addListItem: h.add, renameListItem: h.rename, setListItemArchived: h.archive } },
}));
vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: { id: 'u', org_id: 'o' } }) }));
vi.mock('@/src/auth/usePermission', () => ({ usePermission: () => () => h.canManage }));
import SiteReportLists from './SiteReportLists';

beforeEach(() => {
  vi.clearAllMocks();
  h.canManage = true;
  h.list.mockImplementation(async (kind: string) => kind === 'idle'
    ? [{ id: 'i1', label: 'Other', archived_at: null }, { id: 'i2', label: 'Rain', archived_at: '2026-11-01T00:00:00Z' }]
    : [{ id: 'w1', label: 'Clear', archived_at: null }]);
  h.add.mockResolvedValue(undefined); h.rename.mockResolvedValue(undefined); h.archive.mockResolvedValue(undefined);
});
const renderLists = () => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><ToastProvider><SiteReportLists /></ToastProvider></QueryClientProvider>);

describe('site report lists', () => {
  it('an Admin adds an idle reason', async () => {
    renderLists();
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText('New idle reasons entry'), ' Heavy wind ');
    await user.click(screen.getAllByRole('button', { name: 'Add' })[0]);
    expect(h.add).toHaveBeenCalledWith('idle', ' Heavy wind ');
  });
  it('an Admin archives "Other" and restores an archived item', async () => {
    renderLists();
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Archive Other' }));
    expect(h.archive).toHaveBeenCalledWith('idle', 'i1', true);
    expect(screen.getByText(/Rain · Archived/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Restore Rain' }));
    expect(h.archive).toHaveBeenCalledWith('idle', 'i2', false);
  });
  it('an Admin renames a weather condition', async () => {
    renderLists();
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Rename Clear' }));
    const input = screen.getByLabelText('Name for Clear');
    await user.clear(input); await user.type(input, 'Sunny');
    await user.click(within(input.closest('form') as HTMLElement).getByRole('button', { name: 'Save' }));
    expect(h.rename).toHaveBeenCalledWith('weather', 'w1', 'Sunny');
  });
  it('anyone else sees no editor', () => {
    h.canManage = false;
    renderLists();
    expect(screen.queryByText('Site report lists')).toBeNull();
    expect(h.list).not.toHaveBeenCalled();
  });
});
