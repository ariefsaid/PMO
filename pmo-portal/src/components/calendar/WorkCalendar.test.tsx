import React from 'react';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import i18next from 'i18next';
import { WorkCalendar } from './WorkCalendar';
import idCalendar from '../../../public/locales/id/calendar.json';
import type { WorkTask } from '@/src/lib/calendar/workCalendar';

const task = (o: Partial<WorkTask> = {}): WorkTask => ({
  id: 't1', name: 'Pour slab', status: 'To Do', project_id: 'p1', project_name: 'Tower A',
  start_date: null, end_date: '2026-11-12', assignee_id: null, created_by: null, ...o,
});
const milestone = { id: 'm1', projectId: 'p1', name: 'Handover', targetDate: '2026-11-30' };

const dayCell = (y: number, m: number, d: number) =>
  document.querySelector<HTMLElement>(`[data-ec-day="${new Date(y, m, d).getTime()}"]`)!;

// Month bars live in a per-week overlay grid, not inside the day cell: read the day off the bar's
// grid column within its week row.
const chipOf = (title: string) => screen.getByText(title).closest('button')!;
const dayOf = (title: string): Date => {
  const chip = chipOf(title);
  const col = parseInt((chip.closest('[style*="grid-column"]') as HTMLElement).style.gridColumn, 10) - 1;
  const row = chip.closest('[data-slot=event-calendar-month-row]')!;
  return new Date(Number(row.querySelectorAll<HTMLElement>('[data-ec-day]')[col].dataset.ecDay));
};

// jsdom has no layout: lay the month cells out on a 7-column grid so the drag engine can hit-test.
let rectSpy: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  // jsdom has no Element.scrollTo (the time grid scrolls to "now" on mount)
  HTMLElement.prototype.scrollTo = vi.fn();
  rectSpy = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    const ms = this.dataset.ecDay;
    if (!ms) return new DOMRect(0, 0, 0, 0);
    const day = new Date(Number(ms));
    // Sunday-first grid anchored on 2026-11-01 (a Sunday) -> col = weekday, row = week index
    const idx = Math.round((day.getTime() - new Date(2026, 9, 25).getTime()) / 86_400_000);
    return new DOMRect((idx % 7) * 100, Math.floor(idx / 7) * 100, 100, 100);
  });
});
afterEach(() => { rectSpy.mockRestore(); vi.restoreAllMocks(); });

const renderCal = (over: Partial<React.ComponentProps<typeof WorkCalendar>> = {}) => {
  const props = {
    tasks: [task()], milestones: [milestone], canMoveTask: () => true,
    onMoveTask: vi.fn().mockResolvedValue(undefined), initialDate: new Date(2026, 10, 10), ...over,
  };
  return { ...render(<WorkCalendar {...props} />), props };
};

describe('WorkCalendar (#1982)', () => {
  it('shows a task on its due date and a milestone on its target date', () => {
    renderCal();
    expect(dayOf('Pour slab')).toEqual(new Date(2026, 10, 12));
    expect(dayOf('Handover')).toEqual(new Date(2026, 10, 30));
  });

  it('switches between month, week, day and agenda', () => {
    renderCal();
    for (const name of ['Week', 'Day', 'Agenda', 'Month']) {
      fireEvent.click(screen.getByRole('tab', { name }));
      expect(screen.getByRole('tab', { name })).toHaveAttribute('aria-selected', 'true');
    }
  });

  it('lists the due task in the agenda view', () => {
    renderCal({ initialDate: new Date(2026, 10, 12) });
    fireEvent.click(screen.getByRole('tab', { name: 'Agenda' }));
    expect(screen.getByText('Pour slab')).toBeInTheDocument();
  });

  it('prefixes the project name on the cross-project view', () => {
    renderCal({ withProject: true });
    expect(screen.getByText('Tower A · Pour slab')).toBeInTheDocument();
  });

  const drag = async (from: HTMLElement, to: HTMLElement) => {
    const at = (el: HTMLElement) => ({ clientX: Number(el.getBoundingClientRect().x) + 50, clientY: Number(el.getBoundingClientRect().y) + 50, pointerId: 1, button: 0 });
    const chip = chipOf('Pour slab');
    fireEvent.pointerDown(chip, { ...at(from), pointerType: 'mouse' });
    await act(async () => { fireEvent.pointerMove(window, { ...at(from), clientX: at(from).clientX + 30, pointerId: 1 }); });
    await act(async () => { fireEvent.pointerMove(window, { ...at(to), pointerId: 1 }); });
    await act(async () => { fireEvent.pointerUp(window, { ...at(to), pointerId: 1 }); });
  };

  it('AC-1982-drag: dropping a task on another day saves the new due date', async () => {
    const { props } = renderCal();
    await drag(dayCell(2026, 10, 12), dayCell(2026, 10, 18));
    expect(props.onMoveTask).toHaveBeenCalledTimes(1);
    expect(props.onMoveTask).toHaveBeenCalledWith(expect.objectContaining({ id: 't1' }), { end_date: '2026-11-18' });
    expect(dayOf('Pour slab')).toEqual(new Date(2026, 10, 18));
  });

  it('puts the task back and reports the error when the save fails', async () => {
    const onMoveError = vi.fn();
    const err = new Error('nope');
    renderCal({ onMoveTask: vi.fn().mockRejectedValue(err), onMoveError });
    await drag(dayCell(2026, 10, 12), dayCell(2026, 10, 18));
    await act(async () => { await Promise.resolve(); });
    expect(onMoveError).toHaveBeenCalledWith(err, expect.objectContaining({ id: 't1' }));
    expect(dayOf('Pour slab')).toEqual(new Date(2026, 10, 12));
  });

  it('AC-1982-readonly: a task the viewer may not edit cannot be dragged', async () => {
    const { props } = renderCal({ canMoveTask: () => false });
    await drag(dayCell(2026, 10, 12), dayCell(2026, 10, 18));
    expect(props.onMoveTask).not.toHaveBeenCalled();
    expect(dayOf('Pour slab')).toEqual(new Date(2026, 10, 12));
  });

  it('never drags a milestone', async () => {
    const { props } = renderCal();
    const chip = chipOf('Handover');
    fireEvent.pointerDown(chip, { clientX: 650, clientY: 450, pointerId: 1, button: 0, pointerType: 'mouse' });
    await act(async () => { fireEvent.pointerMove(window, { clientX: 150, clientY: 150, pointerId: 1 }); });
    await act(async () => { fireEvent.pointerUp(window, { clientX: 150, clientY: 150, pointerId: 1 }); });
    expect(props.onMoveTask).not.toHaveBeenCalled();
  });

  it('opens an item on click', () => {
    const onOpenItem = vi.fn();
    renderCal({ onOpenItem });
    // the calendar swallows clicks within 250ms of a drag ending (earlier tests drag)
    vi.spyOn(performance, 'now').mockReturnValue(performance.now() + 5000);
    fireEvent.click(chipOf('Pour slab'));
    expect(onOpenItem).toHaveBeenCalledWith(expect.objectContaining({ kind: 'task', id: 't1' }));
  });

  it('toolbar speaks Indonesian from the calendar namespace', async () => {
    i18next.addResourceBundle('id', 'calendar', idCalendar, true, true);
    await act(async () => { await i18next.changeLanguage('id'); });
    try {
      renderCal();
      expect(screen.getByRole('button', { name: 'Hari ini' })).toBeTruthy();
      expect(screen.getByRole('button', { name: 'Sebelumnya' })).toBeTruthy();
    } finally {
      await act(async () => { await i18next.changeLanguage('en'); });
    }
  });
});
