/**
 * Task board view (XG03-005 / T-44) — the status-column kanban, extracted from TasksTab.
 * Each card carries a status select for those who may move it, or a static pill otherwise;
 * dragging to another column (pointer and touch, DND #1637) is a shortcut to the SAME write,
 * gated by the same permission. TasksTab owns the permission decision (`canSetStatus`) and
 * the mutation callback (`onStatusChange`); this module owns only board presentation and the
 * optimistic-move choreography around that single write.
 */
import React, { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import { Kanban, KanbanColumn, SelectField, StatusPill, Tooltip, Icon, type RowMenuItem } from '@/src/components/ui';
import { TaskPushBadge } from '@/src/components/tasks/TaskPushBadge';
import { workflowVariant } from '@/src/lib/status/statusVariants';
import { BoardDnd, DraggableCard, DroppableColumn } from '@/src/components/kanban/BoardDnd';
import { useOptimisticMoves } from '@/src/components/kanban/useOptimisticMoves';
import type { PendingPushState } from '@/src/lib/adapterSeam/pendingPush';
import { IDLE_PENDING_PUSH } from '@/src/lib/adapterSeam/pendingPush';
import type { TaskWithRefs, TaskStatus } from '@/src/lib/db/tasks';
import { formatDateOnly } from '@/src/lib/format';
import { BOARD_STATUSES, STATUS_OPTIONS, daysLate } from './taskViewModel';

// ── Row actions disclosure (board cards) ─────────────────────────────────

const TaskActionsDisclosure: React.FC<{ items: RowMenuItem[] }> = ({ items }) => {
  const { t } = useTranslation('project');
  const [open, setOpen] = useState(false);
  const closeOnEscape = (event: React.KeyboardEvent<HTMLElement>) => {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    const details = event.currentTarget.closest('details');
    details?.removeAttribute('open');
    setOpen(false);
    details?.querySelector('summary')?.focus();
  };
  return <details className="relative shrink-0" onToggle={(event) => setOpen(event.currentTarget.open)} onClick={(event) => event.stopPropagation()} onKeyDown={closeOnEscape}>
    <summary role="button" aria-label={t('table.rowActions', 'Row actions')} aria-haspopup="menu" aria-expanded={open} className="touch-target grid size-8 cursor-pointer list-none place-items-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring">
      <span aria-hidden="true" className="text-base leading-none">⋯</span>
    </summary>
    <div role="menu" className="absolute right-0 top-full z-30 mt-1 min-w-[160px] rounded-md border border-border bg-popover p-1 shadow-[0_10px_30px_hsl(240_10%_8%/0.16)]">
      {items.map((item) => <button key={item.label} role="menuitem" type="button" disabled={item.disabled} className={`block min-h-8 w-full rounded-sm px-2.5 py-1.5 text-left text-[13px] hover:bg-accent disabled:opacity-50${item.danger ? ' text-destructive-text' : ''}`} onClick={(event) => {
        event.stopPropagation();
        event.currentTarget.closest('details')?.removeAttribute('open');
        item.onClick();
      }}>{item.label}</button>)}
    </div>
  </details>;
};

interface TaskBoardProps {
  tasks: TaskWithRefs[];
  canSetStatus: (t: TaskWithRefs) => boolean;
  onStatusChange: (t: TaskWithRefs, status: TaskStatus) => Promise<boolean>;
  onActivate: (t: TaskWithRefs) => void;
  rowMenu: (task: TaskWithRefs) => RowMenuItem[];
  today: string;
  statusBusy: boolean;
  externallyOwned: boolean;
  pendingPushByTask: Record<string, PendingPushState>;
  orgId: string | undefined;
  projectId: string;
}

/**
 * Status-column board. Each card carries a status `<select>` for those who may
 * move it (managers: any; Engineer: own task only), or a static pill otherwise. That select
 * stays the keyboard and screen-reader path; dragging a card to another column (pointer and
 * touch, DND #1637) is a shortcut to the same write, gated by the same `canSetStatus`.
 */
const TaskBoard: React.FC<TaskBoardProps> = ({
  tasks,
  canSetStatus,
  onStatusChange,
  onActivate,
  rowMenu,
  today,
  statusBusy,
  externallyOwned,
  pendingPushByTask,
  orgId,
  projectId,
}) => {
  const { t } = useTranslation('project');
  const qc = useQueryClient();
  const moves = useOptimisticMoves();
  const byId = useMemo(() => new Map(tasks.map((task) => [task.id, task])), [tasks]);
  const byStatus = (s: TaskStatus) => tasks.filter((task) => moves.columnOf(task.id, task.status) === s);
  // Same write, toasts and external routing as the select. The card is held in the target column
  // while it saves and released once the tasks query has refetched, or at once on a failed write.
  const dropTask = async (id: string, to: TaskStatus) => {
    const task = byId.get(id);
    if (!task || !canSetStatus(task) || to === task.status) return;
    moves.hold(id, to);
    moves.save(id);
    let ok = false;
    try {
      ok = await onStatusChange(task, to);
      if (ok) await qc.invalidateQueries({ queryKey: ['tasks', orgId, projectId] }, { cancelRefetch: false });
    } finally {
      if (ok) await moves.releaseAfterRender(id);
      else moves.release(id);
    }
  };
  return (
    <BoardDnd
      canDrop={(id, col) => { const task = byId.get(id); return !!task && canSetStatus(task) && col !== task.status; }}
      isHome={(id, col) => byId.get(id)?.status === col}
      onMove={(id, col) => void dropTask(id, col as TaskStatus)}
      cardLabel={(id) => byId.get(id)?.name ?? ''}
      columnLabel={(id) => id}
      renderOverlay={(id) => (
        // The card being held, at its own width (dnd-kit sizes the overlay to the source card).
        <div className="w-full min-w-0 rounded-md border border-border bg-card px-3 py-2.5 shadow-[0_10px_30px_hsl(240_10%_8%/0.16)]">
          <span className="block whitespace-normal break-words text-[13px] font-semibold leading-snug">{byId.get(id)?.name}</span>
        </div>
      )}
    >
    <Kanban className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {BOARD_STATUSES.map((s) => {
        const col = byStatus(s);
        return (
          <DroppableColumn key={s} id={s} testId={`task-col-${s}`} className="flex min-w-0 flex-col">
            {(dropState) => (
          <KanbanColumn
            title={s}
            dropState={dropState}
            count={col.length}
            emptyMessage={t('projectDetail.tasks.board.noTasks', 'No tasks')}
            totals={<Tooltip content={t('projectDetail.tasks.board.countTooltip', 'Count of current filtered project tasks in this status. Source: the current task list and filters.')}>
              <button type="button" aria-label={t('projectDetail.tasks.board.countHelp', 'Explain status count')} className="inline-flex rounded-sm text-muted-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"><Icon name="info" className="size-3.5" /></button>
            </Tooltip>}
          >
            {col.map((task) => <DraggableCard key={task.id} id={task.id} disabled={!canSetStatus(task)} moveState={moves.stateOf(task.id)}>
            <div onClick={() => onActivate(task)} className="min-w-0 cursor-pointer rounded-md border border-border bg-card px-3 py-2.5 hover:border-muted-foreground/35 hover:bg-accent/40">
              <div className="flex items-start justify-between gap-2">
                <button type="button" aria-label={t('projectDetail.tasks.openTask', 'Open task {{name}}', { name: task.name })} onClick={(event) => { event.stopPropagation(); onActivate(task); }} className="min-w-0 text-left text-[13px] font-semibold leading-snug hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
                  <span className="block whitespace-normal break-words">{task.name}</span>
                </button>
                <div className="flex shrink-0 items-center gap-1">
                  {externallyOwned && <TaskPushBadge state={pendingPushByTask[task.id] ?? IDLE_PENDING_PUSH} />}
                  <TaskActionsDisclosure items={rowMenu(task)} />
                </div>
              </div>
              <div className="mt-2 flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
                {task.assignee ? <>
                  <span aria-hidden="true" className="grid size-5 shrink-0 place-items-center rounded-full bg-secondary text-[11px] font-bold text-foreground">{task.assignee.full_name.trim().split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toUpperCase()}</span>
                  <span className="truncate">{task.assignee.full_name}</span>
                </> : t('projectDetail.tasks.unassigned', 'Unassigned')}
                {task.end_date && <Tooltip content={t('projectDetail.tasks.dueTooltip', 'Due date from the task record. Late days compare the due date with today in the organization timezone.')}>
                  <span tabIndex={0} className={`ml-auto shrink-0 tabular ${task.status !== 'Done' && task.end_date < today ? 'text-destructive-text' : ''}`}>
                    {task.status !== 'Done' && task.end_date < today ? t('projectDetail.tasks.daysLateCount', '{{count}}d late', { count: daysLate(task.end_date, today) }) : formatDateOnly(task.end_date)}
                  </span>
                </Tooltip>}
              </div>
              <div className="mt-2" onClick={(event) => event.stopPropagation()}>
                {canSetStatus(task) ? <SelectField
                  hideLabel
                  label={`${t('projectDetail.tasks.statusFor', 'Status for')} ${task.name}`}
                  value={task.status}
                  disabled={statusBusy}
                  onChange={(value) => onStatusChange(task, value as TaskStatus)}
                  options={STATUS_OPTIONS}
                  fullWidth
                /> : <StatusPill variant={workflowVariant(task.status)}>{task.status}</StatusPill>}
              </div>
              {moves.stateOf(task.id) === 'saving' && (
                <p className="mt-1 text-[11.5px] text-muted-foreground">{t('boardDrag:saving', 'Saving…')}</p>
              )}
            </div>
            </DraggableCard>)}
          </KanbanColumn>
            )}
          </DroppableColumn>
        );
      })}
    </Kanban>
    </BoardDnd>
  );
};

export default TaskBoard;
