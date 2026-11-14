import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { ToastProvider } from '@/src/components/ui';

// #1990 — the contact timeline shows the loaded page(s) and a "Show more" that pulls older ones.
const { activities, meetings } = vi.hoisted(() => ({
  activities: {
    data: [] as Record<string, unknown>[],
    isPending: false,
    isError: false,
    refetch: vi.fn(),
    hasNextPage: false,
    isFetchingNextPage: false,
    fetchNextPage: vi.fn(),
  },
  meetings: {
    data: [] as Record<string, unknown>[],
    isError: false,
    hasNextPage: false,
    isFetchingNextPage: false,
    fetchNextPage: vi.fn(),
  },
}));
const mut = { mutateAsync: vi.fn(), isPending: false };
vi.mock('@/src/hooks/useContacts', () => ({
  useContactActivities: () => activities,
  useContactMeetings: () => meetings,
  useContactMutations: () => ({ logActivity: mut, updateActivity: mut, deleteActivity: mut }),
}));
vi.mock('@/src/auth/usePermission', () => ({ usePermission: () => () => false }));

import { ContactActivityPanel } from './ContactActivityPanel';

const rows = (n: number) =>
  Array.from({ length: n }, (_, i) => ({
    id: `a${i}`,
    contact_id: 'ct1',
    kind: 'Call',
    subject: `Subject ${i}`,
    body: null,
    project_id: null,
    company_id: null,
    // newest first: a0 is the newest
    occurred_at: new Date(Date.UTC(2026, 5, 30 - i)).toISOString(),
  }));

const renderPanel = () =>
  render(
    <ToastProvider>
      <MemoryRouter>
        <ContactActivityPanel
          contactId="ct1"
          canLog={false}
          logFormOpen={false}
          onLogFormOpenChange={vi.fn()}
        />
      </MemoryRouter>
    </ToastProvider>,
  );

beforeEach(() => {
  activities.data = [];
  activities.hasNextPage = false;
  activities.isFetchingNextPage = false;
  activities.fetchNextPage.mockClear();
  meetings.data = [];
  meetings.hasNextPage = false;
  meetings.isFetchingNextPage = false;
  meetings.fetchNextPage.mockClear();
});

describe('#1990 ContactActivityPanel paging', () => {
  it('older activity exists: states how many are shown and Show more loads the next page', async () => {
    activities.data = rows(20);
    activities.hasNextPage = true;
    renderPanel();
    expect(screen.getAllByRole('listitem')).toHaveLength(20);
    expect(screen.getByTestId('activity-shown-count')).toHaveTextContent('Showing the 20 most recent');
    await userEvent.click(screen.getByRole('button', { name: 'Show more' }));
    expect(activities.fetchNextPage).toHaveBeenCalledTimes(1);
  });

  it('a minuted meeting older than the loaded window waits for Show more instead of jumping ahead of unloaded activity', () => {
    activities.data = rows(20); // oldest loaded: 2026-06-11
    activities.hasNextPage = true;
    meetings.data = [
      { id: 'm-new', title: 'Recent sync', occurred_at: '2026-06-20T09:00:00Z' },
      { id: 'm-old', title: 'Ancient kickoff', occurred_at: '2025-01-05T09:00:00Z' },
    ];
    renderPanel();
    expect(screen.getByText('Recent sync')).toBeInTheDocument();
    expect(screen.queryByText('Ancient kickoff')).toBeNull();
  });

  it('with nothing older to load, every meeting shows', () => {
    activities.data = rows(2);
    meetings.data = [{ id: 'm-old', title: 'Ancient kickoff', occurred_at: '2025-01-05T09:00:00Z' }];
    renderPanel();
    expect(screen.getByText('Ancient kickoff')).toBeInTheDocument();
  });

  it('pages a long contact meeting history instead of loading it all at once', async () => {
    meetings.data = Array.from({ length: 25 }, (_, i) => ({
      id: `m${i}`,
      title: `Meeting ${i}`,
      occurred_at: new Date(Date.UTC(2026, 5, 30 - i)).toISOString(),
    }));
    meetings.hasNextPage = true;
    renderPanel();

    expect(screen.getAllByTestId('timeline-meeting')).toHaveLength(25);
    expect(screen.getByTestId('activity-shown-count')).toHaveTextContent('Showing the 25 most recent');
    await userEvent.click(screen.getByRole('button', { name: 'Show more' }));
    expect(meetings.fetchNextPage).toHaveBeenCalledTimes(1);
  });
});
