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
import { Tooltip, type Column } from '@/src/components/ui';
import type { PendingPushState } from '@/src/lib/adapterSeam/pendingPush';
import { IDLE_PENDING_PUSH } from '@/src/lib/adapterSeam/pendingPush';
import type { TaskWithRefs, TaskStatus } from '@/src/lib/db/tasks';
import { formatDay } from '@/src/lib/format';
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

function buildTaskColumns(
  t: TFunction,
  deps: TaskColumnDeps,
  depths: Map<string, number>,
): Column<TaskWithRefs>[] {
  const { today, highlightedTaskId, canSetStatus, statusBusy, onStatusChange, pendingPushByTask } = deps;
  return [
    {
      key: 'name',
      header: t('projectDetail.tasks.column.task', 'Task'),
      kind: 'primary',
      primaryTitle: (task) => task.name,
      cell: (task) => {
        const depth = depths.get(task.id) ?? 0;
        return <span
          id={`task-${task.id}`}
          className={`block whitespace-normal break-words font-semibold${highlightedTaskId === task.id ? ' ring-2 ring-primary ring-offset-1 rounded task-highlight' : ''}`}
          style={depth > 0 ? { paddingLeft: depth * SUBTASK_INDENT_PX } : undefined}
          title={task.name}
        >
          {depth > 0 && <span className="sr-only">{`${t('projectDetail.tasks.subtaskLevel', 'Subtask, level')} ${depth}. `}</span>}
          {task.name}
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
          <span className="truncate text-muted-foreground">{task.assignee.full_name}</span>
        </span>;
      },
      colClassName: 'hidden sm:table-cell',
    },
    {
      key: 'due',
      header: t('projectDetail.tasks.column.due', 'Due'),
      kind: 'date',
      size: 260,
      cell: (task) => task.end_date ? <Tooltip content={t(
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
      cell: (task) => (
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

/**
 * The workspace's column factory. Binds the `project` namespace here (the cells' t() calls
 * live in THIS file, so the i18n completeness gate resolves their catalogue here too) and
 * hands TasksTab a stable-shaped `buildColumns(depths)` factory — the same per-render
 * identity and recompute behavior the inline factory always had.
 */
export function useProjectTaskColumns(
  deps: TaskColumnDeps,
): (depths: Map<string, number>) => Column<TaskWithRefs>[] {
  const { t } = useTranslation('project');
  return useCallback((depths) => buildTaskColumns(t, deps, depths), [t, deps]);
}
