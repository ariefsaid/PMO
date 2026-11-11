import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import React from 'react';
import { ImpersonationProvider } from '@/src/auth/impersonation';
import { ToastProvider } from '@/src/components/ui';

vi.mock('@/src/auth/useAuth', () => ({
  useAuth: () => ({ currentUser: { id: 'u-self', org_id: 'org-1' }, role: 'Engineer' }),
}));

const { tasksState } = vi.hoisted(() => ({
  tasksState: {
    data: null as Array<Record<string, unknown>> | null,
    isPending: false,
    isError: false,
    refetch: vi.fn(),
  },
}));

vi.mock('@/src/hooks/useMyTasks', () => ({
  useMyTasks: () => tasksState,
  useMyTaskMutations: () => ({
    updateStatus: { mutate: vi.fn(), isPending: false },
  }),
}));

let mockActiveTimezone = 'Asia/Jakarta';
vi.mock('@/src/lib/locale/activeLocale', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/src/lib/locale/activeLocale')>();
  return {
    ...actual,
    getActiveLocale: () => ({
      ...actual.getActiveLocale(),
      timezone: mockActiveTimezone,
    }),
  };
});

import MyTasks from '../MyTasks';

const renderMyTasks = () =>
  render(
    <ImpersonationProvider realRole="Engineer">
      <MemoryRouter>
        <ToastProvider>
          <MyTasks />
        </ToastProvider>
      </MemoryRouter>
    </ImpersonationProvider>,
  );

describe('MyTasks timezone day rollover and overdue determination (PGA03-008)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockActiveTimezone = 'Asia/Jakarta'; // UTC+7
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('PGA03-008: determines overdue using resolved user timezone rather than UTC', () => {
    // 2026-10-28 18:00:00 UTC == 2026-10-29 01:00:00 in Asia/Jakarta (UTC+7)
    vi.setSystemTime(new Date('2026-10-28T18:00:00Z'));

    // Task due on 2026-10-28 is OVERDUE in Jakarta (it is Oct 29 locally),
    // but in UTC it is still Oct 28 (not past due).
    tasksState.data = [
      {
        id: 't-due-28',
        project_id: 'p-1',
        project_name: 'Solar Phase 1',
        name: 'Task due Oct 28',
        status: 'To Do',
        start_date: null,
        end_date: '2026-10-28',
      },
    ];

    renderMyTasks();

    // Must show the lateness flag because local date is 2026-10-29: exactly 1 day late
    // (in UTC it would still be due today, so no flag at all).
    expect(screen.getByTestId('my-task-late-status-t-due-28')).toHaveTextContent(/^1 day late$/i);
  });

  it('PGA03-008: updates overdue badges and sort order when midnight rolls over in user timezone', () => {
    // 2026-10-28 16:59:00 UTC == 2026-10-28 23:59:00 in Asia/Jakarta (1 minute before midnight)
    vi.setSystemTime(new Date('2026-10-28T16:59:00Z'));

    tasksState.data = [
      {
        id: 't-future',
        project_id: 'p-1',
        project_name: 'Solar Phase 1',
        name: 'Task future',
        status: 'To Do',
        start_date: null,
        end_date: '2026-10-30',
      },
      {
        id: 't-due-today',
        project_id: 'p-1',
        project_name: 'Solar Phase 1',
        name: 'Task due Oct 28',
        status: 'To Do',
        start_date: null,
        end_date: '2026-10-28',
      },
    ];

    renderMyTasks();

    // Before midnight: Task due Oct 28 is due today, so not late yet
    expect(screen.queryByText(/^[\d,]+ days? late$/i)).not.toBeInTheDocument();

    // Advance time by 2 minutes: now 2026-10-29 00:01:00 in Asia/Jakarta
    act(() => {
      vi.advanceTimersByTime(2 * 60 * 1000);
    });

    // After midnight: Task due Oct 28 is now late
    expect(screen.getByText(/^[\d,]+ days? late$/i)).toBeInTheDocument();

    // And it must sort first in urgency
    const overdueEl = screen.getByText('Task due Oct 28');
    const futureEl = screen.getByText('Task future');
    const order = overdueEl.compareDocumentPosition(futureEl);
    expect(order & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('updates the day boundary at the first real local time when midnight is skipped', () => {
    mockActiveTimezone = 'America/Santiago';
    // 03:59Z is 23:59 on Sept 7 in Santiago; the clock jumps to 01:00 at 04:00Z.
    vi.setSystemTime(new Date('2024-09-08T03:59:00Z'));
    tasksState.data = [
      {
        id: 't-due-yesterday',
        project_id: 'p-1',
        project_name: 'Solar Phase 1',
        name: 'Task due yesterday',
        status: 'To Do',
        start_date: null,
        end_date: '2024-09-07',
      },
    ];

    renderMyTasks();
    expect(screen.queryByText(/^[\d,]+ days? late$/i)).not.toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(61 * 1000);
    });

    expect(screen.getByTestId('my-task-late-status-t-due-yesterday')).toHaveTextContent(/^1 day late$/i);
  });
});
