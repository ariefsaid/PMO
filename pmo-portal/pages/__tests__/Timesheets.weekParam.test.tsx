import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router';
import React from 'react';
import type { TimesheetWithEntries } from '@/src/lib/db/timesheets';
import { ToastProvider } from '@/src/components/ui';
import { ImpersonationProvider } from '@/src/auth/impersonation';
import { formatDayRange } from '@/src/lib/format';
import Timesheets from '../Timesheets';

/**
 * R2 (ux/1110): the selected timesheet week is URL-owned (`?week=YYYY-MM-DD`) so stepping back
 * to a past week survives opening the approvals queue and pressing Back, or a refresh.
 */

// Pin the clock inside the week of Mon 2026-06-01 (Wed 3 Jun) so "this week" is deterministic.
const PINNED_NOW = new Date('2026-06-03T12:00:00');
beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(PINNED_NOW);
});
afterEach(() => {
  vi.useRealTimers();
});

const tsState: {
  data: TimesheetWithEntries[] | undefined;
  isPending: boolean;
  isError: boolean;
  refetch: ReturnType<typeof vi.fn>;
} = { data: [], isPending: false, isError: false, refetch: vi.fn() };
vi.mock('@/src/hooks/useTimesheets', () => ({ useTimesheets: () => tsState }));
vi.mock('@/src/auth/useAuth', () => ({
  useAuth: () => ({ currentUser: { id: 'u-alice', org_id: 'org-1' }, role: 'Project Manager' }),
}));
vi.mock('@/src/hooks/useTimesheetApproval', () => ({
  useTimesheetMutations: () => ({
    submit: { mutate: vi.fn(), isPending: false },
    reopen: { mutate: vi.fn(), isPending: false },
    approve: { mutate: vi.fn(), isPending: false },
    reject: { mutate: vi.fn(), isPending: false },
  }),
  useTimesheetsAwaitingApproval: () => ({ data: [], isPending: false, isError: false }),
  useOwnTimesheetPushState: () => ({ data: null, isPending: false, isError: false }),
}));
vi.mock('@/src/hooks/useTimesheetEntries', () => ({
  useTimesheetEntryMutations: () => ({
    saveWeek: { mutate: vi.fn(), mutateAsync: vi.fn().mockResolvedValue('ts-1'), isPending: false },
    deleteRow: { mutate: vi.fn(), isPending: false },
    isReconciling: false,
    retryDeleteRefresh: vi.fn(),
    reconciledDelete: null,
  }),
}));
vi.mock('@/src/hooks/useProjects', () => ({
  useProjectPickerOptions: () => ({ data: [], isPending: false, isError: false, refetch: vi.fn() }),
}));

const LocationProbe: React.FC = () => {
  const location = useLocation();
  return <div data-testid="location-probe" data-search={location.search} />;
};

const renderPage = (initialEntry = '/timesheets') =>
  render(
    <ImpersonationProvider realRole="Project Manager">
      <MemoryRouter initialEntries={[initialEntry]}>
        <ToastProvider>
          <LocationProbe />
          <Timesheets />
        </ToastProvider>
      </MemoryRouter>
    </ImpersonationProvider>,
  );

describe('R2 — the timesheet week lives in the URL', () => {
  it('a refresh of ?week=2026-05-18 reopens that week, not the current one', () => {
    renderPage('/timesheets?week=2026-05-18');
    // The toolbar names the deep-linked week (Mon 18 – Sun 24 May 2026).
    expect(screen.getByText(formatDayRange('2026-05-18', '2026-05-24'))).toBeInTheDocument();
    expect(screen.getByTestId('location-probe')).toHaveAttribute('data-search', '?week=2026-05-18');
  });

  it('stepping back a week writes ?week= into the URL', async () => {
    const user = userEvent.setup();
    renderPage('/timesheets');
    expect(screen.getByText(formatDayRange('2026-06-01', '2026-06-07'))).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Previous week' }));
    // The URL carries the stepped day (Wed 27 May, seven days before the pinned Wed 3 Jun);
    // any day in a week deep-links the same week, so the label is the week Mon 25 – Sun 31 May.
    expect(screen.getByTestId('location-probe')).toHaveAttribute('data-search', '?week=2026-05-27');
    expect(screen.getByText(formatDayRange('2026-05-25', '2026-05-31'))).toBeInTheDocument();
  });
});
