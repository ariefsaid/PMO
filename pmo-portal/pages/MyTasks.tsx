import React from 'react';
import { Link } from 'react-router-dom';
import { ListState, StatusPill, SelectField, useToast } from '@/src/components/ui';
import { useMyTasks, useMyTaskMutations } from '@/src/hooks/useMyTasks';
import { formatDate } from '@/src/lib/format';
import { classifyMutationError } from '@/src/lib/classifyMutationError';
import type { TaskStatus } from '@/src/lib/db/tasks';

/** AC-IFW-TASKS-01: Today's ISO date string (YYYY-MM-DD) for overdue comparison. */
function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
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
  const { data: tasks, isPending, isError, refetch } = useMyTasks();
  const { updateStatus } = useMyTaskMutations();
  const { toast } = useToast();

  // Group by project for a structured "what do I do today" view, then sort each group by urgency.
  // AC-IFW-TASKS-01: within each project group, overdue open tasks sort first (key=0), then
  // non-overdue open (key=1), then Done (key=2). Secondary sort: end_date asc (nulls last).
  const grouped = React.useMemo(() => {
    if (!tasks) return [];
    const map = new Map<string, { projectId: string; projectName: string; items: typeof tasks }>();
    for (const t of tasks) {
      if (!map.has(t.project_id)) {
        map.set(t.project_id, { projectId: t.project_id, projectName: t.project_name, items: [] });
      }
      map.get(t.project_id)!.items.push(t);
    }
    const groups = [...map.values()];
    // Sort within each group
    for (const g of groups) {
      g.items.sort((a, b) => {
        const ka = urgencyKey(a);
        const kb = urgencyKey(b);
        if (ka !== kb) return ka - kb;
        // Secondary: end_date asc, nulls last
        if (a.end_date === b.end_date) return 0;
        if (!a.end_date) return 1;
        if (!b.end_date) return -1;
        return a.end_date < b.end_date ? -1 : 1;
      });
    }
    return groups;
  }, [tasks]);

  return (
    <div>
      <div className="mb-4">
        <h1 className="text-[24px] font-bold tracking-[-0.02em]">My Tasks</h1>
        <p className="mt-0.5 text-sm text-muted-foreground">
          Your assigned tasks across all projects.
        </p>
      </div>

      {isPending && (
        <ListState variant="loading" rows={4} />
      )}

      {isError && (
        <ListState
          variant="error"
          title="Couldn't load your tasks"
          sub="Something went wrong fetching your assigned tasks."
          onRetry={() => refetch()}
        />
      )}

      {!isPending && !isError && tasks && tasks.length === 0 && (
        <ListState
          variant="empty"
          icon="check"
          title="No tasks assigned to you"
          sub="When tasks are assigned to you they will appear here across all your projects."
        />
      )}

      {!isPending && !isError && grouped.length > 0 && (
        <div className="space-y-6">
          {grouped.map((group) => (
            <section key={group.projectId} aria-label={group.projectName}>
              <h2 className="mb-2 text-[13px] font-semibold uppercase tracking-[0.05em] text-muted-foreground">
                {/* CW-7: the Engineer's task entry point deep-links to the project's Tasks tab
                    explicitly (/projects/:id/tasks) — the project URL default is role-invariant
                    Overview, so this link carries the intent rather than mutating the default. */}
                <Link
                  to={`/projects/${group.projectId}/tasks`}
                  className="rounded hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {group.projectName}
                </Link>
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
                        <Link
                          to={`/projects/${task.project_id}/tasks#task-${task.id}`}
                          className="block min-w-0 flex-1 break-words text-[13.5px] font-medium hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded sm:truncate"
                          title={task.name}
                        >
                          {task.name}
                        </Link>
                        {/* AC-IFW-TASKS-01: overdue badge — color+shape, not color-only (WCAG AA). */}
                        {isOverdueTask(task) && (
                          <StatusPill variant="warn">Overdue</StatusPill>
                        )}
                      </div>
                      {(task.start_date || task.end_date) && (
                        <span className="mt-0.5 block text-[12px] text-muted-foreground">
                          {task.start_date && <span>Start {formatDate(task.start_date)}</span>}
                          {task.start_date && task.end_date && <span className="mx-1">·</span>}
                          {task.end_date && <span>Due {formatDate(task.end_date)}</span>}
                        </span>
                      )}
                    </div>
                    {/* Action cluster: Log time + status control. */}
                    <div className="flex flex-wrap items-center gap-2 min-[560px]:shrink-0 min-[560px]:justify-end">
                      {/* AC-IFW-TASKS-02: Log time → Timesheets pre-filled with this task's project. */}
                      <Link
                        to={`/timesheets?project=${task.project_id}`}
                        className="inline-flex h-7 items-center rounded-lg border border-input bg-background px-2.5 text-[12px] font-medium text-foreground hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        Log time
                      </Link>
                      {/* Fix #6 (AC-FIX6-NAV-02/03): use SelectField (app's shared status
                          control, matching the TasksTab pattern) instead of a raw OS <select>.
                          Engineer may set own task status per the `taskStatus` policy. */}
                      <SelectField
                        hideLabel
                        label={`Change status of ${task.name}`}
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
                        options={TASK_STATUS_OPTIONS.map((s) => ({ value: s, label: s }))}
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
    </div>
  );
};

export default MyTasks;
