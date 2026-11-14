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
  useEventCalendarOccurrences,
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
import { Button, ConfirmDialog, ViewToggle } from '@/src/components/ui';
import { getDateFnsLocale } from '@/src/lib/locale/activeLocale';
import { formatDay } from '@/src/lib/format';
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
  /**
   * C13 (DS calendar #4): the org day ('YYYY-MM-DD') and the localised word for a past-due task.
   * The host supplies both so the chip can say a task is late without this component reading a
   * clock; omitted = no lateness is claimed.
   */
  today?: string;
  lateLabel?: string;
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
  /**
   * Judging calendar #1: the host's ruled empty state for a month with nothing due. Presence opts
   * in (the project Tasks tab renders this calendar too and passes nothing). `pending` holds the
   * line back while the window's read is in flight — an answer in flight is not "nothing due".
   */
  emptyMonth?: { action?: React.ReactNode; pending?: boolean };
  /**
   * B7 (Director, Part 8): the screen's ONE explanatory line in the toolbar — what the grid holds
   * and what it leaves out (the cross-project route says tasks and phases with a date, nothing
   * else). The host supplies the words; nothing is read for it.
   */
  scopeNote?: string;
}

/**
 * One line under the toolbar when the visible month holds no task and no milestone, plus the
 * host's action (the calendar route links to My Tasks). Month view only: the agenda already names
 * its own empty period, so this would be the same sentence twice.
 */
const EmptyMonth: React.FC<{ action?: React.ReactNode }> = ({ action }) => {
  const { t } = useTranslation('calendar');
  const { title } = useEventCalendarNavigation();
  const { view } = useEventCalendarView();
  const occurrences = useEventCalendarOccurrences<WorkItem>();
  if (view !== 'month' || occurrences.length > 0) return null;
  return (
    <p
      data-testid="work-calendar-empty-month"
      className="mb-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-control text-muted-foreground"
    >
      {t('emptyMonth', 'No tasks or phases due in {{range}}', { range: title })}
      {action}
    </p>
  );
};

const Toolbar: React.FC<{ scopeNote?: string }> = ({ scopeNote }) => {
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
      {scopeNote && <p className="basis-full text-control text-muted-foreground">{scopeNote}</p>}
    </div>
  );
};

export const WorkCalendar: React.FC<WorkCalendarProps> = ({
  tasks, milestones, loading, initialDate, withProject, today, lateLabel, canMoveTask, onMoveTask, onWindowChange, onOpenItem, onMoveError, onMoveBlocked, emptyMonth, scopeNote,
}) => {
  const { t } = useTranslation('calendar');
  const taskKindLabel = t('eventKind.task', 'Task');
  const milestoneKindLabel = t('eventKind.milestone', 'Phase');
  // A confirmed move shows on its new day while the host's saved task read catches up.
  const [moved, setMoved] = useState<Record<string, WorkTask>>({});
  const [pendingMove, setPendingMove] = useState<{
    task: WorkTask;
    patch: Pick<TaskPatch, 'start_date' | 'end_date'>;
  } | null>(null);
  const [savingMove, setSavingMove] = useState(false);
  useEffect(() => setMoved({}), [tasks]);

  const shown = useMemo(() => tasks.map((task) => moved[task.id] ?? task), [tasks, moved]);
  const events = useMemo(
    () => toWorkEvents(shown, milestones, canMoveTask, { withProject, today, lateLabel }).map((event) => ({
      ...event,
      ariaLabelPrefix: event.data?.kind === 'task'
        ? taskKindLabel
        : event.data?.kind === 'milestone' ? milestoneKindLabel : undefined,
    })),
    [shown, milestones, canMoveTask, withProject, today, lateLabel, taskKindLabel, milestoneKindLabel],
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
    setPendingMove({ task, patch });
    return false; // the host owns the data; our overlay + refetch paints the move
  }, [canMoveTask, moved, onMoveBlocked]);

  const confirmMove = useCallback(async () => {
    if (!pendingMove) return;
    const { task, patch } = pendingMove;
    setSavingMove(true);
    setMoved((current) => ({
      ...current,
      [task.id]: { ...task, ...patch, end_date: patch.end_date ?? task.end_date } as WorkTask,
    }));
    try {
      await onMoveTask(task, patch);
      setPendingMove(null);
    } catch (err) {
      setMoved((current) => {
        const { [task.id]: _drop, ...rest } = current;
        return rest;
      });
      onMoveError?.(err, task);
      setPendingMove(null);
    } finally {
      setSavingMove(false);
    }
  }, [onMoveError, onMoveTask, pendingMove]);

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
        className="min-h-[34rem] flex-1 text-control!"
      >
        <Toolbar scopeNote={scopeNote} />
        {emptyMonth && !emptyMonth.pending && !loading && <EmptyMonth action={emptyMonth.action} />}
        <EventCalendarContent className="rounded-lg border border-border bg-card" />
      </EventCalendar>
      <ConfirmDialog
        open={pendingMove !== null}
        tone="default"
        title={t('move.confirmTitle', 'Move task due date?')}
        description={pendingMove
          ? pendingMove.task.start_date && pendingMove.patch.start_date
            ? t('move.confirmRangeBody', '{{task}} will move its dates: start {{startFrom}} to {{startTo}}, due {{dueFrom}} to {{dueTo}}. The current dates will be replaced.', {
              task: pendingMove.task.name,
              startFrom: formatDay(pendingMove.task.start_date),
              startTo: formatDay(pendingMove.patch.start_date),
              dueFrom: formatDay(pendingMove.task.end_date),
              dueTo: formatDay(pendingMove.patch.end_date),
            })
            : t('move.confirmBody', '{{task}} will move from {{from}} to {{to}}. The current due date will be replaced.', {
              task: pendingMove.task.name,
              from: formatDay(pendingMove.task.end_date),
              to: formatDay(pendingMove.patch.end_date),
            })
          : ''}
        confirmLabel={t('move.confirm', 'Move task')}
        loading={savingMove}
        onConfirm={() => { void confirmMove(); }}
        onCancel={() => { if (!savingMove) setPendingMove(null); }}
      />
    </div>
  );
};
