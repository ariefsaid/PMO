/**
 * Month / week / day / agenda calendar of tasks (by due date) and milestones (by target date),
 * on the vendored ReUI event calendar (#1982). Presentational: the host owns the reads, the
 * permission answer (`canMoveTask`) and the save (`onMoveTask`). Milestones are never draggable
 * (their date is edited on the milestone, not here); a task is draggable only when `canMoveTask`.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  EventCalendar,
  useEventCalendarNavigation,
  useEventCalendarView,
} from '@/src/components/reui/event-calendar/event-calendar';
import { EventCalendarContent } from '@/src/components/reui/event-calendar/event-calendar-content';
import type {
  CalendarEvent,
  CalendarView,
  EventCalendarOccurrence,
  EventCalendarProposedUpdate,
  EventCalendarRangeInfo,
} from '@/src/components/reui/event-calendar/event-calendar-types';
import { Button, ViewToggle } from '@/src/components/ui';
import { getDateFnsLocale } from '@/src/lib/locale/activeLocale';
import type { MilestoneDate } from '@/src/lib/db/milestones';
import type { TaskPatch } from '@/src/lib/db/tasks';
import { movedTaskDates, toWorkEvents, windowForRange, type WorkItem, type WorkTask } from '@/src/lib/calendar/workCalendar';

type WorkView = Extract<CalendarView, 'month' | 'week' | 'day' | 'agenda'>;
const VIEWS: WorkView[] = ['month', 'week', 'day', 'agenda'];

export interface WorkCalendarProps {
  tasks: readonly WorkTask[];
  milestones: readonly MilestoneDate[];
  loading?: boolean;
  /** Month/week to open on (default: today). */
  initialDate?: Date;
  /** Prefix task titles with their project (the cross-project view). */
  withProject?: boolean;
  /** The real-role edit answer for ONE task (same gate as the edit form). Read-only roles get false. */
  canMoveTask: (task: WorkTask) => boolean;
  /** Persist a moved task; reject to revert the drop. */
  onMoveTask: (task: WorkTask, patch: Pick<TaskPatch, 'start_date' | 'end_date'>) => Promise<unknown>;
  /** Fires with the visible `[from, to)` window on mount and whenever the user navigates. */
  onWindowChange?: (window: { from: string; to: string }) => void;
  onOpenItem?: (item: WorkItem) => void;
  /** Surface a failed save (the host classifies the error). */
  onMoveError?: (err: unknown, task: WorkTask) => void;
  /** Called after a drag that the viewer may not make. */
  onMoveBlocked?: () => void;
}

const Toolbar: React.FC = () => {
  const { t } = useTranslation('calendar');
  const { title, next, prev, today } = useEventCalendarNavigation();
  const { view, setView } = useEventCalendarView();
  return (
    <div className="mb-3 flex flex-wrap items-center gap-2" data-testid="work-calendar-toolbar">
      <div className="flex items-center gap-1">
        <Button variant="outline" size="sm" onClick={today}>{t('today', 'Today')}</Button>
        <Button variant="outline" iconOnly aria-label={t('previous', 'Previous')} onClick={prev}>‹</Button>
        <Button variant="outline" iconOnly aria-label={t('next', 'Next')} onClick={next}>›</Button>
      </div>
      <h2 className="min-w-0 flex-1 truncate text-base font-semibold text-foreground" aria-live="polite">{title}</h2>
      <ViewToggle<WorkView>
        ariaLabel={t('viewAria', 'Calendar view')}
        value={VIEWS.includes(view as WorkView) ? (view as WorkView) : 'month'}
        onChange={(next) => setView(next)}
        options={[
          { value: 'month', label: t('view.month', 'Month') },
          { value: 'week', label: t('view.week', 'Week') },
          { value: 'day', label: t('view.day', 'Day') },
          { value: 'agenda', label: t('view.agenda', 'Agenda') },
        ]}
      />
    </div>
  );
};

export const WorkCalendar: React.FC<WorkCalendarProps> = ({
  tasks, milestones, loading, initialDate, withProject, canMoveTask, onMoveTask, onWindowChange, onOpenItem, onMoveError, onMoveBlocked,
}) => {
  const { t } = useTranslation('calendar');
  // A dropped task shows on its new day at once; the host's refetch (new `tasks`) or a failed save clears it.
  const [moved, setMoved] = useState<Record<string, WorkTask>>({});
  useEffect(() => setMoved({}), [tasks]);

  const shown = useMemo(() => tasks.map((task) => moved[task.id] ?? task), [tasks, moved]);
  const events = useMemo(
    () => toWorkEvents(shown, milestones, canMoveTask, { withProject }),
    [shown, milestones, canMoveTask, withProject],
  );

  const handleUpdate = useCallback((update: EventCalendarProposedUpdate<WorkItem>) => {
    const item = update.event.data;
    if (item?.kind !== 'task' || !item.task) return false;
    const task = (moved[item.id] ?? item.task) as WorkTask;
    if (!canMoveTask(task)) {
      onMoveBlocked?.();
      return false;
    }
    const patch = movedTaskDates(task, update.start);
    if (patch.end_date === task.end_date) return false;
    setMoved((m) => ({ ...m, [task.id]: { ...task, ...patch, end_date: patch.end_date ?? task.end_date } as WorkTask }));
    onMoveTask(task, patch).catch((err: unknown) => {
      setMoved((m) => {
        const { [task.id]: _drop, ...rest } = m;
        return rest;
      });
      onMoveError?.(err, task);
    });
    return false; // the host owns the data; our overlay + refetch paints the move
  }, [canMoveTask, moved, onMoveBlocked, onMoveError, onMoveTask]);

  const handleRange = useCallback(
    (info: EventCalendarRangeInfo) => onWindowChange?.(windowForRange(info.range)),
    [onWindowChange],
  );
  const handleClick = useCallback(
    (occ: EventCalendarOccurrence<WorkItem>) => { if (occ.event.data) onOpenItem?.(occ.event.data); },
    [onOpenItem],
  );

  return (
    <div className="flex min-h-0 flex-col" data-testid="work-calendar">
      <EventCalendar<WorkItem>
        events={events as CalendarEvent<WorkItem>[]}
        defaultView="month"
        defaultDate={initialDate}
        views={VIEWS}
        locale={getDateFnsLocale()}
        loading={loading}
        interactions={{ drag: true, resize: false, selectSlot: false }}
        onEventUpdate={handleUpdate}
        onEventClick={handleClick}
        onRangeChange={handleRange}
        i18n={{ labels: { noEvents: t('empty', 'Nothing due in this period') } }}
        className="min-h-[34rem] flex-1 text-sm"
      >
        <Toolbar />
        <EventCalendarContent className="rounded-lg border border-border bg-card" />
      </EventCalendar>
    </div>
  );
};
