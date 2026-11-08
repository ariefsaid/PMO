import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { ToastProvider } from '@/src/components/ui';

// #1990 — the account timeline shows the loaded page(s) and a "Show more" that pulls older ones.
const { activities, contacts } = vi.hoisted(() => ({
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
}));
const mut = { mutateAsync: vi.fn(), isPending: false };
vi.mock('@/src/hooks/useContacts', () => ({
  useContactsByCompany: () => contacts,
  useCompanyActivities: () => activities,
  useContactMutations: () => ({ logActivity: mut, updateActivity: mut, deleteActivity: mut }),
}));
vi.mock('@/src/auth/usePermission', () => ({ usePermission: () => () => false }));

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
});
