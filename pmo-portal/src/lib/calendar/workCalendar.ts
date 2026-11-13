/**
 * Maps tasks (by due date) and milestones (by target date) onto the ReUI event calendar's
 * all-day events. Dates are `YYYY-MM-DD` calendar days parsed LOCAL (no UTC shift), which is the
 * calendar's display zone, so an item never lands on the neighbouring day.
 */
import { addDays } from 'date-fns/addDays';
import { differenceInCalendarDays } from 'date-fns/differenceInCalendarDays';
import type { CalendarEvent, EventCalendarDateRange } from '@/src/components/reui/event-calendar/event-calendar-types';
import type { CalendarTask, TaskPatch } from '@/src/lib/db/tasks';
import type { MilestoneDate } from '@/src/lib/db/milestones';
import { parseLocalDate, toIso } from './monthMatrix';

export type WorkTask = CalendarTask;

export type WorkItem =
  | { kind: 'task'; id: string; projectId: string | null; task: WorkTask }
  | { kind: 'milestone'; id: string; projectId: string; task?: undefined };

const TASK_DONE = 'Done';

/**
 * C13 (DS calendar #4): a chip's own text carries the facts its record holds. `today` (the org
 * day, 'YYYY-MM-DD') and `lateLabel` are supplied by the page so this module stays clock-free;
 * without them the title is the plain name/project it always was.
 */
export interface WorkEventOptions {
  withProject?: boolean;
  /** The org day ('YYYY-MM-DD'). Passed by the page; absent = no lateness is claimed. */
  today?: string;
  /** Localised word for a past-due task (e.g. "Overdue"). Required to render the marker. */
  lateLabel?: string;
}

export function toWorkEvents(
  tasks: readonly WorkTask[],
  milestones: readonly MilestoneDate[],
  canMove: (task: WorkTask) => boolean = () => false,
  opts: WorkEventOptions = {},
): CalendarEvent<WorkItem>[] {
  const taskEvents = tasks.map((task): CalendarEvent<WorkItem> => {
    const start = parseLocalDate(task.end_date);
    const late = Boolean(opts.today && opts.lateLabel && task.status !== TASK_DONE && task.end_date < opts.today);
    const title = [
      ...(late ? [opts.lateLabel!] : []),
      opts.withProject && task.project_name ? `${task.project_name} · ${task.name}` : task.name,
      ...(task.assignee_name ? [task.assignee_name] : []),
    ].join(' · ');
    return {
      id: `task:${task.id}`,
      title,
      start,
      end: addDays(start, 1),
      allDay: true,
      readOnly: !canMove(task),
      color: task.status === TASK_DONE ? 'var(--color-muted-foreground)' : 'var(--color-primary)',
      data: { kind: 'task', id: task.id, projectId: task.project_id, task },
    };
  });
  const milestoneEvents = milestones.map((m): CalendarEvent<WorkItem> => {
    const start = parseLocalDate(m.targetDate);
    return {
      id: `milestone:${m.id}`,
      title: m.name,
      start,
      end: addDays(start, 1),
      allDay: true,
      readOnly: true,
      priority: 1,
      color: 'var(--color-warning)',
      data: { kind: 'milestone', id: m.id, projectId: m.projectId },
    };
  });
  return [...milestoneEvents, ...taskEvents];
}

/** The patch for dropping `task` on `day`: due date moves; a start date shifts by the same distance. */
export function movedTaskDates(task: WorkTask, day: Date): Pick<TaskPatch, 'start_date' | 'end_date'> {
  const delta = differenceInCalendarDays(day, parseLocalDate(task.end_date));
  const end_date = toIso(day);
  if (!task.start_date) return { end_date };
  return { start_date: toIso(addDays(parseLocalDate(task.start_date), delta)), end_date };
}

/** The calendar's half-open visible range as a `[from, to)` ISO-date window for the task read. */
export function windowForRange(range: EventCalendarDateRange): { from: string; to: string } {
  return { from: toIso(range.start), to: toIso(range.end) };
}
