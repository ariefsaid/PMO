import React from 'react';
import { Link } from 'react-router-dom';
import { ListState } from '@/src/components/ui';
import { useMyTasks, useMyTaskMutations } from '@/src/hooks/useMyTasks';
import { formatDate } from '@/src/lib/format';
import type { TaskStatus } from '@/src/lib/db/tasks';

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

  // Group by project for a structured "what do I do today" view.
  const grouped = React.useMemo(() => {
    if (!tasks) return [];
    const map = new Map<string, { projectId: string; projectName: string; items: typeof tasks }>();
    for (const t of tasks) {
      if (!map.has(t.project_id)) {
        map.set(t.project_id, { projectId: t.project_id, projectName: t.project_name, items: [] });
      }
      map.get(t.project_id)!.items.push(t);
    }
    return [...map.values()];
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
                    className="flex items-center justify-between gap-3 px-4 py-3"
                  >
                    <div className="min-w-0 flex-1">
                      <span className="block truncate text-[13.5px] font-medium" title={task.name}>
                        {task.name}
                      </span>
                      {(task.start_date || task.end_date) && (
                        <span className="mt-0.5 block text-[12px] text-muted-foreground">
                          {task.start_date && <span>Start {formatDate(task.start_date)}</span>}
                          {task.start_date && task.end_date && <span className="mx-1">·</span>}
                          {task.end_date && <span>Due {formatDate(task.end_date)}</span>}
                        </span>
                      )}
                    </div>
                    {/* Inline status control — the select IS the status display (its selected
                        value), so no separate pill. Engineer may set own task status per the
                        `taskStatus` policy predicate (assignee_id = self). */}
                    <select
                      aria-label={`Change status of ${task.name}`}
                      value={task.status}
                      onChange={(e) =>
                        updateStatus.mutate({ id: task.id, status: e.target.value as TaskStatus })
                      }
                      className="h-7 shrink-0 rounded-md border border-input bg-background px-2 text-[12.5px] text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                    >
                      {TASK_STATUS_OPTIONS.map((s) => (
                        <option key={s} value={s}>
                          {s}
                        </option>
                      ))}
                    </select>
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
