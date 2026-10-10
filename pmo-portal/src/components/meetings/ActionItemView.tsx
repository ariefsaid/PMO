import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { StatusPill } from '@/src/components/ui';
import { useAuth } from '@/src/auth/useAuth';
import { repositories } from '@/src/lib/repositories';
import { workflowVariant } from '@/src/lib/status/statusVariants';
import { formatDateOnly } from '@/src/lib/format';

/**
 * The body of the `actionItem` document block (DD-MTG-2): resolves the REAL `tasks` row by the id the
 * block stores and shows its current values — the block never holds a copy, so an edit made in the task
 * list is visible the next time this renders (AC-MTG-003). A task that no longer resolves, or a block
 * with no id yet (copied template), is a tombstone — never a crash or a blank block (FR-MTG-019).
 *
 * The query key sits under `['tasks', …]` so every existing task invalidation refreshes it too.
 */
export const ActionItemView: React.FC<{ taskId: string }> = ({ taskId }) => {
  const { t } = useTranslation();
  const { currentUser } = useAuth();
  const orgId = currentUser?.org_id;
  const query = useQuery({
    queryKey: ['tasks', orgId, 'one', taskId],
    queryFn: () => repositories.task.get(taskId),
    enabled: Boolean(orgId && taskId),
  });

  const shell = 'minutes-action-item';

  if (!taskId || (query.isSuccess && !query.data)) {
    return (
      <div className={`${shell} ${shell}--tombstone`} data-testid="action-item-tombstone">
        {t('meetingDetail.minutes.actionTombstone', 'This action item is no longer available.')}
      </div>
    );
  }
  if (query.isError) {
    return (
      <div className={shell} data-testid="action-item-error">
        {t('meetingDetail.minutes.actionError', "Couldn't load this action item.")}
      </div>
    );
  }
  if (!query.data) {
    return (
      <div className={shell} aria-busy="true">
        {t('meetingDetail.minutes.actionLoading', 'Loading action item…')}
      </div>
    );
  }
  const task = query.data;
  return (
    <div className={shell} data-testid="action-item">
      {task.project_id || task.meeting_id ? (
        <Link
          to={task.project_id ? `/projects/${task.project_id}/tasks#task-${task.id}` : `/meetings/${task.meeting_id}#task-${task.id}`}
          aria-label={t('meetingDetail.minutes.openTask', 'Open task: {{name}}', { name: task.name })}
          className={`${shell}__name rounded hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring`}
        >
          {task.name}
        </Link>
      ) : (
        <span className={`${shell}__name`}>{task.name}</span>
      )}
      <StatusPill variant={workflowVariant(task.status)}>{task.status}</StatusPill>
      <span className={`${shell}__meta`}>
        {task.assignee
          ? `${t('meetingDetail.minutes.ownerLabel', 'Owner')}: ${task.assignee.full_name}`
          : t('meetingDetail.minutes.unassigned', 'Unassigned — assign an owner')}
      </span>
      {task.end_date && (
        <span className={`${shell}__meta`}>
          {t('meetingDetail.minutes.dueLabel', 'Due date')}: {formatDateOnly(task.end_date)}
        </span>
      )}
    </div>
  );
};
