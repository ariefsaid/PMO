import { describe, expect, it } from 'vitest';
import { toWorkEvents, movedTaskDates, windowForRange, type WorkTask } from './workCalendar';

const task = (o: Partial<WorkTask> = {}): WorkTask => ({
  id: 't1', name: 'Pour slab', status: 'To Do', project_id: 'p1', project_name: 'Tower A',
  start_date: null, end_date: '2026-11-12', assignee_id: null, assignee_name: null, created_by: null, ...o,
});

describe('toWorkEvents (#1982)', () => {
  it('places a task on its due date as a one-day all-day event', () => {
    const [ev] = toWorkEvents([task()], []);
    expect(ev.allDay).toBe(true);
    expect(ev.start).toEqual(new Date(2026, 10, 12));
    expect(ev.end).toEqual(new Date(2026, 10, 13));
    expect(ev.data).toMatchObject({ kind: 'task', id: 't1', projectId: 'p1' });
  });  it('places a milestone on its target date, read-only', () => {
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

// C13 (DS calendar #4): a chip carries the facts its own record holds — whose task it is, and
// whether it is already past its due date. `today` is passed by the page (the org day), so this
// module stays clock-free and testable.
describe('toWorkEvents — C13 chip facts (DS calendar #4)', () => {
  it('names the assignee on the task chip', () => {
    const [ev] = toWorkEvents([task({ assignee_name: 'Sam Member' })], []);
    expect(ev.title).toBe('Pour slab · Sam Member');
  });

  it('keeps the project prefix in front of the name and puts the assignee last', () => {
    const [ev] = toWorkEvents([task({ assignee_name: 'Sam Member' })], [], () => false, { withProject: true });
    expect(ev.title).toBe('Tower A · Pour slab · Sam Member');
  });

  it('says a task is overdue once the org day is past its due date', () => {
    const [ev] = toWorkEvents([task()], [], () => false, { today: '2026-11-20', lateLabel: 'Overdue' });
    expect(ev.title).toBe('Overdue · Pour slab');
  });

  it('does not call a task due today overdue', () => {
    const [ev] = toWorkEvents([task()], [], () => false, { today: '2026-11-12', lateLabel: 'Overdue' });
    expect(ev.title).toBe('Pour slab');
  });

  it('leaves phases without owner or lateness words (a phase is not a task)', () => {
    const [ev] = toWorkEvents([], [{ id: 'm1', projectId: 'p1', name: 'Handover', targetDate: '2026-11-30' }], () => false, { today: '2026-12-31', lateLabel: 'Overdue' });
    expect(ev.title).toBe('Handover');
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
