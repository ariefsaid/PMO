import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import React from 'react';
import { setActiveLocale, resetActiveLocale } from '@/src/lib/locale/activeLocale';

vi.mock('@/src/auth/useAuth', () => ({
  useAuth: () => ({ currentUser: { id: 'u-self', org_id: 'org-1' }, role: 'Project Manager' }),
}));

const { tasksState } = vi.hoisted(() => ({
  tasksState: {
    data: null as Array<Record<string, unknown>> | null,
    isPending: false,
    isError: false,
    refetch: vi.fn(),
  },
}));

vi.mock('@/src/hooks/useTasks', () => ({
  useTasks: () => tasksState,
}));

/**
 * #2088 (WIG, Locale & i18n) — "My open tasks" must decide "overdue" against the ORG's day
 * (`useOrgToday`), never the UTC day: between 00:00 and 07:00 in UTC+7 the UTC day is still
 * yesterday, so a task due today would wrongly not count (and one due yesterday would hide).
 */
import { MyOpenTasks } from '../ProjectActivity';

describe('#2088 MyOpenTasks — overdue is decided by the organization day', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    tasksState.data = null;
  });

  afterEach(() => {
    vi.useRealTimers();
    resetActiveLocale();
  });

  it('#2088: a task due on the org day before the UTC day is overdue even though UTC still says today', () => {
    // 2026-06-01 20:00 UTC == 2026-06-02 03:00 in Asia/Jakarta: org day is Jun 2, UTC day Jun 1.
    vi.setSystemTime(new Date('2026-06-01T20:00:00Z'));
    setActiveLocale({ locale: 'en', numberLocale: 'en-US', timezone: 'Asia/Jakarta' });
    tasksState.data = [
      {
        id: 't1', project_id: 'p1', name: 'Pour the slab', status: 'To Do', assignee_id: 'u-self',
        start_date: null, end_date: '2026-06-01', dependencies: [], assignee: null,
      },
    ];
    render(
      <MemoryRouter>
        <MyOpenTasks projectId="p1" />
      </MemoryRouter>,
    );

    // Org day (Jun 2) is past the Jun 1 due date → overdue by one day.
    // The old UTC day (Jun 1) would render the task as merely "due today" with no flag.
    expect(screen.getByText(/Overdue · 1 days/i)).toBeInTheDocument();
  });

  it('#2088: a task due on the org today is not yet overdue', () => {
    vi.setSystemTime(new Date('2026-06-01T20:00:00Z'));
    setActiveLocale({ locale: 'en', numberLocale: 'en-US', timezone: 'Asia/Jakarta' });
    tasksState.data = [
      {
        id: 't2', project_id: 'p1', name: 'Mob the crew', status: 'To Do', assignee_id: 'u-self',
        start_date: null, end_date: '2026-06-02', dependencies: [], assignee: null,
      },
    ];
    render(
      <MemoryRouter>
        <MyOpenTasks projectId="p1" />
      </MemoryRouter>,
    );

    expect(screen.queryByText(/Overdue ·/i)).not.toBeInTheDocument();
  });
});
