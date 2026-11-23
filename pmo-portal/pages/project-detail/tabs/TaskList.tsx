/**
 * Task list columns (XG03-005 / T-44) — the list view's column definitions, isolated from
 * TasksTab's navigation and mutation orchestration. TasksTab stays the owner of permissions
 * and mutation callbacks and hands them in through {@link TaskColumnDeps}; the columns render
 * whatever the current role allows (ADR-0016: FE is the clarity projection, RLS is the authority).
 */
import { Avatar } from '@/src/components/ui/Avatar';
import React, { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { Tooltip, ProgressBar, Icon, type Column } from '@/src/components/ui';
import type { TaskRollup } from '@/src/lib/tasks/taskTree';
import type { PendingPushState } from '@/src/lib/adapterSeam/pendingPush';
import { IDLE_PENDING_PUSH } from '@/src/lib/adapterSeam/pendingPush';
import type { TaskWithRefs, TaskStatus } from '@/src/lib/db/tasks';
import { formatDay, formatDayRange } from '@/src/lib/format';
import { daysLate } from './taskViewModel';
import { TaskStatusCell } from './TaskStatusCell';

/**
 * OD-INT-9 subtask nesting — the horizontal indent applied per depth level in the Task-name
 * cell. A multiple of the DESIGN.md `spacing.base` token (4px), NOT an ad-hoc pixel value.
 */
const SUBTASK_INDENT_PX = 16;

/** What the columns need from the workspace: today's org day, the highlighted row, and the
 *  permission/write seam (all decided in TasksTab, never re-derived here). */
export interface TaskColumnDeps {
  today: string;
  highlightedTaskId: string | null;
  canSetStatus: (task: TaskWithRefs) => boolean;
  statusBusy: boolean;
  onStatusChange: (task: TaskWithRefs, status: TaskStatus) => void;
  pendingPushByTask: Record<string, PendingPushState>;
}

/** The outline the grouped list hands the columns (#2807): depth, which rows are parents, and their roll-up. */
export interface TaskTreeView {
  depths: Map<string, number>;
  /** Roll-up of every task with a live child (buildRollups over the whole project). */
  rollups: Map<string, TaskRollup>;
  collapsed: ReadonlySet<string>;
  onToggle: (taskId: string) => void;
}

function buildTaskColumns(
  t: TFunction,
  deps: TaskColumnDeps,
  tree: TaskTreeView,
): Column<TaskWithRefs>[] {
  const { today, highlightedTaskId, canSetStatus, statusBusy, onStatusChange, pendingPushByTask } = deps;
  const { depths, rollups, collapsed, onToggle } = tree;
  return [
    {
      key: 'name',
      header: t('projectDetail.tasks.column.task', 'Task'),
      kind: 'primary',
      primaryTitle: (task) => task.name,
      cell: (task) => {
        const depth = depths.get(task.id) ?? 0;
        const rollup = rollups.get(task.id);
        const open = !collapsed.has(task.id);
        return <span
          className="flex min-w-0 items-start gap-1"
          style={depth > 0 ? { paddingLeft: depth * SUBTASK_INDENT_PX } : undefined}
        >
          {rollup ? <button
            type="button"
            aria-expanded={open}
            aria-label={open
              ? t('projectDetail.tasks.tree.collapse', 'Hide subtasks of {{name}}', { name: task.name })
              : t('projectDetail.tasks.tree.expand', 'Show subtasks of {{name}}', { name: task.name })}
            onClick={(e) => { e.stopPropagation(); onToggle(task.id); }}
            className="touch-target -my-1 inline-flex size-6 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-secondary hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"
          >
            <Icon name="chev" className={`size-3.5 transition-transform${open ? ' rotate-90' : ''}`} />
          </button> : depth > 0 || rollups.size > 0 ? <span aria-hidden className="inline-block size-6 shrink-0" /> : null}
          <span
            id={`task-${task.id}`}
            className={`block min-w-0 whitespace-normal break-words ${rollup ? 'font-semibold' : depth > 0 ? 'font-normal' : 'font-semibold'}${highlightedTaskId === task.id ? ' ring-2 ring-primary ring-offset-1 rounded task-highlight' : ''}`}
            title={task.name}
          >
            {depth > 0 && <span className="sr-only">{`${t('projectDetail.tasks.subtaskLevel', 'Subtask, level')} ${depth}. `}</span>}
            {task.name}
          </span>
        </span>;
      },
      secondaryCell: (task) => task.priority ? (
        <span className="text-sm font-normal text-muted-foreground" title={t('projectDetail.tasks.prioritySource', 'Source: task priority field')}>{task.priority}</span>
      ) : null,
    },
    {
      key: 'assignee',
      header: t('projectDetail.tasks.column.assignee', 'Assignee'),
      cell: (task) => {
        if (!task.assignee) return <span className="text-muted-foreground">{t('projectDetail.tasks.unassigned', 'Unassigned')}</span>;
        return <span className="inline-flex min-w-0 items-center gap-2" title={task.assignee.full_name}>
          <Avatar name={task.assignee.full_name} decorative fallback="" />
          <span className="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-muted-foreground">{task.assignee.full_name}</span>
        </span>;
      },
      colClassName: 'hidden sm:table-cell',
    },
    {
      key: 'due',
      header: t('projectDetail.tasks.column.due', 'Due'),
      kind: 'date',
      size: 260,
      cell: (task) => rollups.has(task.id) ? <RollupDates rollup={rollups.get(task.id)!} t={t} /> : task.end_date ? <Tooltip content={t(
        'projectDetail.tasks.dueTooltip',
        'Due date from the task record. Late days compare the due date with today in the organization timezone.',
      )}>
        <span tabIndex={0} className={`block whitespace-normal break-words tabular ${task.status !== 'Done' && task.end_date < today ? 'text-destructive-text' : 'text-muted-foreground'}`}>
          {formatDay(task.end_date)}
          {task.status !== 'Done' && task.end_date < today && (
            <span> · {daysLate(task.end_date, today)} {daysLate(task.end_date, today) === 1 ? t('projectDetail.tasks.dayLate', 'day overdue') : t('projectDetail.tasks.daysLate', 'days overdue')}</span>
          )}
        </span>
      </Tooltip> : <span className="text-muted-foreground">—</span>,
    },
    {
      key: 'status',
      header: t('projectDetail.tasks.column.status', 'Status'),
      cell: (task) => rollups.has(task.id) ? <RollupProgress rollup={rollups.get(task.id)!} t={t} /> : (
        <TaskStatusCell
          task={task}
          editable={canSetStatus(task)}
          disabled={statusBusy}
          onChange={(row, status) => onStatusChange(row, status)}
          pendingPush={pendingPushByTask[task.id] ?? IDLE_PENDING_PUSH}
        />
      ),
    },
  ];
}

/** A parent's dates: the span of its leaves. */
function RollupDates({ rollup, t }: { rollup: TaskRollup; t: TFunction }) {
  if (!rollup.start && !rollup.end) return <span className="text-muted-foreground">—</span>;
  return <Tooltip content={t('projectDetail.tasks.tree.datesTip', 'From the earliest start to the latest due date of its subtasks.')}>
    <span tabIndex={0} className="block whitespace-normal break-words tabular text-muted-foreground">
      {rollup.start && rollup.end ? formatDayRange(rollup.start, rollup.end) : formatDay((rollup.start ?? rollup.end)!)}
    </span>
  </Tooltip>;
}

/** A parent's progress: done subtasks out of all, never its own status. */
function RollupProgress({ rollup, t }: { rollup: TaskRollup; t: TFunction }) {
  return <Tooltip content={t('projectDetail.tasks.tree.progressTip', '{{done}} of {{total}} subtasks done. A task with subtasks takes its status from them.', { done: rollup.doneCount, total: rollup.leafCount })}>
    <span tabIndex={0} className="inline-flex min-w-0 items-center">
      <ProgressBar value={Math.round(rollup.pct)} tone={rollup.pct >= 100 ? 'success' : 'primary'} showValue compact aria-label={t('projectDetail.tasks.tree.progress', 'Subtask progress')} />
    </span>
  </Tooltip>;
}

/**
 * The workspace's column factory. Binds the `project` namespace here (the cells' t() calls
 * live in THIS file, so the i18n completeness gate resolves their catalogue here too) and
 * hands TasksTab a stable-shaped `buildColumns(tree)` factory. The factory's identity follows
 * `deps` — TasksTab memoises that object (#2104), so an unrelated re-render no longer rebuilds
 * the columns and the memoised tables keep bailing out.
 */
export function useProjectTaskColumns(
  deps: TaskColumnDeps,
): (tree: TaskTreeView) => Column<TaskWithRefs>[] {
  const { t } = useTranslation('project');
  return useCallback((tree) => buildTaskColumns(t, deps, tree), [t, deps]);
}
