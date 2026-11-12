import React from 'react';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import {
  Button,
  buttonClasses,
  Drawer,
  MenuButton,
  StatusPill,
} from '@/src/components/ui';
import { formatDay } from '@/src/lib/format';
import type { TaskWithRefs } from '@/src/lib/db/tasks';
import { CommentsSection } from '@/src/components/comments/CommentsSection';
import { RecordHistory } from '@/src/components/history/RecordHistory';
import { TaskPushBadge } from '@/src/components/tasks/TaskPushBadge';
import type { PendingPushState } from '@/src/lib/adapterSeam/pendingPush';
import { orderedTasks } from './taskViewModel';

interface TaskRecordDrawerProps {
  task: TaskWithRefs | null;
  allTasks: TaskWithRefs[];
  projectId: string;
  canEdit: boolean;
  canArchive: boolean;
  canDelete: boolean;
  externallyOwned: boolean;
  pendingPush: PendingPushState;
  openEdit: (task: TaskWithRefs) => void;
  onArchive: (task: TaskWithRefs) => void;
  onDelete: (task: TaskWithRefs) => void;
  openTask: (task: TaskWithRefs) => void;
  onClose: () => void;
  nestedOpen: boolean;
}

/** The task record drawer: details, subtasks, comments and history for one task. */
const TaskRecordDrawer: React.FC<TaskRecordDrawerProps> = ({
  task,
  allTasks,
  projectId,
  canEdit,
  canArchive,
  canDelete,
  externallyOwned,
  pendingPush,
  openEdit,
  onArchive,
  onDelete,
  openTask,
  onClose,
  nestedOpen,
}) => {
  const { t } = useTranslation('project');
  if (!task) return null;
  const subtasks = allTasks.filter((candidate) => candidate.parent_task_id === task.id && candidate.tombstoned_at == null);
  return <Drawer
    open
    width="lg"
    title={task.name}
    status={<StatusPill record="task" state={task.status} />}
    onClose={onClose}
    nestedOpen={nestedOpen}
    // Same header as every record drawer: main action · Open full page · ⋯ for the rare ones.
    headerActions={<>
      {canEdit && <Button size="sm" onClick={() => openEdit(task)}>{t('projectDetail.tasks.action.edit', 'Edit')}</Button>}
      <Link to={`/projects/${projectId}/tasks#task-${task.id}`} className={buttonClasses('outline', 'sm')}>{t('projectDetail.tasks.openFullRecord', 'Open full page')}</Link>
      {(canArchive || canDelete) && <MenuButton
        ariaLabel={t('projectDetail.tasks.drawerMoreActions', 'More task actions')}
        items={[
          ...(canArchive ? [{ label: task.archived_at == null ? t('projectDetail.tasks.action.archive', 'Archive') : t('projectDetail.tasks.action.unarchive', 'Unarchive'), onClick: () => onArchive(task) }] : []),
          ...(canDelete ? [{ label: t('projectDetail.tasks.action.delete', 'Delete'), onClick: () => onDelete(task), danger: true }] : []),
        ]}
      />}
    </>}
  >
    <div className="space-y-5">
      {externallyOwned && <TaskPushBadge state={pendingPush} />}
      <section aria-labelledby="task-drawer-description" className="space-y-2">
        <h2 id="task-drawer-description" className="text-sm font-semibold">{t('projectDetail.tasks.form.description', 'Description')}</h2>
        {task.description ? <p className="whitespace-pre-wrap break-words text-sm text-muted-foreground">{task.description}</p> : <p className="text-sm text-muted-foreground">{t('projectDetail.tasks.drawer.noDescription', 'No description provided.')}</p>}
      </section>
      <section aria-labelledby="task-drawer-details" className="space-y-2">
        <h2 id="task-drawer-details" className="text-sm font-semibold">{t('projectDetail.tasks.drawer.details', 'Details')}</h2>
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-2 text-sm">
          <dt className="text-muted-foreground">{t('projectDetail.tasks.column.assignee', 'Assignee')}</dt><dd className="min-w-0 break-words">{task.assignee?.full_name ?? t('projectDetail.tasks.unassigned', 'Unassigned')}</dd>
          <dt className="text-muted-foreground">{t('projectDetail.tasks.column.due', 'Due')}</dt><dd>{task.end_date ? formatDay(task.end_date) : '—'}</dd>
          <dt className="text-muted-foreground">{t('projectDetail.tasks.form.priority', 'Priority')}</dt><dd>{task.priority ?? t('projectDetail.tasks.noPriority', 'No priority')}</dd>
          <dt className="text-muted-foreground">{t('projectDetail.tasks.form.dependsOnLegend', 'Depends on')}</dt><dd className="min-w-0 break-words">{task.dependencies.length ? task.dependencies.map((dependency) => allTasks.find((candidate) => candidate.id === dependency.depends_on_id)?.name ?? dependency.depends_on_id).join(', ') : t('projectDetail.tasks.drawer.noDependencies', 'No dependencies are linked.')}</dd>
        </dl>
      </section>
      <section aria-labelledby="task-drawer-subtasks" className="space-y-2">
        <h2 id="task-drawer-subtasks" className="text-sm font-semibold">{t('projectDetail.tasks.drawer.subtasks', 'Subtasks')}</h2>
        {subtasks.length ? <ul className="divide-y divide-border rounded-md border border-border">
          {orderedTasks(subtasks).map((subtask) => <li key={subtask.id} className="flex min-w-0 items-center gap-2 px-3 py-2">
            <button type="button" className="min-w-0 flex-1 truncate text-left text-sm hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring" onClick={() => openTask(subtask)}>{subtask.name}</button>
            <StatusPill record="task" state={subtask.status} />
          </li>)}
        </ul> : <p className="text-sm text-muted-foreground">{t('projectDetail.tasks.drawer.noSubtasks', 'No subtasks.')}</p>}
      </section>
      <div className="space-y-2">
        <h2 className="text-sm font-semibold">{t('common:comments.title', 'Comments')}</h2>
        <CommentsSection entityType="task" entityId={task.id} hideTitle />
      </div>
      <section aria-labelledby="task-drawer-history" className="space-y-2">
        <h2 id="task-drawer-history" className="text-sm font-semibold">{t('projectDetail.tasks.drawer.history', 'History')}</h2>
        <RecordHistory entityType="task" entityId={task.id} />
      </section>
    </div>
  </Drawer>;
};

export default TaskRecordDrawer;
