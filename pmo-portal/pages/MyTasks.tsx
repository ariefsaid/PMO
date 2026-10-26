import React from 'react';
import { Link, useSearchParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import { ListState, SearchMini, StatusPill, SelectField, useToast, ViewToggle } from '@/src/components/ui';
import { useMyTasks, useMyTaskMutations } from '@/src/hooks/useMyTasks';
import { TaskCommentsDrawer } from '@/src/components/comments/TaskCommentsDrawer';
import { formatDateOnly } from '@/src/lib/format';
import { classifyMutationError } from '@/src/lib/classifyMutationError';
import type { TaskStatus } from '@/src/lib/db/tasks';
import WorkPageHeading from './WorkPageHeading';

/** AC-IFW-TASKS-01: Today's ISO date string (YYYY-MM-DD) for overdue comparison. */
function todayIso(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/** AC-IFW-TASKS-01: True when a task is overdue (past due date, not Done/Blocked-complete). */
function isOverdueTask(task: { end_date: string | null; status: string }): boolean {
  return Boolean(task.end_date && task.end_date < todayIso() && task.status !== 'Done');
}

/**
 * AC-IFW-TASKS-01: Sort key for urgency within a project group.
 *   0 = overdue open  (highest urgency)
 *   1 = non-overdue open
 *   2 = Done
 */
function urgencyKey(task: { end_date: string | null; status: string }): number {
  if (task.status === 'Done') return 2;
  if (isOverdueTask(task)) return 0;
  return 1;
}

/**
 * B-1 — "My Tasks" IC landing (AC-W2-IXD-001/002, OUTSTANDING D1 · Blocker).
 *
 * An assignee-scoped, cross-project list of the signed-in user's own assigned tasks.
 * An Engineer lands on something actionable instead of the all-projects financial table.
 * Status can be updated inline (the `taskStatus` policy already permits own-task edits).
 *
 * Data: `useMyTasks()` — a cross-project assignee-scoped read (org-scoped by RLS;
 * filtered to own assignee_id server-side). No new RLS migration per the plan.
 *
 * Responsive: rows stack as a simple list at mobile widths (the full mobile pass is
 * Theme C; this ships a non-broken stacked layout now).
 */

// DB enum values (database.types.ts: "To Do" | "In Progress" | "Done" | "Blocked").
// Must match the `task_status` Postgres enum — see TasksTab.tsx for the same list.
const TASK_STATUS_OPTIONS: TaskStatus[] = ['To Do', 'In Progress', 'Done', 'Blocked'];

const MyTasks: React.FC = () => {
  const { t } = useTranslation();
  const [commentsTask, setCommentsTask] = React.useState<{ id: string; name: string } | null>(null);
  const [searchParams, setSearchParams] = useSearchParams();
  const queue = searchParams.get('status') === 'completed' ? 'completed' : 'open';
  const search = searchParams.get('q') ?? '';
  const projectFilter = searchParams.get('project') ?? 'all';
  const sort = searchParams.get('sort') === 'due' ? 'due' : 'urgency';
  const { data: tasks, isPending, isError, refetch } = useMyTasks();
  const { updateStatus } = useMyTaskMutations();
  const { toast } = useToast();

  const setFilterParam = (key: string, value: string, defaultValue: string) => {
    const next = new URLSearchParams(searchParams);
    if (value === defaultValue) next.delete(key);
    else next.set(key, value);
    setSearchParams(next, { replace: true });
  };

  const clearFilters = () => {
    const next = new URLSearchParams(searchParams);
    ['q', 'status', 'project'].forEach((key) => next.delete(key));
    setSearchParams(next, { replace: true });
  };

  // Display labels for the DB `task_status` enum. The VALUES stay the raw enum strings (they are
  // persisted); only the labels are translated. Static keys, one per member — a computed
  // `t(`task.status.${s}`)` would be invisible to i18next-parser and so to the completeness gate.
  const statusLabels: Record<TaskStatus, string> = {
    'To Do': t('task.status.toDo', 'To Do'),
    'In Progress': t('task.status.inProgress', 'In Progress'),
    Done: t('task.status.done', 'Done'),
    Blocked: t('task.status.blocked', 'Blocked'),
  };

  const visibleTasks = React.useMemo(() => {
    if (!tasks) return [];
    const normalizedSearch = search.trim().toLocaleLowerCase();
    return tasks.filter((task) => {
      const isCompleted = task.status === 'Done';
      if (isCompleted !== (queue === 'completed')) return false;
      if (projectFilter === 'none' && task.project_id) return false;
      if (projectFilter !== 'all' && projectFilter !== 'none' && task.project_id !== projectFilter) return false;
      if (!normalizedSearch) return true;
      return `${task.name} ${task.project_name ?? ''} ${task.project_contractual_name ?? ''}`.toLocaleLowerCase().includes(normalizedSearch);
    });
  }, [tasks, queue, search, projectFilter]);

  const projectOptions = React.useMemo(() => {
    const projects = new Map<string, { value: string; label: string }>();
    for (const task of tasks ?? []) {
      if (task.project_id && !projects.has(task.project_id)) {
        projects.set(task.project_id, {
          value: task.project_id,
          label: String(task.project_name ?? t('work:myTasks.projectUnknown', 'Project')),
        });
      }
    }
    return [
      { value: 'all', label: t('work:myTasks.allProjects', 'All projects') },
      { value: 'none', label: t('myTasks.noProjectGroup', 'No project') },
      ...[...projects.values()].sort((a, b) => a.label.localeCompare(b.label)),
    ];
  }, [tasks, t]);

  // A single urgency-first ordering makes urgent work visible across project boundaries.
  const orderedTasks = React.useMemo(() => [...visibleTasks].sort((a, b) => {
    if (sort === 'urgency') {
      const urgency = urgencyKey(a) - urgencyKey(b);
      if (urgency) return urgency;
    }
    if (a.end_date !== b.end_date) {
      if (!a.end_date) return 1;
      if (!b.end_date) return -1;
      return a.end_date.localeCompare(b.end_date);
    }
    if (sort === 'due') {
      const urgency = urgencyKey(a) - urgencyKey(b);
      if (urgency) return urgency;
    }
    return a.name.localeCompare(b.name) || a.id.localeCompare(b.id);
  }), [visibleTasks, sort]);

  return (
    <div>
      <WorkPageHeading
        title={t('work:workPageHeading.tasks', 'My tasks')}
        scope={t('work:workPageHeading.tasksScope', 'Assigned to you across projects')}
      />

      {!isPending && !isError && tasks && tasks.length > 0 && (
        <div data-testid="my-tasks-toolbar" className="mb-4 flex flex-col gap-2 border-b border-border pb-4 sm:flex-row sm:flex-wrap sm:items-center">
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <SearchMini
              aria-label={t('myTasks.searchLabel', 'Search your tasks')}
              placeholder={t('myTasks.searchPlaceholder', 'Search your tasks')}
              value={search}
              onChange={(event) => setFilterParam('q', event.target.value, '')}
              searchSurface="my-tasks-list"
              module="tasks"
              resultCount={orderedTasks.length}
              className="min-h-11"
              containerClassName="min-h-11 w-full min-w-0 sm:w-auto sm:min-w-[220px] sm:flex-1"
            />
            {search && (
              <button
                type="button"
                onClick={() => setFilterParam('q', '', '')}
                className="touch-target inline-flex min-h-11 shrink-0 items-center rounded-md px-2 text-sm font-medium text-primary-text hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {t('myTasks.clearSearch', 'Clear search')}
              </button>
            )}
          </div>
          {/* DESIGN.md `seg`: the shared inline segmented control, `toggle` semantics — a queue
              filter with no tabpanels, so aria-pressed beats role="tab" (ViewToggle doc). */}
          <ViewToggle
            semantics="toggle"
            ariaLabel={t('myTasks.queueLabel', 'Task status')}
            value={queue}
            onChange={(value) => setFilterParam('status', value, 'open')}
            options={[
              { value: 'open', label: t('myTasks.openTasks', 'Open tasks') },
              { value: 'completed', label: t('myTasks.completed', 'Completed') },
            ]}
          />
          <SelectField
            label={t('work:myTasks.projectFilter', 'Filter by project')}
            hideLabel
            value={projectFilter}
            onChange={(value) => setFilterParam('project', value, 'all')}
            options={projectOptions}
            className="min-h-11 min-w-[150px]"
          />
          <SelectField
            label={t('work:myTasks.sortLabel', 'Sort tasks')}
            hideLabel
            value={sort}
            onChange={(value) => setFilterParam('sort', value, 'urgency')}
            options={[
              { value: 'urgency', label: t('work:myTasks.sortUrgency', 'Urgency') },
              { value: 'due', label: t('work:myTasks.sortDue', 'Due date') },
            ]}
            className="min-h-11 min-w-[130px]"
          />
        </div>
      )}

      {isPending && <ListState variant="loading" rows={4} />}

      {isError && (
        <ListState
          variant="error"
          title={t('myTasks.error.title', "Couldn't load your tasks")}
          sub={t('myTasks.error.sub', 'Something went wrong fetching your assigned tasks.')}
          onRetry={() => refetch()}
        />
      )}

      {!isPending && !isError && tasks && tasks.length === 0 && (
        <ListState
          variant="empty"
          icon="check"
          title={t('myTasks.empty.title', 'No tasks assigned to you')}
          sub={t(
            'myTasks.empty.sub',
            'When tasks are assigned to you they will appear here across all your projects.',
          )}
        />
      )}

      {!isPending && !isError && tasks && tasks.length > 0 && visibleTasks.length === 0 && (
        <div className="py-8 text-center" role="status">
          <p className="text-sm text-muted-foreground">
            {search.trim()
              ? t('myTasks.noSearchResults', 'No tasks match your search')
              : t('myTasks.noTasksInView', 'No tasks in this view')}
          </p>
          <button
            type="button"
            onClick={clearFilters}
            className="touch-target mt-2 inline-flex min-h-11 items-center rounded-md px-2 text-sm font-medium text-primary-text hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {t('work:myTasks.clearFilters', 'Clear filters')}
          </button>
        </div>
      )}

      {!isPending && !isError && orderedTasks.length > 0 && (
        <div role="list" aria-label={t('work:myTasks.listLabel', 'Assigned tasks')} className="divide-y divide-border rounded-xl border border-border bg-card">
          {orderedTasks.map((task) => (
            <div
              key={task.id}
              role="listitem"
              className="flex min-w-0 flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="min-w-0 flex-1">
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                  {task.project_id || task.meeting_id ? (
                    <Link
                      to={task.project_id ? `/projects/${task.project_id}/tasks#task-${task.id}` : `/meetings/${task.meeting_id}#task-${task.id}`}
                      className="min-w-0 break-words text-sm hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      title={task.name}
                    >
                      {task.name}
                    </Link>
                  ) : (
                    <span className="min-w-0 break-words text-sm" title={task.name}>{task.name}</span>
                  )}
                  {isOverdueTask(task) && <StatusPill variant="warn">{t('myTasks.overdue', 'Overdue')}</StatusPill>}
                </div>
                <div className="mt-1 text-sm text-muted-foreground">
                  {task.project_id ? (
                    <Link
                      to={`/projects/${task.project_id}/tasks`}
                      title={task.project_contractual_name && task.project_contractual_name !== task.project_name ? task.project_contractual_name : undefined}
                      className="rounded hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      {task.project_name ?? t('work:myTasks.projectUnknown', 'Project')}
                    </Link>
                  ) : (
                    <span>{t('myTasks.noProjectGroup', 'No project')}</span>
                  )}
                </div>
                {(task.start_date || task.end_date) && (
                  <div className="mt-1 text-sm text-muted-foreground">
                    {task.start_date && t('myTasks.start', 'Start {{date}}', { date: formatDateOnly(task.start_date) })}
                    {task.start_date && task.end_date && <span className="mx-1">·</span>}
                    {task.end_date && t('myTasks.due', 'Due {{date}}', { date: formatDateOnly(task.end_date) })}
                  </div>
                )}
              </div>
              <div className="flex flex-wrap items-center gap-2 sm:shrink-0 sm:justify-end">
                <button
                  type="button"
                  aria-label={`${t('comments.open', 'Comments')} ${task.name}`}
                  onClick={() => setCommentsTask({ id: task.id, name: task.name })}
          className="touch-target min-h-11 rounded-lg border border-input bg-background px-3 text-xs font-semibold text-foreground hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {t('comments.open', 'Comments')}
                </button>
                {task.project_id && (
                  <Link
                    to={`/timesheets?project=${task.project_id}`}
                    className="touch-target inline-flex min-h-11 items-center rounded-lg border border-input bg-background px-3 text-xs font-semibold text-foreground hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    {t('myTasks.logTime', 'Log time')}
                  </Link>
                )}
                <SelectField
                  hideLabel
                  label={`${t('myTasks.changeStatusOf', 'Change status of')} ${task.name}`}
                  value={task.status}
                  disabled={updateStatus.isPending}
                  onChange={(value) => updateStatus.mutate(
                    { id: task.id, projectId: task.project_id, status: value as TaskStatus },
                    { onError: (err) => {
                      const { headline, detail } = classifyMutationError(err);
                      toast(headline, detail, 'warning');
                    } },
                  )}
                  options={TASK_STATUS_OPTIONS.map((value) => ({ value, label: statusLabels[value] }))}
                  className="min-h-11 min-w-[120px]"
                />
              </div>
            </div>
          ))}
        </div>
      )}
      <TaskCommentsDrawer task={commentsTask} onClose={() => setCommentsTask(null)} />
    </div>
  );
};

export default MyTasks;
