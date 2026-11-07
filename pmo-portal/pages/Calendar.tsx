import React, { useCallback, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import { ListState, useToast } from '@/src/components/ui';
import { WorkCalendar } from '@/src/components/calendar/WorkCalendar';
import { useAuth } from '@/src/auth/useAuth';
import { usePermission } from '@/src/auth/usePermission';
import { useCalendarTasks, useMoveCalendarTask } from '@/src/hooks/useWorkCalendar';
import { useProjects, useProjectsMilestoneDates } from '@/src/hooks/useProjects';
import { useOwnershipCacheSynced } from '@/src/hooks/useOwnershipCacheSync';
import { routeTaskWrite } from '@/src/lib/adapterSeam/ownershipCache';
import { classifyExternalError } from '@/src/lib/adapterSeam/pendingPush';
import { classifyMutationError } from '@/src/lib/classifyMutationError';
import { parseLocalDate } from '@/src/lib/calendar/monthMatrix';
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

  const tasks = useCalendarTasks(window);
  const projects = useProjects();
  const projectIds = useMemo(() => (projects.data ?? []).map((p) => p.id), [projects.data]);
  const milestones = useProjectsMilestoneDates(projectIds);
  const move = useMoveCalendarTask();

  const currentUserId = currentUser?.id;
  const taskList = useMemo(() => tasks.data ?? [], [tasks.data]);
  const milestoneList = useMemo(() => milestones.data ?? [], [milestones.data]);

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
      <div className="mb-4">
        <h1 className="text-[24px] font-bold tracking-[-0.02em]">{t('title', 'Calendar')}</h1>
        <p className="mt-0.5 text-sm text-muted-foreground">
          {t('subtitle', 'Tasks by due date and milestones by target date, across your projects.')}
        </p>
      </div>
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
          canMoveTask={canMoveTask}
          onMoveTask={(task, patch) => move.mutateAsync({ task, patch })}
          onMoveError={onMoveError}
          onWindowChange={setWindow}
          onOpenItem={onOpenItem}
        />
      )}
    </div>
  );
};

export default CalendarPage;
