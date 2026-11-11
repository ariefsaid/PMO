/**
 * #1982 — the cross-project Calendar page: shows a task on its due date, opens on ?date=, and the
 * drag gate follows the real role's edit permission. REAL WorkCalendar; only hooks/auth are mocked.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import React from 'react';
import { ToastProvider } from '@/src/components/ui';
import CalendarPage from '../Calendar';

const may = vi.fn(() => true);
vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: { id: 'u1', org_id: 'o1' } }) }));
vi.mock('@/src/auth/usePermission', () => ({ usePermission: () => may }));
vi.mock('@/src/hooks/useOwnershipCacheSync', () => ({ useOwnershipCacheSynced: () => true }));
vi.mock('@/src/lib/adapterSeam/ownershipCache', () => ({ routeTaskWrite: () => 'internal' }));
vi.mock('@/src/hooks/useProjects', () => ({
  useProjects: () => ({ data: [{ id: 'p1' }] }),
  useProjectsMilestoneDates: () => ({
    data: [{ id: 'm1', projectId: 'p1', name: 'Handover', targetDate: '2026-11-30' }],
  }),
}));
const task = {
  id: 't1', name: 'Pour slab', status: 'To Do', project_id: 'p1', project_name: 'Tower A',
  start_date: null, end_date: '2026-11-12', assignee_id: null, created_by: null,
};
vi.mock('@/src/hooks/useWorkCalendar', () => ({
  useCalendarTasks: () => ({ data: [task], isError: false, isFetching: false, refetch: vi.fn() }),
  useMoveCalendarTask: () => ({ mutateAsync: vi.fn() }),
}));

const renderPage = (url = '/calendar?date=2026-11-10') =>
  render(
    <MemoryRouter initialEntries={[url]}>
      <ToastProvider><CalendarPage /></ToastProvider>
    </MemoryRouter>,
  );

describe('Calendar page (#1982)', () => {
  beforeEach(() => { HTMLElement.prototype.scrollTo = vi.fn(); may.mockReturnValue(true); });

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
});
