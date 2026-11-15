import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { ToastProvider } from '@/src/components/ui';

// #1990 — the account timeline shows the loaded page(s) and a "Show more" that pulls older ones.
const { activities, contacts, may } = vi.hoisted(() => ({
  activities: {
    data: [] as Record<string, unknown>[],
    isPending: false,
    isError: false,
    refetch: vi.fn(),
    hasNextPage: false,
    isFetchingNextPage: false,
    fetchNextPage: vi.fn(),
  },
  contacts: { data: [{ id: 'ct1', full_name: 'Jane Doe' }], isPending: false, isError: false, refetch: vi.fn() },
  may: vi.fn(() => false),
}));
const mut = { mutateAsync: vi.fn(), isPending: false };
vi.mock('@/src/hooks/useContacts', () => ({
  useContactsByCompany: () => contacts,
  useCompanyActivities: () => activities,
  useContactMutations: () => ({ logActivity: mut, updateActivity: mut, deleteActivity: mut }),
}));
vi.mock('@/src/auth/usePermission', () => ({ usePermission: () => may }));

import { AccountActivityCard } from './AccountActivityCard';

const rows = (n: number) =>
  Array.from({ length: n }, (_, i) => ({
    id: `a${i}`,
    contact_id: 'ct1',
    kind: 'Call',
    subject: `Subject ${i}`,
    body: null,
    occurred_at: '2026-05-15T10:00:00Z',
  }));

const renderCard = () =>
  render(
    <ToastProvider>
      <MemoryRouter>
        <AccountActivityCard companyId="co1" />
      </MemoryRouter>
    </ToastProvider>,
  );

beforeEach(() => {
  may.mockReturnValue(false);
  activities.data = [];
  activities.hasNextPage = false;
  activities.isFetchingNextPage = false;
  activities.fetchNextPage.mockClear();
});

describe('#1990 AccountActivityCard paging', () => {
  it('older activity exists: states how many are shown and Show more loads the next page', async () => {
    activities.data = rows(20);
    activities.hasNextPage = true;
    renderCard();
    expect(screen.getAllByRole('listitem')).toHaveLength(20);
    expect(screen.getByTestId('activity-shown-count')).toHaveTextContent('Showing the 20 most recent');
    await userEvent.click(screen.getByRole('button', { name: 'Show more' }));
    expect(activities.fetchNextPage).toHaveBeenCalledTimes(1);
  });

  it('a short timeline shows no footer at all', () => {
    activities.data = rows(3);
    renderCard();
    expect(screen.queryByTestId('activity-shown-count')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Show more' })).toBeNull();
  });

  it('everything loaded past the first page: count stays, button goes', () => {
    activities.data = rows(25);
    renderCard();
    expect(screen.getByTestId('activity-shown-count')).toHaveTextContent('Showing all 25');
    expect(screen.queryByRole('button', { name: 'Show more' })).toBeNull();
  });

  it('a11y(#2085) each Edit/Delete activity button names its activity row', () => {
    may.mockReturnValue(true);
    activities.data = [
      { id: 'a1', contact_id: 'ct1', kind: 'Call', subject: 'Kickoff call', body: null, occurred_at: '2026-05-15T10:00:00Z' },
      { id: 'a2', contact_id: 'ct1', kind: 'Note', subject: 'Site visit', body: null, occurred_at: '2026-05-16T10:00:00Z' },
    ];
    renderCard();
    expect(screen.getByRole('button', { name: 'Edit activity — Kickoff call' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Delete activity — Kickoff call' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Edit activity — Site visit' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Delete activity — Site visit' })).toBeInTheDocument();
  });

  it('floor: a named Delete activity button still confirms before it deletes', async () => {
    may.mockReturnValue(true);
    const user = userEvent.setup();
    activities.data = [
      { id: 'a1', contact_id: 'ct1', kind: 'Call', subject: 'Kickoff call', body: null, occurred_at: '2026-05-15T10:00:00Z' },
    ];
    renderCard();
    await user.click(screen.getByRole('button', { name: 'Delete activity — Kickoff call' }));
    expect(mut.mutateAsync).not.toHaveBeenCalled();
    const dialog = await screen.findByRole('alertdialog');
    await user.click(within(dialog).getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(mut.mutateAsync).toHaveBeenCalled());
  });
});
