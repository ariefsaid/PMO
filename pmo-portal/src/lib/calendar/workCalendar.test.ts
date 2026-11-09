import { describe, expect, it } from 'vitest';
import { toWorkEvents, movedTaskDates, windowForRange, type WorkTask } from './workCalendar';

const task = (o: Partial<WorkTask> = {}): WorkTask => ({
  id: 't1', name: 'Pour slab', status: 'To Do', project_id: 'p1', project_name: 'Tower A',
  start_date: null, end_date: '2026-11-12', assignee_id: null, created_by: null, ...o,
});

describe('toWorkEvents (#1982)', () => {
  it('places a task on its due date as a one-day all-day event', () => {
    const [ev] = toWorkEvents([task()], []);
    expect(ev.allDay).toBe(true);
    expect(ev.start).toEqual(new Date(2026, 10, 12));
    expect(ev.end).toEqual(new Date(2026, 10, 13));
    expect(ev.data).toMatchObject({ kind: 'task', id: 't1', projectId: 'p1' });
  });
  it('places a milestone on its target date, read-only', () => {
    const [ev] = toWorkEvents([], [{ id: 'm1', projectId: 'p1', name: 'Handover', targetDate: '2026-11-30' }]);
    expect(ev.start).toEqual(new Date(2026, 10, 30));
    expect(ev.readOnly).toBe(true);
    expect(ev.data).toMatchObject({ kind: 'milestone', id: 'm1' });
  });
  it('marks a task draggable only when the caller allows it', () => {
    const [yes] = toWorkEvents([task()], [], () => true);
    const [no] = toWorkEvents([task()], [], () => false);
    expect(yes.readOnly).toBe(false);
    expect(no.readOnly).toBe(true);
  });
  it('prefixes a task title with its project when asked (cross-project view)', () => {
    const [ev] = toWorkEvents([task()], [], () => true, { withProject: true });
    expect(ev.title).toBe('Tower A · Pour slab');
  });
});

describe('movedTaskDates', () => {
  it('moves the due date', () => {
    expect(movedTaskDates(task(), new Date(2026, 10, 20))).toEqual({ end_date: '2026-11-20' });
  });
  it('shifts the start by the same distance so the duration is kept', () => {
    expect(movedTaskDates(task({ start_date: '2026-11-10' }), new Date(2026, 10, 20)))
      .toEqual({ start_date: '2026-11-18', end_date: '2026-11-20' });
  });
});

describe('windowForRange', () => {
  it('turns the visible range into a [from, to) ISO window', () => {
    expect(windowForRange({ start: new Date(2026, 9, 26), end: new Date(2026, 11, 7) }))
      .toEqual({ from: '2026-10-26', to: '2026-12-07' });
  });
});
