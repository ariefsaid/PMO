import React, { useState } from 'react';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Card, CardHead, CardPad, Drawer, ListState, StatusPill, Tooltip, ViewToggle } from '@/src/components/ui';
import { CommentsSection } from '@/src/components/comments/CommentsSection';
import { RecordHistory } from '@/src/components/history/RecordHistory';
import { useComments } from '@/src/hooks/useComments';
import { useTasks } from '@/src/hooks/useTasks';
import { useAuth } from '@/src/auth/useAuth';
import { formatDateOnly } from '@/src/lib/format';

type ActivityView = 'all' | 'comments' | 'changes';

/** Activity = the project's conversation and its change history, two views of one job (UX NV3). */
export const ProjectActivity: React.FC<{ projectId: string; compact?: boolean }> = ({ projectId, compact = false }) => {
  const { t } = useTranslation('project');
  const [view, setView] = useState<ActivityView>('all');
  return (
    <Card role="region" aria-label={t('projectDetail.activity.title', 'Activity')} className="min-w-0">
      <CardHead>{t('projectDetail.activity.title', 'Activity')}</CardHead>
      <CardPad className="flex min-w-0 flex-col gap-4">
      <ViewToggle<ActivityView>
        ariaLabel={t('projectDetail.activity.viewLabel', 'Activity view')}
        value={view}
        onChange={setView}
        options={[
          { value: 'all', label: t('projectDetail.activity.all', 'All') },
          { value: 'comments', label: t('projectDetail.activity.comments', 'Comments') },
          { value: 'changes', label: t('projectDetail.activity.changes', 'Changes') },
        ]}
      />
      {(view === 'all' || view === 'comments') && <CommentsSection entityType="project" entityId={projectId} hideTitle />}
      {(view === 'all' || view === 'changes') && (
        <RecordHistory entityType="project" entityId={projectId} includeChildren kindFilters={!compact || view === 'all'} />
      )}
      </CardPad>
    </Card>
  );
};

/** The signed-in person's open tasks on this project — the engineer's overview lead. */
export const MyOpenTasks: React.FC<{ projectId: string }> = ({ projectId }) => {
  const { t } = useTranslation('project');
  const { currentUser } = useAuth();
  const tasks = useTasks(projectId);
  if (tasks.isPending) return <Card role="region" aria-labelledby="pd-my-tasks"><CardHead id="pd-my-tasks">{t('projectDetail.myTasks.title', 'My open tasks')}</CardHead><CardPad><ListState variant="loading" rows={3} /></CardPad></Card>;
  if (tasks.isError) return <Card role="region" aria-labelledby="pd-my-tasks"><CardHead id="pd-my-tasks">{t('projectDetail.myTasks.title', 'My open tasks')}</CardHead><CardPad><ListState variant="error" title={t('projectDetail.myTasks.error', "Couldn't load your tasks")} onRetry={() => void tasks.refetch()} /></CardPad></Card>;
  const today = new Date().toISOString().slice(0, 10);
  const mine = (tasks.data ?? [])
    .filter((task) => task.assignee_id === currentUser?.id && task.status !== 'Done')
    .sort((a, b) => (a.end_date ?? '9999').localeCompare(b.end_date ?? '9999'));
  const overdue = mine.filter((task) => task.end_date && task.end_date < today).length;
  return (
    <Card role="region" aria-labelledby="pd-my-tasks" className="min-w-0">
      <CardHead id="pd-my-tasks" actions={<>
          <Tooltip content={t('projectDetail.myTasks.countTooltip', 'Open tasks assigned to you on this project.')}>
            <span tabIndex={0} className="font-normal text-muted-foreground">{mine.length}</span>
          </Tooltip>
          {overdue > 0 && <Tooltip content={t('projectDetail.myTasks.overdueTooltip', 'Open tasks assigned to you with a due date before today.')}>
            <span tabIndex={0} className="ml-2 font-medium text-destructive-text">{t('projectDetail.myTasks.overdueCount', '{{count}} overdue', { count: overdue })}</span>
          </Tooltip>}
          <Link to={`/projects/${projectId}/tasks`} className="touch-target inline-flex items-center text-xs font-semibold text-primary-text hover:underline">
            {t('projectDetail.myTasks.all', 'All tasks')}
          </Link>
        </>}>
          {t('projectDetail.myTasks.title', 'My open tasks')}
      </CardHead>
      <CardPad flush>
      {mine.length === 0 ? (
        <p className="p-[var(--panel-inset)] text-sm text-muted-foreground">{t('projectDetail.myTasks.empty', 'Nothing assigned to you here.')}</p>
      ) : (
        <ul className="divide-y divide-border/70">
          {mine.slice(0, 6).map((task) => (
            <li key={task.id}>
              <Tooltip content={t('projectDetail.myTasks.dueTooltip', 'Task status and due date come from this task record; overdue days are calculated from today.')} block>
                <Link to={`/projects/${projectId}/tasks?open=${encodeURIComponent(task.id)}`} className="touch-target flex flex-wrap items-center gap-x-3 gap-y-1 py-2 text-sm hover:bg-accent/60">
                  <span className="min-w-0 basis-full font-medium text-foreground sm:basis-0 sm:flex-1">{task.name}</span>
                  <StatusPill variant={task.status === 'Blocked' ? 'overdue' : task.status === 'In Progress' ? 'progress' : 'neutral'}>{task.status}</StatusPill>
                  {task.end_date && <span className={task.end_date < today ? 'shrink-0 whitespace-nowrap text-xs font-medium text-destructive-text sm:min-w-28 sm:text-right' : 'shrink-0 whitespace-nowrap text-xs text-muted-foreground sm:min-w-28 sm:text-right'}>
                    {task.end_date < today
                      ? t('projectDetail.myTasks.overdue', 'Overdue · {{days}} days', { days: Math.round((Date.parse(today) - Date.parse(task.end_date)) / 86_400_000) })
                      : formatDateOnly(task.end_date)}
                  </span>}
                </Link>
              </Tooltip>
            </li>
          ))}
        </ul>
      )}
      </CardPad>
    </Card>
  );
};

/**
 * Activity on demand (owner, 2026-10-27): a quiet line at the foot of the Overview —
 * there when you need it, never competing with the work. It opens the conversation in a drawer.
 */
export const ActivityFooter: React.FC<{ projectId: string; initialOpen?: boolean }> = ({ projectId, initialOpen = false }) => {
  const { t } = useTranslation('project');
  const [open, setOpen] = useState(initialOpen);
  const comments = useComments('project', projectId);
  const list = comments.data ?? [];
  const label = t('projectDetail.activity.title', 'Activity');
  return (
    <>
      <div className="mt-12">
        <Tooltip content={t('projectDetail.activity.countTooltip', 'Count of project comments. Open Activity to read comments and recorded changes.')}>
          <button type="button" onClick={() => setOpen(true)} aria-haspopup="dialog"
            className="touch-target inline-flex items-center rounded-sm text-xs text-muted-foreground hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            {label} · {t('projectDetail.activity.count', '{{count}} comments', { count: list.length })}
          </button>
        </Tooltip>
      </div>
      <Drawer open={open} title={label} onClose={() => setOpen(false)}>
        <ProjectActivity projectId={projectId} />
      </Drawer>
    </>
  );
};
