/**
 * #1982 — the cross-project Calendar page: shows a task on its due date, opens on ?date=, and the
 * drag gate follows the real role's edit permission. REAL WorkCalendar; only hooks/auth are mocked.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import React from 'react';
import { ToastProvider } from '@/src/components/ui';
import { formatDay } from '@/src/lib/format';
import CalendarPage from '../Calendar';

const may = vi.fn(() => true);
const { moveTask } = vi.hoisted(() => ({ moveTask: vi.fn() }));
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
  useMoveCalendarTask: () => ({ mutateAsync: moveTask }),
}));

const renderPage = (url = '/calendar?date=2026-11-10') =>
  render(
    <MemoryRouter initialEntries={[url]}>
      <ToastProvider><CalendarPage /></ToastProvider>
    </MemoryRouter>,
  );

describe('Calendar page (#1982)', () => {
  beforeEach(() => {
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
