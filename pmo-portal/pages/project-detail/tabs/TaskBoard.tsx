/**
 * Task board view (XG03-005 / T-44) — the status-column kanban, extracted from TasksTab.
 * Dragging a card to another column (pointer and touch, DND #1637) and the card menu's "Move to"
 * items (the keyboard path) are two ways to ask for the SAME write, gated by the same permission. TasksTab owns the permission decision (`canSetStatus`) and
 * the mutation callback (`onStatusChange`); this module owns only board presentation and the
 * optimistic-move choreography around that single write.
 */
import React, { useMemo } from 'react';
import { Avatar } from '@/src/components/ui/Avatar';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import { Kanban, KanbanColumn, Tooltip, Icon, type RowMenuItem } from '@/src/components/ui';
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from '@/src/components/shadcn/dropdown-menu';
import { TaskPushBadge } from '@/src/components/tasks/TaskPushBadge';
import { BoardDnd, DraggableCard, DroppableColumn } from '@/src/components/kanban/BoardDnd';
import { useOptimisticMoves } from '@/src/components/kanban/useOptimisticMoves';
import type { PendingPushState } from '@/src/lib/adapterSeam/pendingPush';
import { IDLE_PENDING_PUSH } from '@/src/lib/adapterSeam/pendingPush';
import type { TaskWithRefs, TaskStatus } from '@/src/lib/db/tasks';
import { formatDay } from '@/src/lib/format';
import { BOARD_STATUSES, daysLate, isOverdue } from './taskViewModel';

// ── Card menu (Base UI Menu: focus, arrow keys, Escape, positioning come from the library) ──

const TaskCardMenu: React.FC<{ items: RowMenuItem[] }> = ({ items }) => {
  const { t } = useTranslation('project');
  // The popup is portaled but React events still bubble to the card: a menu click must not open the task.
  return <span className="shrink-0" onClick={(event) => event.stopPropagation()}>
    <DropdownMenu>
      <DropdownMenuTrigger aria-label={t('table.rowActions', 'Row actions')} className="touch-target grid size-8 cursor-pointer place-items-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring">
        <span aria-hidden="true" className="text-base leading-none">⋯</span>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-auto min-w-[160px]">
        {items.map((item) => <DropdownMenuItem key={item.label} disabled={item.disabled} variant={item.danger ? 'destructive' : 'default'} onClick={item.onClick}>{item.label}</DropdownMenuItem>)}
      </DropdownMenuContent>
    </DropdownMenu>
  </span>;
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
 * Status-column board. The column is the status, so a card shows no status control: it is
 * dragged to a column (pointer and touch, DND #1637) or moved with the menu's "Move to" items
 * (the keyboard and screen-reader path), both the same write gated by the same `canSetStatus`
 * (managers: any; Engineer: own task only).
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
  const cardMenu = (task: TaskWithRefs): RowMenuItem[] => [
    ...(canSetStatus(task) ? BOARD_STATUSES.filter((to) => to !== task.status).map((to) => ({
      label: t('projectDetail.tasks.moveTo', 'Move to {{status}}', { status: to }),
      disabled: statusBusy,
      onClick: () => void dropTask(task.id, to),
    })) : []),
    ...rowMenu(task),
  ];
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
          <span className="block whitespace-normal break-words text-sm font-semibold leading-snug">{byId.get(id)?.name}</span>
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
            presentation="flat"
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
                <button type="button" aria-label={t('projectDetail.tasks.openTask', 'Open task {{name}}', { name: task.name })} onClick={(event) => { event.stopPropagation(); onActivate(task); }} className="min-w-0 text-left text-sm font-semibold leading-snug hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
                  <span className="block whitespace-normal break-words">{task.name}</span>
                </button>
                <div className="flex shrink-0 items-center gap-1">
                  {externallyOwned && <TaskPushBadge state={pendingPushByTask[task.id] ?? IDLE_PENDING_PUSH} />}
                  <TaskCardMenu items={cardMenu(task)} />
                </div>
              </div>
              <div className="mt-2 flex min-w-0 items-center gap-2 text-sm text-muted-foreground">
                {task.assignee ? <>
                  <Avatar name={task.assignee.full_name} size="xs" decorative fallback="" />
                  <span className="truncate">{task.assignee.full_name}</span>
                </> : t('projectDetail.tasks.unassigned', 'Unassigned')}
                {task.end_date && <Tooltip content={t('projectDetail.tasks.dueTooltip', 'Due date from the task record. Late days compare the due date with today in the organization timezone.')}>
                  <span tabIndex={0} className={`ml-auto shrink-0 tabular ${isOverdue(task, today) ? 'text-destructive-text' : ''}`}>
                    {isOverdue(task, today) ? t('projectDetail.tasks.daysLateCount', '{{count}}d late', { count: daysLate(task.end_date, today) }) : formatDay(task.end_date)}
                  </span>
                </Tooltip>}
              </div>
              {moves.stateOf(task.id) === 'saving' && (
                <p className="mt-1 text-sm text-muted-foreground">{t('boardDrag:saving', 'Saving…')}</p>
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
