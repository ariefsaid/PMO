/** AC-ICM-010 — Administration › Projects › Issue types: an Admin adds, renames and archives/restores; others see nothing. */
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ToastProvider } from '@/src/components/ui';

const h = vi.hoisted(() => ({ canManage: true, list: vi.fn(), add: vi.fn(), rename: vi.fn(), setArchived: vi.fn() }));
vi.mock('@/src/lib/repositories', () => ({
  repositories: { incidentType: { list: h.list, add: h.add, rename: h.rename, setArchived: h.setArchived } },
}));
vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: { id: 'u', org_id: 'o' } }) }));
vi.mock('@/src/auth/usePermission', () => ({ usePermission: () => () => h.canManage }));
import OrgIssueTypes from './OrgIssueTypes';

const many = [
  { id: 't1', label: 'Electrical', archived_at: null },
  { id: 't2', label: 'Civil', archived_at: null },
  { id: 't3', label: 'Old type', archived_at: '2026-11-01T00:00:00Z' },
];
beforeEach(() => {
  vi.clearAllMocks();
  h.canManage = true;
  h.list.mockResolvedValue(many);
  h.add.mockResolvedValue(undefined); h.rename.mockResolvedValue(undefined); h.setArchived.mockResolvedValue(undefined);
});
const renderCard = () => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><ToastProvider><OrgIssueTypes /></ToastProvider></QueryClientProvider>);

describe('AC-ICM-010 issue types card', () => {
  it('an Admin adds a type', async () => {
    renderCard();
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText('New issue type'), ' Mechanical ');
    await user.click(screen.getByRole('button', { name: 'Add' }));
    expect(h.add).toHaveBeenCalledWith(' Mechanical ');
  });
  it('an Admin archives a type and restores an archived one', async () => {
    renderCard();
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Archive Civil' }));
    expect(h.setArchived).toHaveBeenCalledWith('t2', true);
    expect(screen.getByText(/Old type · Archived/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Restore Old type' }));
    expect(h.setArchived).toHaveBeenCalledWith('t3', false);
  });
  it('an Admin renames a type', async () => {
    renderCard();
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Rename Electrical' }));
    const input = screen.getByLabelText('Name for Electrical');
    await user.clear(input); await user.type(input, 'Electrical works');
    await user.click(within(input.closest('form') as HTMLElement).getByRole('button', { name: 'Save' }));
    expect(h.rename).toHaveBeenCalledWith('t1', 'Electrical works');
  });
  it('a near-empty list says the Admin adds the organisation\'s types', async () => {
    h.list.mockResolvedValue([{ id: 't9', label: 'Other', archived_at: null }]);
    renderCard();
    expect(await screen.findByTestId('issue-types-near-empty')).toHaveTextContent(/Add your organisation/);
  });
  it('anyone else sees no card and reads nothing', () => {
    h.canManage = false;
    renderCard();
    expect(screen.queryByText('Issue types')).toBeNull();
    expect(h.list).not.toHaveBeenCalled();
  });
});
