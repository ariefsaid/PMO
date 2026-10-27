import React, { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import { ListState, SelectField, StatusPill, useToast, ViewToggle } from '@/src/components/ui';
import { TaskPushBadge } from '@/src/components/tasks/TaskPushBadge';
import { useAuth } from '@/src/auth/useAuth';
import { useEffectiveRole } from '@/src/auth/impersonation';
import { usePermission } from '@/src/auth/usePermission';
import { useTasks, useTaskMutations } from '@/src/hooks/useTasks';
import { useFxOrgDay } from '@/src/hooks/useFxOrgDay';
import { classifyMutationError } from '@/src/lib/classifyMutationError';
import { classifyExternalError, IDLE_PENDING_PUSH } from '@/src/lib/adapterSeam/pendingPush';
import { routeTaskWrite } from '@/src/lib/adapterSeam/ownershipCache';
import { formatDateOnly } from '@/src/lib/format';
import { workflowVariant } from '@/src/lib/status/statusVariants';
import type { TaskStatus, TaskWithRefs } from '@/src/lib/db/tasks';
import { useMilestones } from '@/src/hooks/useMilestones';

const STATUSES: TaskStatus[] = ['To Do', 'In Progress', 'Done', 'Blocked'];
const STATUS_OPTIONS = STATUSES.map((status) => ({ value: status, label: status }));
const DAY_MS = 24 * 60 * 60 * 1000;

type DueBucketId = 'overdue' | 'this-week' | 'next-two-weeks' | 'later' | 'no-date' | 'done';
type DueBucket = { id: DueBucketId; label: string; tasks: TaskWithRefs[] };

export interface TasksBProps {
  projectId: string;
  projectName?: string;
}

function addDays(isoDate: string, days: number): string {
  const date = new Date(`${isoDate}T12:00:00`);
  date.setDate(date.getDate() + days);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function localTodayIso(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

function startOfWeek(isoDate: string): string {
  const date = new Date(`${isoDate}T12:00:00`);
  date.setDate(date.getDate() - ((date.getDay() + 6) % 7));
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function daysLate(dueDate: string, today: string): number {
  return Math.floor((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${dueDate}T00:00:00Z`)) / DAY_MS);
}

function groupByDueDate(tasks: TaskWithRefs[], today: string): DueBucket[] {
  const weekEnd = addDays(startOfWeek(today), 6);
  const nextTwoWeeksEnd = addDays(weekEnd, 14);
  const buckets: DueBucket[] = [
    { id: 'overdue', label: 'Overdue', tasks: [] },
    { id: 'this-week', label: 'This week', tasks: [] },
    { id: 'next-two-weeks', label: 'Next 2 weeks', tasks: [] },
    { id: 'later', label: 'Later', tasks: [] },
    { id: 'no-date', label: 'No date', tasks: [] },
    { id: 'done', label: 'Done', tasks: [] },
  ];

  for (const task of tasks) {
    if (task.status === 'Done') {
      buckets[5].tasks.push(task);
    } else if (!task.end_date) {
      buckets[4].tasks.push(task);
    } else if (task.end_date < today) {
      buckets[0].tasks.push(task);
    } else if (task.end_date <= weekEnd) {
      buckets[1].tasks.push(task);
    } else if (task.end_date <= nextTwoWeeksEnd) {
      buckets[2].tasks.push(task);
    } else {
      buckets[3].tasks.push(task);
    }
  }

  for (const bucket of buckets) {
    bucket.tasks.sort((a, b) => {
      if (a.end_date && b.end_date) return a.end_date.localeCompare(b.end_date) || a.name.localeCompare(b.name);
      if (a.end_date) return -1;
      if (b.end_date) return 1;
      return a.name.localeCompare(b.name);
    });
  }
  return buckets;
}

const TasksB: React.FC<TasksBProps> = ({ projectId }) => {
  const { t } = useTranslation();
  const may = usePermission();
  const { realRole } = useEffectiveRole();
  const { currentUser } = useAuth();
  const { toast } = useToast();
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedScope = searchParams.get('scope');
  const scope = requestedScope === 'mine' || requestedScope === 'all'
    ? requestedScope
    : realRole === 'Engineer' ? 'mine' : 'all';
  const today = useFxOrgDay(true).day ?? localTodayIso();
  const { data, isPending, isError, refetch } = useTasks(projectId);
  const { data: milestones } = useMilestones(projectId);
  const { updateStatus, pendingPushByTask = {} } = useTaskMutations(projectId);
  const [doneExpanded, setDoneExpanded] = useState(false);

  const milestoneNames = useMemo(() => new Map((milestones ?? []).map((milestone) => [milestone.id, milestone.name])), [milestones]);
  const tasks = useMemo(() => {
    const active = (data ?? []).filter((task) => task.archived_at == null);
    return scope === 'mine'
      ? active.filter((task) => task.assignee_id === currentUser?.id)
      : active;
  }, [currentUser?.id, data, scope]);
  const buckets = useMemo(() => groupByDueDate(tasks, today), [tasks, today]);
  const externallyOwned = routeTaskWrite(projectId) === 'external';
  const setScope = (nextScope: 'mine' | 'all') => {
    const next = new URLSearchParams(searchParams);
    next.set('scope', nextScope);
    setSearchParams(next, { replace: true });
  };

  const canSetStatus = (task: TaskWithRefs) => may('edit', 'taskStatus', {
    currentUserId: currentUser?.id ?? null,
    record: { assignee_id: task.assignee_id },
  });

  const changeStatus = async (task: TaskWithRefs, status: TaskStatus) => {
    if (status === task.status) return;
    try {
      await updateStatus.mutateAsync({ id: task.id, status });
      toast('Status updated', `${task.name} is now ${status}`, 'success');
    } catch (error) {
      const { headline, detail } = externallyOwned
        ? classifyExternalError(error)
        : classifyMutationError(error);
      toast(headline, detail, 'warning');
    }
  };

  const renderTask = (task: TaskWithRefs, bucket: DueBucketId) => {
    const late = bucket === 'overdue' && task.end_date ? daysLate(task.end_date, today) : 0;
    const phaseLabel = task.milestone_id ? milestoneNames.get(task.milestone_id) ?? 'Phase' : 'No phase';
    return (
      <li key={task.id} className="flex min-w-0 flex-col gap-2 border-b border-border/70 py-3 last:border-b-0 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
        <div className="min-w-0 flex-1">
          <p className="break-words text-sm font-semibold text-foreground">{task.name}</p>
          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
            <span>{phaseLabel}</span>
            {task.end_date && <>
              <span aria-hidden="true">·</span>
              <span className={late > 0 ? 'text-destructive-text' : ''}>
                {formatDateOnly(task.end_date)}{late > 0 ? ` · ${late} ${late === 1 ? 'day' : 'days'} late` : ''}
              </span>
            </>}
            <span aria-hidden="true">·</span>
            <span>{task.assignee?.full_name ?? t('projectDetail.tasks.unassigned', 'Unassigned')}</span>
          </div>
        </div>
        <div className="flex w-full items-center justify-between gap-3 sm:w-auto sm:justify-end">
          {canSetStatus(task) ? (
            <div className="w-40 shrink-0">
              <SelectField
                hideLabel
                label={`Status for ${task.name}`}
                value={task.status}
                disabled={updateStatus.isPending}
                onChange={(value) => void changeStatus(task, value as TaskStatus)}
                options={STATUS_OPTIONS}
                fullWidth
              />
            </div>
          ) : (
            <StatusPill variant={workflowVariant(task.status)}>{task.status}</StatusPill>
          )}
          {externallyOwned && <TaskPushBadge state={pendingPushByTask[task.id] ?? IDLE_PENDING_PUSH} />}
        </div>
      </li>
    );
  };

  if (isPending) return <ListState variant="loading" rows={5} />;
  if (isError || !data) {
    return (
      <ListState
        variant="error"
        title={t('projectDetail.tasks.errorTitle', "Couldn't load tasks")}
        sub={t('projectDetail.tasks.errorSub', 'The request failed. Check your connection and try again.')}
        onRetry={() => void refetch()}
      />
    );
  }

  return (
    <div className="min-w-0">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <h2 className="text-base font-bold tracking-[-0.01em]">Tasks by due date</h2>
        <ViewToggle<'mine' | 'all'>
          options={[
            { value: 'mine', label: t('projectDetail.tasks.scope.mine', 'Mine') },
            { value: 'all', label: t('projectDetail.tasks.scope.all', 'All') },
          ]}
          value={scope}
          onChange={setScope}
          ariaLabel={t('projectDetail.tasks.scopeAriaLabel', 'Task scope')}
          semantics="toggle"
        />
      </div>

      {tasks.length === 0 ? (
        <ListState
          variant="empty"
          icon="check"
          title={scope === 'mine' ? 'No open tasks assigned to you' : t('projectDetail.tasks.emptyTitle', 'No tasks yet')}
          sub={scope === 'mine' ? 'Choose All to review the project task list.' : t('projectDetail.tasks.emptySub', 'Break the project into tasks, assign them to the team, and track each through to Done.')}
        />
      ) : (
        <div className="border-y border-border">
          {buckets.map((bucket) => {
            const isDone = bucket.id === 'done';
            const expanded = !isDone || doneExpanded;
            return (
              <section key={bucket.id} aria-labelledby={`tasks-bucket-${bucket.id}`} className="border-b border-border last:border-b-0">
                {isDone ? (
                  <button
                    id={`tasks-bucket-${bucket.id}`}
                    type="button"
                    aria-expanded={doneExpanded}
                    onClick={() => setDoneExpanded((value) => !value)}
                    className="touch-target flex w-full items-center justify-between rounded-sm py-3 text-left font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                  >
                    <span>{bucket.label}</span>
                    <span className="text-sm font-normal text-muted-foreground">{bucket.tasks.length}</span>
                  </button>
                ) : (
                  <div id={`tasks-bucket-${bucket.id}`} className="flex items-baseline justify-between py-3">
                    <h3 className={`text-sm font-semibold ${bucket.id === 'overdue' ? 'text-destructive-text' : 'text-foreground'}`}>{bucket.label}</h3>
                    <span className="text-sm tabular text-muted-foreground">{bucket.tasks.length}</span>
                  </div>
                )}
                {expanded && (bucket.tasks.length > 0 ? (
                  <ul className="pb-1">{bucket.tasks.map((task) => renderTask(task, bucket.id))}</ul>
                ) : (
                  <p className="pb-3 text-sm text-muted-foreground">{isDone ? 'No completed tasks.' : 'Nothing due in this period.'}</p>
                ))}
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default TasksB;
