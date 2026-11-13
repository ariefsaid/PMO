/**
 * #1982 — the cross-project Calendar page: shows a task on its due date, opens on ?date=, and the
 * drag gate follows the real role's edit permission. REAL WorkCalendar; only hooks/auth are mocked.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router';
import React from 'react';
import { ToastProvider } from '@/src/components/ui';
import { formatDay } from '@/src/lib/format';
import CalendarPage from '../Calendar';
import type { CalendarTask } from '@/src/lib/db/tasks';

const may = vi.fn(() => true);
const { moveTask, calendarState } = vi.hoisted(() => {
  /** One calendar task fixture — typed, so a test may vary any field (owner, project, dates). */
  type TaskFixture = Omit<CalendarTask, 'status'> & { status: string };
  const baseTask: TaskFixture = {
    id: 't1', name: 'Pour slab', status: 'To Do', project_id: 'p1', project_name: 'Tower A',
    start_date: null, end_date: '2026-11-12', assignee_id: null, assignee_name: null, created_by: null,
  };
  return {
    moveTask: vi.fn(),
    calendarState: {
      tasks: [baseTask] as TaskFixture[],
      milestones: [{ id: 'm1', projectId: 'p1', name: 'Handover', targetDate: '2026-11-30' }] as Array<{ id: string; projectId: string; name: string; targetDate: string }>,
      milestonesError: false,
      projectsError: false,
      today: '2026-11-10',
      refetch: vi.fn(),
      tasksError: false,
      tasksFetching: false,
      /** Every argument `useCalendarTasks` was rendered with, so a test can count the request keys. */
      taskWindows: [] as Array<{ from: string; to: string } | null>,
    },
  };
});
vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: { id: 'u1', org_id: 'o1' } }) }));
vi.mock('@/src/auth/usePermission', () => ({ usePermission: () => may }));
vi.mock('@/src/hooks/useOwnershipCacheSync', () => ({ useOwnershipCacheSynced: () => true }));
// The org day drives the C13 lateness fact; pinned per test so the marker is deterministic.
vi.mock('@/src/hooks/useOrgToday', () => ({ useOrgToday: () => calendarState.today }));
vi.mock('@/src/lib/adapterSeam/ownershipCache', () => ({ routeTaskWrite: () => 'internal' }));
vi.mock('@/src/hooks/useProjects', () => ({
  useProjects: () => ({ data: calendarState.projectsError ? undefined : [{ id: 'p1' }], isError: calendarState.projectsError, isPending: false, isFetching: false, refetch: calendarState.refetch }),
  useProjectsMilestoneDates: () => ({
    data: calendarState.milestonesError ? undefined : calendarState.milestones,
    isError: calendarState.milestonesError,
    isPending: false,
    isFetching: false,
    refetch: calendarState.refetch,
  }),
}));
vi.mock('@/src/hooks/useWorkCalendar', () => ({
  useCalendarTasks: (window: { from: string; to: string } | null) => {
    calendarState.taskWindows.push(window);
    return {
      data: calendarState.tasksError ? undefined : calendarState.tasks,
      isError: calendarState.tasksError,
      isFetching: calendarState.tasksFetching,
      refetch: calendarState.refetch,
    };
  },
  useMoveCalendarTask: () => ({ mutateAsync: moveTask }),
}));

// The page navigates with the REAL router (the chip/toolbar journeys below assert the resulting
// URL), so a sibling probe reads `useLocation()`.
const LocationProbe: React.FC = () => {
  const location = useLocation();
  // A <div>, not <output>: <output> carries the implicit status role, which would collide with the
  // toast announcement the older move-saves test asserts on.
  return <div data-testid="location-probe" data-search={location.search}>{location.pathname}</div>;
};

const renderPage = (url = '/calendar?date=2026-11-10') =>
  render(
    <MemoryRouter initialEntries={[url]}>
      <ToastProvider><LocationProbe /><CalendarPage /></ToastProvider>
    </MemoryRouter>,
  );

/** Per-test reset of the read state + the request log (a stale refetch would hide a new request). */
const resetReads = () => {
  calendarState.tasksError = false;
  calendarState.tasksFetching = false;
  calendarState.taskWindows.length = 0;
  calendarState.refetch.mockClear();
};

/** The distinct task-read keys the page asked for (one key = one request). */
const taskWindowKeys = () => new Set(
  calendarState.taskWindows
    .filter((window): window is { from: string; to: string } => window !== null)
    .map((window) => `${window.from}..${window.to}`),
);

describe('Calendar page (#1982)', () => {
  beforeEach(() => {
    calendarState.tasks = [{
      id: 't1', name: 'Pour slab', status: 'To Do', project_id: 'p1', project_name: 'Tower A',
      start_date: null, end_date: '2026-11-12', assignee_id: null, assignee_name: null, created_by: null,
    }];
    calendarState.milestones = [{ id: 'm1', projectId: 'p1', name: 'Handover', targetDate: '2026-11-30' }];
    calendarState.milestonesError = false;
    calendarState.projectsError = false;
    calendarState.today = '2026-11-10';
    resetReads();
    HTMLElement.prototype.scrollTo = vi.fn();
    may.mockReturnValue(true);
    moveTask.mockReset().mockResolvedValue(undefined);
  });

  it('opens on ?date= and shows the task (with project) and the milestone', () => {
    renderPage();
    expect(screen.getByRole('heading', { name: 'Calendar' })).toBeInTheDocument();
    expect(screen.getByText('Tower A · Pour slab')).toBeInTheDocument();
    expect(screen.getByText('Handover')).toBeInTheDocument();
  });

  it('asks the real-role edit gate for the task before it can be dragged', () => {
    may.mockReturnValue(false);
    renderPage();
    expect(screen.getByText('Tower A · Pour slab')).toBeInTheDocument();
    expect(may).toHaveBeenCalledWith('edit', 'task', expect.objectContaining({ currentUserId: 'u1' }));
  });

  it('C2 Calendar.tsx:60-69 announces the new due date after the confirmed move saves', async () => {
    const dayCell = (day: number) => document.querySelector<HTMLElement>(`[data-ec-day="${new Date(2026, 10, day).getTime()}"]`)!;
    const rectSpy = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      const ms = this.dataset.ecDay;
      if (!ms) return new DOMRect(0, 0, 0, 0);
      const day = new Date(Number(ms));
      const idx = Math.round((day.getTime() - new Date(2026, 9, 25).getTime()) / 86_400_000);
      return new DOMRect((idx % 7) * 100, Math.floor(idx / 7) * 100, 100, 100);
    });
    try {
      renderPage();
      const at = (el: HTMLElement) => ({ clientX: Number(el.getBoundingClientRect().x) + 50, clientY: Number(el.getBoundingClientRect().y) + 50, pointerId: 1, button: 0 });
      const chip = screen.getByText('Tower A · Pour slab').closest('button')!;
      fireEvent.pointerDown(chip, { ...at(dayCell(12)), pointerType: 'mouse' });
      await act(async () => { fireEvent.pointerMove(window, { ...at(dayCell(12)), clientX: at(dayCell(12)).clientX + 30, pointerId: 1 }); });
      await act(async () => { fireEvent.pointerMove(window, { ...at(dayCell(18)), pointerId: 1 }); });
      await act(async () => { fireEvent.pointerUp(window, { ...at(dayCell(18)), pointerId: 1 }); });

      const dialog = await screen.findByRole('dialog', { name: 'Move task due date?' });
      fireEvent.click(within(dialog).getByRole('button', { name: 'Move task' }));
      await waitFor(() => expect(moveTask).toHaveBeenCalledWith({
        task: expect.objectContaining({ id: 't1' }),
        patch: { end_date: '2026-11-18' },
      }));
      expect(await screen.findByRole('status')).toHaveTextContent(`Task due date updated Pour slab is now due ${formatDay('2026-11-18')}.`);
    } finally {
      rectSpy.mockRestore();
    }
  });
});

// Floor (all-screens/floor-tests/calendar.md items 2, 7-10): the toolbar navigates the period, and
// a chip is a doorway to its project — including for a read-only viewer (drag off, open still on).
// C5 (DS calendar #1 / #3): the calendar may not look complete when a read failed or when work
// without a due date exists — both are stated.
describe('Calendar — C5 unknown never shown as nothing', () => {
  beforeEach(() => {
    resetReads();
    HTMLElement.prototype.scrollTo = vi.fn();
    may.mockReturnValue(true);
  });

  it('a failed phase read is named with a retry, not painted as a calendar with no phases', async () => {
    calendarState.milestonesError = true;
    renderPage();
    expect(screen.getByText(/Phases could not be loaded/i)).toBeInTheDocument();
    expect(screen.queryByText('Handover')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(calendarState.refetch).toHaveBeenCalled());
  });

  it('a failed project read is named too — the phases hang off that read', () => {
    calendarState.projectsError = true;
    renderPage();
    expect(screen.getByText(/Phases could not be loaded/i)).toBeInTheDocument();
  });

  it('says which work it cannot show, so the month does not read as the whole plan', () => {
    renderPage();
    expect(screen.getByText(/Tasks with no due date are not on the calendar/i)).toBeInTheDocument();
  });

  it('C13: the chip names whose task it is and marks one that is past its due date', () => {
    calendarState.tasks = [{
      id: 't1', name: 'Pour slab', status: 'To Do', project_id: 'p1', project_name: 'Tower A',
      start_date: null, end_date: '2026-11-12', assignee_id: 'u2', assignee_name: 'Sam Member', created_by: 'u1',
    }];
    calendarState.today = '2026-11-20';
    renderPage();
    expect(screen.getByText('Overdue · Tower A · Pour slab · Sam Member')).toBeInTheDocument();
  });
});

describe('Calendar — floor: toolbar and chip journeys (floor-tests/calendar.md 2, 7-10)', () => {
  beforeEach(() => {
    calendarState.tasks = [{
      id: 't1', name: 'Pour slab', status: 'To Do', project_id: 'p1', project_name: 'Tower A',
      start_date: null, end_date: '2026-11-12', assignee_id: null, assignee_name: null, created_by: null,
    }];
    calendarState.milestones = [{ id: 'm1', projectId: 'p1', name: 'Handover', targetDate: '2026-11-30' }];
    calendarState.milestonesError = false;
    calendarState.projectsError = false;
    calendarState.today = '2026-11-10';
    resetReads();
    HTMLElement.prototype.scrollTo = vi.fn();
    may.mockReturnValue(true);
    moveTask.mockReset().mockResolvedValue(undefined);
  });

  const periodTitle = () => screen.getByTestId('work-calendar-toolbar').querySelector('h2')!;
  const chip = (text: string) => screen.getByText(text).closest('button')!;

  it('floor 2: Today / Previous / Next move the displayed period', async () => {
    renderPage();
    expect(periodTitle()).toHaveTextContent('November 2026');

    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    await waitFor(() => expect(periodTitle()).toHaveTextContent('December 2026'));

    fireEvent.click(screen.getByRole('button', { name: 'Previous' }));
    await waitFor(() => expect(periodTitle()).toHaveTextContent('November 2026'));
    fireEvent.click(screen.getByRole('button', { name: 'Previous' }));
    await waitFor(() => expect(periodTitle()).toHaveTextContent('October 2026'));

    const today = new Intl.DateTimeFormat('en', { month: 'long', year: 'numeric' }).format(new Date());
    fireEvent.click(screen.getByRole('button', { name: 'Today' }));
    await waitFor(() => expect(periodTitle()).toHaveTextContent(today));
  });

  it('floor 7: a task chip opens the project Tasks route with ?open=', async () => {
    renderPage();
    fireEvent.click(chip('Tower A · Pour slab'));
    const probe = screen.getByTestId('location-probe');
    expect(probe).toHaveTextContent('/projects/p1/tasks');
    expect(probe.dataset.search).toBe('?open=t1');
  });

  it('floor 8: a milestone chip opens the project timeline', async () => {
    renderPage();
    fireEvent.click(chip('Handover'));
    const probe = screen.getByTestId('location-probe');
    expect(probe).toHaveTextContent('/projects/p1/tasks');
    expect(probe.dataset.search).toBe('?view=timeline');
  });

  it('floor 9: a task chip with no project does nothing (there is nowhere to go)', () => {
    calendarState.tasks = [{
      id: 't2', name: 'Book the crane', status: 'To Do', project_id: null, project_name: null,
      start_date: null, end_date: '2026-11-12', assignee_id: null, assignee_name: null, created_by: null,
    }];
    renderPage();
    fireEvent.click(chip('Book the crane'));
    const probe = screen.getByTestId('location-probe');
    expect(probe).toHaveTextContent('/calendar');
    expect(probe.dataset.search).toBe('?date=2026-11-10');
  });

  it('floor 10: a read-only viewer still opens a task from the calendar (drag is what is denied)', async () => {
    may.mockReturnValue(false);
    renderPage();
    fireEvent.click(chip('Tower A · Pour slab'));
    const probe = screen.getByTestId('location-probe');
    expect(probe).toHaveTextContent('/projects/p1/tasks');
    expect(probe.dataset.search).toBe('?open=t1');
  });
});

// Move 1 (judging calendar.md #1): an empty month says so in one line and links to where the plan
// is readable; a failed read says so with a Retry that re-runs the SAME read (no second request).
describe('Calendar — move 1: an empty month says so, a failed read retries', () => {
  beforeEach(() => {
    calendarState.tasks = [];
    calendarState.milestones = [];
    calendarState.milestonesError = false;
    calendarState.projectsError = false;
    calendarState.today = '2026-11-10';
    resetReads();
    HTMLElement.prototype.scrollTo = vi.fn();
    may.mockReturnValue(true);
    moveTask.mockReset().mockResolvedValue(undefined);
  });

  it('names the empty month and offers the list where every task lives', () => {
    renderPage();
    expect(screen.getByText('No tasks or milestones due in November 2026')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'My Tasks' })).toHaveAttribute('href', '/my-tasks');
  });

  it('does not claim emptiness while the window read is still in flight', () => {
    calendarState.tasksFetching = true;
    renderPage();
    expect(screen.queryByText(/No tasks or milestones due/)).not.toBeInTheDocument();
  });

  it('does not claim emptiness when the phase read failed (that warning already speaks)', () => {
    calendarState.projectsError = true;
    renderPage();
    expect(screen.getByText(/Phases could not be loaded/i)).toBeInTheDocument();
    expect(screen.queryByText(/No tasks or milestones due/)).not.toBeInTheDocument();
  });

  it('shows nothing once the month holds an item', () => {
    calendarState.tasks = [{
      id: 't1', name: 'Pour slab', status: 'To Do', project_id: 'p1', project_name: 'Tower A',
      start_date: null, end_date: '2026-11-12', assignee_id: null, assignee_name: null, created_by: null,
    }];
    renderPage();
    expect(screen.queryByText(/No tasks or milestones due/)).not.toBeInTheDocument();
  });

  it('reads the visible window once on a normal load and adds no request', () => {
    renderPage();
    expect(taskWindowKeys().size).toBe(1);
    expect(calendarState.refetch).not.toHaveBeenCalled();
  });

  it('a failed read offers Retry, which re-runs the same read', () => {
    calendarState.tasksError = true;
    renderPage();
    expect(screen.getByText('Could not load the calendar')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(calendarState.refetch).toHaveBeenCalledTimes(1);
    // the retry re-runs the one read already asked for; it never opens a second window
    expect(taskWindowKeys().size).toBe(1);
  });
});

// Move 2 (judging calendar.md #2): the calendar states its scope — meetings are not on it, and it
// reads none (one line, no new read).
describe('Calendar — move 2: the scope says what is not on this calendar', () => {
  beforeEach(() => {
    resetReads();
    HTMLElement.prototype.scrollTo = vi.fn();
    may.mockReturnValue(true);
  });

  it('says meetings are not on this calendar', () => {
    renderPage();
    expect(screen.getByText('Tasks and milestones only — meetings are not on this calendar.')).toBeInTheDocument();
  });
});

// Move 3 (judging calendar.md #3): the day number leads the cell (top-left, so position and reading
// order agree) and today is a ring around the number, exposed as the current date, not colour alone.
describe('Calendar — move 3: the day number leads the cell, today is marked', () => {
  beforeEach(() => {
    // the grid's own "today" reads the clock; pin it so the marker is deterministic
    vi.useFakeTimers({ toFake: ['Date'], now: new Date(2026, 10, 10, 9, 0, 0) });
    calendarState.tasks = [{
      id: 't1', name: 'Pour slab', status: 'To Do', project_id: 'p1', project_name: 'Tower A',
      start_date: null, end_date: '2026-11-12', assignee_id: null, assignee_name: null, created_by: null,
    }];
    calendarState.milestones = [{ id: 'm1', projectId: 'p1', name: 'Handover', targetDate: '2026-11-30' }];
    calendarState.milestonesError = false;
    calendarState.projectsError = false;
    resetReads();
    HTMLElement.prototype.scrollTo = vi.fn();
    may.mockReturnValue(true);
    moveTask.mockReset().mockResolvedValue(undefined);
  });
  afterEach(() => { vi.useRealTimers(); });

  const cellFor = (day: number) =>
    document.querySelector<HTMLElement>(`[data-ec-day="${new Date(2026, 10, day).getTime()}"]`)!;
  const dayNumber = (day: number) =>
    cellFor(day).querySelector<HTMLElement>('[data-slot="event-calendar-month-day-number"]')!;

  it('puts the day number first in the cell, before the day it is', () => {
    renderPage();
    expect(cellFor(12).firstElementChild).toBe(dayNumber(12).parentElement);
  });

  it('marks today as the current date on its day number', () => {
    renderPage();
    expect(cellFor(10)).toHaveAttribute('data-today');
    expect(dayNumber(10)).toHaveAttribute('aria-current', 'date');
    expect(dayNumber(11)).not.toHaveAttribute('aria-current');
  });
});

