import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { ToastProvider } from '@/src/components/ui';
import type { CrmActivityInput } from '@/src/lib/db/crmActivities';
import { firstInstantOfZonedCalendarDay, formatCalendarDayInTimeZone } from '@/src/lib/format';
import { getActiveLocale, resetActiveLocale, setActiveLocale } from '@/src/lib/locale/activeLocale';

const { activities, meetings, logActivity } = vi.hoisted(() => ({
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
  logActivity: { mutateAsync: vi.fn().mockResolvedValue(undefined), isPending: false },
}));

vi.mock('@/src/hooks/useContacts', () => ({
  useContactActivities: () => activities,
  useContactMeetings: () => meetings,
  useContactMutations: () => ({
    logActivity,
    updateActivity: { mutateAsync: vi.fn(), isPending: false },
    deleteActivity: { mutateAsync: vi.fn(), isPending: false },
  }),
}));
vi.mock('@/src/auth/usePermission', () => ({ usePermission: () => () => true }));

import { ContactActivityPanel } from './ContactActivityPanel';

const renderPanel = () => render(
  <ToastProvider>
    <MemoryRouter>
      <ContactActivityPanel
        contactId="ct1"
        canLog
        logFormOpen
        onLogFormOpenChange={vi.fn()}
      />
    </MemoryRouter>
  </ToastProvider>,
);

const submitLog = async (subject: string) => {
  const subjectField = screen.getByLabelText(/subject/i);
  fireEvent.change(subjectField, { target: { value: subject } });
  await act(async () => {
    fireEvent.submit(subjectField.closest('form')!);
  });
};

beforeEach(() => {
  setActiveLocale({ locale: 'en-US', numberLocale: 'en-US', timezone: 'Asia/Jakarta' });
  activities.data = [];
  activities.isPending = false;
  activities.isError = false;
  activities.hasNextPage = false;
  activities.isFetchingNextPage = false;
  activities.fetchNextPage.mockClear();
  meetings.data = [];
  meetings.isError = false;
  meetings.hasNextPage = false;
  meetings.isFetchingNextPage = false;
  meetings.fetchNextPage.mockClear();
  logActivity.mutateAsync.mockReset();
  logActivity.mutateAsync.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.useRealTimers();
  resetActiveLocale();
});

describe('ContactActivityPanel date logging', () => {
  it('saves the current instant when the selected date is today', async () => {
    vi.useFakeTimers();
    const now = new Date('2026-06-14T03:45:12.345Z');
    vi.setSystemTime(now);
    renderPanel();
    expect((screen.getByLabelText(/^date$/i) as HTMLInputElement).value)
      .toBe(formatCalendarDayInTimeZone(now, getActiveLocale().timezone));

    await submitLog('Follow-up call');

    expect(logActivity.mutateAsync).toHaveBeenCalledWith(expect.objectContaining({
      contact_id: 'ct1',
      subject: 'Follow-up call',
      occurred_at: '2026-06-14T03:45:12.345Z',
    }));
  });

  it('saves another selected date at its first zoned instant', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-14T03:45:12.345Z'));
    renderPanel();

    const dateField = screen.getByLabelText(/^date$/i) as HTMLInputElement;
    const today = formatCalendarDayInTimeZone(new Date(), getActiveLocale().timezone);
    const previousDay = new Date(`${today}T00:00:00.000Z`);
    previousDay.setUTCDate(previousDay.getUTCDate() - 1);
    const selectedDate = previousDay.toISOString().slice(0, 10);
    fireEvent.change(dateField, { target: { value: selectedDate } });
    await submitLog('Planning note');

    expect(logActivity.mutateAsync).toHaveBeenCalledWith(expect.objectContaining({
      contact_id: 'ct1',
      subject: 'Planning note',
      occurred_at: firstInstantOfZonedCalendarDay(selectedDate, getActiveLocale().timezone)?.toISOString(),
    }));
  });

  it('keeps two activities logged today newest-first by their actual instants', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-14T03:45:12.345Z'));
    const view = renderPanel();

    await submitLog('Earlier today');
    vi.setSystemTime(new Date('2026-06-14T03:46:12.345Z'));
    await submitLog('Later today');

    const firstInput = logActivity.mutateAsync.mock.calls[0]?.[0] as CrmActivityInput;
    const secondInput = logActivity.mutateAsync.mock.calls[1]?.[0] as CrmActivityInput;
    expect(firstInput.occurred_at).toBe('2026-06-14T03:45:12.345Z');
    expect(secondInput.occurred_at).toBe('2026-06-14T03:46:12.345Z');

    activities.data = [
      { id: 'earlier', contact_id: 'ct1', kind: 'Call', subject: 'Earlier today', body: null, occurred_at: firstInput.occurred_at },
      { id: 'later', contact_id: 'ct1', kind: 'Call', subject: 'Later today', body: null, occurred_at: secondInput.occurred_at },
    ];
    view.rerender(
      <ToastProvider>
        <MemoryRouter>
          <ContactActivityPanel contactId="ct1" canLog logFormOpen onLogFormOpenChange={vi.fn()} />
        </MemoryRouter>
      </ToastProvider>,
    );

    const entries = within(screen.getByTestId('activity-timeline')).getAllByRole('listitem');
    expect(entries[0]).toHaveTextContent('Later today');
    expect(entries[1]).toHaveTextContent('Earlier today');
  });
});
