import React from 'react';
import { Link, useSearchParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import { LateText, ListState, PageHeader, SearchMini, StatusPill, SelectField, useToast, ViewToggle, isMostUrgentLateRow } from '@/src/components/ui';
import { useMyTasks, useMyTaskMutations } from '@/src/hooks/useMyTasks';
import { useOrgToday } from '@/src/hooks/useOrgToday';
import { TaskCommentsDrawer } from '@/src/components/comments/TaskCommentsDrawer';
import { formatDay, formatCalendarDayInTimeZone, formatDaysLate } from '@/src/lib/format';
import { getActiveLocale } from '@/src/lib/locale/activeLocale';
import { classifyMutationError } from '@/src/lib/classifyMutationError';
import type { TaskStatus } from '@/src/lib/db/tasks';
import { statusLabel } from '@/src/lib/status/statusMap';

/** AC-IFW-TASKS-01 / PGA03-008: Today's calendar date string (YYYY-MM-DD) in user's timezone. */
function todayIso(timezone = getActiveLocale().timezone): string {
  return formatCalendarDayInTimeZone(new Date(), timezone);
}

/** AC-IFW-TASKS-01: True when a task is overdue (past due date, not Done/Blocked-complete). */
function isOverdueTask(
  task: { end_date: string | null; status: string },
  today = todayIso(),
): boolean {
  return Boolean(task.end_date && task.end_date < today && task.status !== 'Done');
}

/** AC-IFW-TASKS-01: Overdue open tasks precede the remaining tasks in each queue. */
function urgencyKey(
  task: { end_date: string | null; status: string },
  today = todayIso(),
): number {
  if (isOverdueTask(task, today)) return 0;
  return 1;
}

/** Sunday of the week `day` (ISO YYYY-MM-DD) belongs to — the figure's due-by bound (Mon-based week). */
function weekEndDate(day: string): string {
  const [year, month, date] = day.split('-').map(Number);
  const local = new Date(year, month - 1, date);
  const weekday = local.getDay();
  local.setDate(local.getDate() + (weekday === 0 ? 0 : 7 - weekday));
  return `${local.getFullYear()}-${String(local.getMonth() + 1).padStart(2, '0')}-${String(local.getDate()).padStart(2, '0')}`;
}

/**
 * PGA03-008: Reactive today date in the user's timezone that automatically
 * updates when midnight rolls over without requiring a page refresh.
 */
const useZonedToday = useOrgToday;

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
  // #1461: the drill-window chip lives in the tasks feature namespace.
  const { t: tasksT } = useTranslation('tasks');
  const { t: tStatus } = useTranslation('status');
  const today = useZonedToday();
  // #1461: the dashboard 'Tasks due' figure counts open tasks due by the end of this week, and its
  // drill carries `due=week`, so the list can show exactly that set (shareable URL, clearable chip).
  const [searchParams, setSearchParams] = useSearchParams();
  const dueThisWeekOnly = searchParams.get('due') === 'week';
  const dueBy = dueThisWeekOnly && today ? weekEndDate(today) : null;
  const clearDueFilter = () => setSearchParams((current) => {
    const next = new URLSearchParams(current);
    next.delete('due');
    return next;
  }, { replace: true });
  const [commentsTask, setCommentsTask] = React.useState<{ id: string; name: string } | null>(null);
  // R2: queue and search are URL-owned like the due=week drill, so Back/refresh keep them;
  // defaults stay out of the URL (empty = open queue, no search).
  const setParam = (key: string, value: string) => setSearchParams((current) => {
    const next = new URLSearchParams(current);
    if (value) next.set(key, value);
    else next.delete(key);
    return next;
  }, { replace: true });
  const queue = searchParams.get('queue') === 'completed' ? 'completed' : 'open';
  const setQueue = (next: 'open' | 'completed') => setParam('queue', next === 'completed' ? next : '');
  const search = searchParams.get('q') ?? '';
  const setSearch = (value: string) => setParam('q', value);
  const { data: tasks, isPending, isError, refetch } = useMyTasks();
  const { updateStatus } = useMyTaskMutations();
  const { toast } = useToast();

  // Display labels for the DB `task_status` enum. The VALUES stay the raw enum strings (they are
  // persisted); only the labels are translated. Static keys, one per member — a computed
  // `t(`task.status.${s}`)` would be invisible to i18next-parser and so to the completeness gate.
  const statusLabels: Record<TaskStatus, string> = {
    'To Do': statusLabel('task', 'To Do', t),
    'In Progress': statusLabel('task', 'In Progress', t),
    Done: statusLabel('task', 'Done', t),
    Blocked: statusLabel('task', 'Blocked', t),
  };

  const visibleTasks = React.useMemo(() => {
    if (!tasks) return [];
    const normalizedSearch = search.trim().toLocaleLowerCase();
    return tasks.filter((task) => {
      const isCompleted = task.status === 'Done';
      if (isCompleted !== (queue === 'completed')) return false;
      // #1461 due=week: open tasks due by the end of this week (the figure's counted set).
      if (dueBy && !isCompleted && !(task.end_date !== null && task.end_date <= dueBy)) return false;
      if (!normalizedSearch) return true;
      return `${task.name} ${task.project_name ?? ''} ${task.project_contractual_name ?? ''}`.toLocaleLowerCase().includes(normalizedSearch);
    });
  }, [tasks, queue, search, dueBy]);

  const openTaskCount = tasks?.filter((task) => task.status !== 'Done').length ?? 0;
  const lateTasks = React.useMemo(
    () => visibleTasks
      .filter((task) => isOverdueTask(task, today))
      .sort((a, b) => (a.end_date ?? '').localeCompare(b.end_date ?? '')),
    [visibleTasks, today],
  );

  // Keep project grouping/context and urgency ordering after search/status filtering.
  // AC-IFW-TASKS-01: overdue open tasks precede other open work; dates sort soonest first.
  const grouped = React.useMemo(() => {
    if (!tasks) return [];
    // #525 FR-FCT-041: null is a stable key for the single project-less task group.
    const map = new Map<string | null, { projectId: string | null; projectName: string; legalName?: string | null; items: typeof tasks }>();
    for (const task of visibleTasks) {
      const key = task.project_id;
      if (!map.has(key)) {
        map.set(key, {
          projectId: task.project_id,
          projectName: task.project_name ?? t('myTasks.noProjectGroup', 'No project'),
          legalName: task.project_contractual_name,
          items: [],
        });
      }
      map.get(key)!.items.push(task);
    }
    const groups = [...map.values()];
    // Sort within each group
    for (const g of groups) {
      g.items.sort((a, b) => {
        const ka = urgencyKey(a, today);
        const kb = urgencyKey(b, today);
        if (ka !== kb) return ka - kb;
        // Secondary: end_date asc, nulls last
        if (a.end_date === b.end_date) return 0;
        if (!a.end_date) return 1;
        if (!b.end_date) return -1;
        return a.end_date < b.end_date ? -1 : 1;
      });
    }
    return groups;
  }, [tasks, visibleTasks, t, today]);

  return (
    <div>
      <PageHeader title={t('myTasks.title', 'Tasks')} />

      {!isPending && !isError && tasks && tasks.length > 0 && (
        <div className={`mb-4 flex flex-col gap-3 min-[640px]:flex-row min-[640px]:items-center min-[640px]:justify-between ${queue === 'open' ? 'rounded-lg border border-border bg-waiting-surface p-4' : 'border-b border-border pb-4'}`} data-testid={queue === 'open' ? 'my-tasks-waiting-summary' : undefined}>
          {queue === 'open' && (
            <div className="flex shrink-0 items-center gap-3">
              <span
                data-testid="my-tasks-open-count"
                aria-label={`${openTaskCount} ${t('myTasks.openTasks', 'Open tasks')}`}
                className="text-metric font-semibold tabular-nums text-foreground"
              >
                {openTaskCount}
              </span>
              {lateTasks.length > 0 && (
                <StatusPill
                  variant="overdue"
                  role="status"
                  data-testid="my-tasks-overdue-count"
                  aria-label={`${lateTasks.length} ${t('myTasks.overdue', 'Overdue')}`}
                  title={`${lateTasks.length} ${t('myTasks.overdue', 'Overdue')}`}
                >
                  {lateTasks.length}
                </StatusPill>
              )}
            </div>
          )}
          {/* DESIGN.md `seg`: the shared inline segmented control, `toggle` semantics — a queue
              filter with no tabpanels, so aria-pressed beats role="tab" (ViewToggle doc). */}
          <ViewToggle
            semantics="toggle"
            ariaLabel={t('myTasks.queueLabel', 'Task status')}
            value={queue}
            onChange={setQueue}
            options={[
              { value: 'open', label: t('tasks:myTasks.openTasksShort', 'Open'), ariaLabel: t('myTasks.openTasks', 'Open tasks') },
              { value: 'completed', label: t('myTasks.completed', 'Completed') },
            ]}
          />
          <div className="flex w-full items-center gap-2 min-[640px]:max-w-md">
            {/* #1461: a due=week drill names the active window and can clear it. */}
            {dueBy && (
              <StatusPill variant="warn" className="shrink-0">
                <button type="button" onClick={clearDueFilter} className="inline-flex items-center gap-1" aria-label={tasksT('clearDueWeek', 'Clear the due-this-week filter')}>
                  {tasksT('dueThisWeek', 'Due this week')}
                  <span aria-hidden="true">✕</span>
                </button>
              </StatusPill>
            )}
            {/* Shared list search (Companies/Projects pattern): DESIGN search shell + the
                `search_used` analytics contract; `flex-1` fills the toolbar row, and below `sm`
                the variant classes drop the base `min-w-[190px]` clip (clsx cannot merge). */}
            <SearchMini
              aria-label={t('myTasks.searchLabel', 'Search your tasks')}
              placeholder={t('myTasks.searchPlaceholder', 'Search your tasks')}
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              searchSurface="my-tasks-list"
              module="tasks"
              resultCount={visibleTasks.length}
              containerClassName="flex-1 max-sm:w-full max-sm:min-w-0"
            />
            {search && (
              <button
                type="button"
                onClick={() => setSearch('')}
                className="touch-target h-8 shrink-0 rounded-lg px-2 text-control font-medium text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {t('myTasks.clearSearch', 'Clear search')}
              </button>
            )}
          </div>
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
        </div>
      )}

      {!isPending && !isError && grouped.length > 0 && (
        <div className="space-y-6">
          {grouped.map((group) => (
            <section key={group.projectId} aria-label={group.projectName}>
              <h2 className="mb-2 text-control font-semibold text-muted-foreground">
                {/* CW-7: the Engineer's task entry point deep-links to the project's Tasks tab
                    explicitly (/projects/:id/tasks) — the project URL default is role-invariant
                    Overview, so this link carries the intent rather than mutating the default. */}
                {group.projectId ? (
                  <Link
                    to={`/projects/${group.projectId}/tasks`}
                    title={group.legalName && group.legalName !== group.projectName ? group.legalName : undefined}
                    className="rounded hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    {group.projectName}
                  </Link>
                ) : (
                  // FR-FCT-041: a heading, NOT a link — there is nothing to navigate to, and a link
                  // to `/projects/null/tasks` is what this replaces.
                  <span data-testid="my-tasks-no-project-heading">{group.projectName}</span>
                )}
              </h2>
              <div className="rounded-lg border border-border bg-card divide-y divide-border">
                {group.items.map((task) => (
                  <div
                    key={task.id}
                    className="flex flex-col gap-2 px-4 py-3 min-[560px]:flex-row min-[560px]:items-center min-[560px]:justify-between"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex min-w-0 flex-col items-start gap-1 min-[560px]:flex-row min-[560px]:items-center min-[560px]:gap-2">
                        {/* Fix #6 (AC-FIX6-NAV-01): task name opens the project's Tasks tab.
                            No /tasks/:id route exists; navigating to /projects/:id/tasks is the
                            lower-risk option — the tab is already deep-linkable (App.tsx). */}
                        {/* AC-JR-T25: task name deep-links to the specific task row via
                            #task-<id> anchor — TasksTab scrolls to and highlights it. */}
                        {task.project_id || task.meeting_id ? (
                          <Link
                            to={task.project_id ? `/projects/${task.project_id}/tasks#task-${task.id}` : `/meetings/${task.meeting_id}#task-${task.id}`}
                            className="block min-w-0 flex-1 break-words text-control font-medium hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded sm:truncate"
                            title={task.name}
                          >
                            {task.name}
                          </Link>
                        ) : (
                          <span
                            className="block min-w-0 flex-1 break-words text-control font-medium sm:truncate"
                            title={task.name}
                          >
                            {task.name}
                          </span>
                        )}
                        {/* AC-IFW-TASKS-01: overdue badge — color+shape, not color-only (WCAG AA). */}
                        {isOverdueTask(task, today) && (
                          <LateText
                            data-testid={`my-task-late-status-${task.id}`}
                            emphasis={isMostUrgentLateRow(lateTasks, task)}
                          >
                            {formatDaysLate(task.end_date, tStatus) ?? t('myTasks.overdue', 'Overdue')}
                          </LateText>
                        )}
                      </div>
                      {(task.start_date || task.end_date) && (
                        <span className="mt-0.5 block text-control text-muted-foreground">
                          {task.start_date && (
                            <span>
                              {t('myTasks.start', 'Start {{date}}', {
                                date: formatDay(task.start_date),
                              })}
                            </span>
                          )}
                          {task.start_date && task.end_date && <span className="mx-1">·</span>}
                          {task.end_date && (
                            <span>
                              {t('myTasks.due', 'Due {{date}}', {
                                date: formatDay(task.end_date),
                              })}
                            </span>
                          )}
                        </span>
                      )}
                    </div>
                    {/* Action cluster: Log time + status control. */}
                    <div className="flex flex-wrap items-center gap-2 min-[560px]:shrink-0 min-[560px]:justify-end">
                      {/* #790: comments for ANY task of mine — also the only surface for a project-less task. */}
                      <button
                        type="button"
                        aria-label={`${t('comments.open', 'Comments')} ${task.name}`}
                        onClick={() => setCommentsTask({ id: task.id, name: task.name })}
                        className="inline-flex h-7 items-center max-md:h-11 rounded-lg border border-input bg-background px-2.5 text-control font-medium text-foreground hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        {t('comments.open', 'Comments')}
                      </button>
                      {/* AC-IFW-TASKS-02: Log time → Timesheets pre-filled with this task's project.
                          ⚑ FR-FCT-042: absent entirely on a project-less task. `timesheet_entries`
                          keeps `project_id NOT NULL` (FR-FCT-005), so the destination CANNOT accept
                          this task — offering the control and failing at the far end would be worse
                          than not offering it. */}
                      {task.project_id ? (
                        <Link
                          to={`/timesheets?project=${task.project_id}`}
                          className="inline-flex h-7 items-center max-md:h-11 rounded-lg border border-input bg-background px-2.5 text-control font-medium text-foreground hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        >
                          {t('myTasks.logTime', 'Log time')}
                        </Link>
                      ) : null}
                      {/* Fix #6 (AC-FIX6-NAV-02/03): use SelectField (app's shared status
                          control, matching the TasksTab pattern) instead of a raw OS <select>.
                          Engineer may set own task status per the `taskStatus` policy. */}
                      <SelectField
                        hideLabel
                        label={`${t('myTasks.changeStatusOf', 'Change status of')} ${task.name}`}
                        value={task.status}
                        disabled={updateStatus.isPending}
                        onChange={(v) =>
                          updateStatus.mutate(
                            { id: task.id, projectId: task.project_id, status: v as TaskStatus },
                            {
                              onError: (err) => {
                                const { headline, detail } = classifyMutationError(err);
                                toast(headline, detail, 'warning');
                              },
                            },
                          )
                        }
                        options={TASK_STATUS_OPTIONS.map((s) => ({ value: s, label: statusLabels[s] }))}
                        className="w-auto min-w-[120px]"
                      />
                    </div>
                  </div>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
      <TaskCommentsDrawer task={commentsTask} onClose={() => setCommentsTask(null)} />
    </div>
  );
};

export default MyTasks;
