import React, { useCallback, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Button, ListState, PageHeader, useToast } from '@/src/components/ui';
import { WorkCalendar } from '@/src/components/calendar/WorkCalendar';
import { useAuth } from '@/src/auth/useAuth';
import { usePermission } from '@/src/auth/usePermission';
import { useCalendarTasks, useMoveCalendarTask } from '@/src/hooks/useWorkCalendar';
import { useProjects, useProjectsMilestoneDates } from '@/src/hooks/useProjects';
import { useOrgToday } from '@/src/hooks/useOrgToday';
import { useOwnershipCacheSynced } from '@/src/hooks/useOwnershipCacheSync';
import { routeTaskWrite } from '@/src/lib/adapterSeam/ownershipCache';
import { classifyExternalError } from '@/src/lib/adapterSeam/pendingPush';
import { classifyMutationError } from '@/src/lib/classifyMutationError';
import { parseLocalDate } from '@/src/lib/calendar/monthMatrix';
import { formatDay } from '@/src/lib/format';
import type { WorkItem, WorkTask } from '@/src/lib/calendar/workCalendar';

/**
 * Calendar (#1982): what is due this week/month across every project the viewer can read. Tasks sit
 * on their due date, milestones on their target date. Dragging a task moves its due date through the
 * task repository, behind the same real-role edit gate as the task form; read-only roles cannot drag.
 * One tasks read per visible window and one milestone-dates read for all projects (no per-project fan-out).
 */
const CalendarPage: React.FC = () => {
  const { t } = useTranslation('calendar');
  const navigate = useNavigate();
  const { toast } = useToast();
  const { currentUser } = useAuth();
  const may = usePermission();
  const synced = useOwnershipCacheSynced();
  // `?date=YYYY-MM-DD` opens the calendar on that day (shareable link); default is today.
  const [searchParams] = useSearchParams();
  const initialDate = useMemo(() => {
    const raw = searchParams.get('date');
    const parsed = raw && /^\d{4}-\d{2}-\d{2}$/.test(raw) ? parseLocalDate(raw) : null;
    return parsed && !Number.isNaN(parsed.getTime()) ? parsed : undefined;
    // read once at mount: later navigation inside the calendar must not be reset by the URL
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [window, setWindow] = useState<{ from: string; to: string } | null>(null);

  // C13 (DS calendar #4): the org day, so a chip can say a task is past its due date.
  const today = useOrgToday();

  const tasks = useCalendarTasks(window);
  const projects = useProjects();
  const projectIds = useMemo(() => (projects.data ?? []).map((p) => p.id), [projects.data]);
  const milestones = useProjectsMilestoneDates(projectIds);
  const move = useMoveCalendarTask();
  // C5: the phase reads are a chain (projects → milestone dates); either failure empties the grid's
  // phases without an error of its own.
  const phasesUnavailable = projects.isError || milestones.isError;

  const currentUserId = currentUser?.id;
  const taskList = useMemo(() => tasks.data ?? [], [tasks.data]);
  const milestoneList = useMemo(() => milestones.data ?? [], [milestones.data]);
  // Move 1: the empty-month line waits for both reads to answer — work in flight is not "nothing
  // due", and a failed phase read is unknown, not empty (its own warning already speaks).
  const emptyMonthPending = tasks.isFetching || !tasks.data
    || Boolean(projects.isFetching || milestones.isFetching);

  const canMoveTask = useCallback((task: WorkTask) => synced && may('edit', 'task', {
    currentUserId,
    record: {
      created_by: task.created_by,
      assignee_id: task.assignee_id,
      externallyOwned: routeTaskWrite(task.project_id) === 'external',
    },
  }), [currentUserId, may, synced]);

  const onMoveError = useCallback((err: unknown, task: WorkTask) => {
    const { headline, detail } = routeTaskWrite(task.project_id) === 'external'
      ? classifyExternalError(err)
      : classifyMutationError(err);
    toast(headline, detail, 'warning');
  }, [toast]);

  const onOpenItem = useCallback((item: WorkItem) => {
    if (!item.projectId) return;
    navigate(item.kind === 'task'
      ? `/projects/${item.projectId}/tasks?open=${encodeURIComponent(item.id)}`
      : `/projects/${item.projectId}/tasks?view=timeline`);
  }, [navigate]);

  return (
    <div>
      <PageHeader title={t('title', 'Calendar')} />
      {/* C5 (DS calendar #1/#3): the month must not read as the whole plan. Phases come from two
          further reads (the project list, then the milestone dates), so a failure there silently
          deletes every phase from a complete-looking grid — name it and offer the retry. */}
      {phasesUnavailable && (
        <div className="mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-warning/40 bg-warning/12 px-3.5 py-3 text-control">
          <p className="min-w-0 flex-1">
            {t(
              'phasesUnavailable',
              'Phases could not be loaded, so this calendar is missing them. Tasks are still shown.',
            )}
          </p>
          <Button variant="outline" size="sm" onClick={() => { void projects.refetch(); void milestones.refetch(); }}>
            {t('retry', 'Retry')}
          </Button>
        </div>
      )}
      {/* C5 (DS calendar #3): a task with no due date cannot sit on a date, so it is absent — say
          so, or the month reads as the whole plan while unscheduled work exists. (Not shown under
          the error card: there the calendar itself did not load.) */}
      {!tasks.isError && (
        <p className="mb-3 text-control text-muted-foreground">
          {t(
            'undatedNotice',
            "Only work with a date appears here. Tasks with no due date are not on the calendar — they stay on their project's task list.",
          )}
        </p>
      )}
      {tasks.isError ? (
        <ListState
          variant="error"
          title={t('error.title', 'Could not load the calendar')}
          sub={t('error.sub', 'Check your connection and try again.')}
          onRetry={() => void tasks.refetch()}
        />
      ) : (
        <WorkCalendar
          tasks={taskList}
          milestones={milestoneList}
          loading={tasks.isFetching && !tasks.data}
          withProject
          initialDate={initialDate}
          today={today}
          lateLabel={t('overdue', 'Overdue')}
          canMoveTask={canMoveTask}
          onMoveTask={async (task, patch) => {
            await move.mutateAsync({ task, patch });
            toast(
              t('move.savedTitle', 'Task due date updated'),
              t('move.savedBody', '{{task}} is now due {{date}}.', { task: task.name, date: formatDay(patch.end_date) }),
              'success',
            );
          }}
          onMoveError={onMoveError}
          onWindowChange={setWindow}
          onOpenItem={onOpenItem}
          scopeNote={t('scope', 'Tasks and milestones only — meetings are not on this calendar.')}
          emptyMonth={phasesUnavailable ? undefined : {
            pending: emptyMonthPending,
            action: (
              <Link
                to="/my-tasks"
                className="rounded font-medium text-primary-text hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {t('emptyMonthAction', 'My Tasks')}
              </Link>
            ),
          }}
        />
      )}
    </div>
  );
};

export default CalendarPage;
