import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router';
import { StatusPill } from '@/src/components/ui';
import { useAuth } from '@/src/auth/useAuth';
import { repositories } from '@/src/lib/repositories';
import { workflowVariant } from '@/src/lib/status/statusVariants';
import { formatDateOnly } from '@/src/lib/format';
import type { TaskWithRefs } from '@/src/lib/db/tasks';
import { useActionItemsBatch } from './ActionItemsContext';

/**
 * The body of the `actionItem` document block (DD-MTG-2): resolves the REAL `tasks` row by the id the
 * block stores and shows its current values — the block never holds a copy, so an edit made in the task
 * list is visible the next time this renders (AC-MTG-003). A task that no longer resolves, or a block
 * with no id yet (copied template), is a tombstone — never a crash or a blank block (FR-MTG-019).
 *
 * The query key sits under `['tasks', …]` so every existing task invalidation refreshes it too.
 *
 * #2106 (AC-PERF-2106-3): inside the minutes page, ActionItemsProvider resolves every block's task in ONE read and
 * this block reads its row from that batch. Only an id the batch does not cover (a block inserted since the minutes
 * loaded) falls back to the single `task.get` below.
 */
export const ActionItemView: React.FC<{ taskId: string }> = ({ taskId }) => {
  const { t } = useTranslation();
  const { currentUser } = useAuth();
  const { meetingId } = useParams<{ meetingId: string }>();
  const orgId = currentUser?.org_id;
  const batch = useActionItemsBatch();
  const batched = batch?.ids.has(taskId) ?? false;
  const query = useQuery({
    queryKey: ['tasks', orgId, 'one', taskId],
    queryFn: () => repositories.task.get(taskId),
    // A batched id already has its answer (or its request in flight) — asking again is the N+1 this fixes.
    enabled: Boolean(orgId && taskId) && !batched,
  });

  const shell = 'minutes-action-item';
  const settled = batched ? batch!.status === 'ready' : query.isSuccess;
  const failed = batched ? batch!.status === 'error' : query.isError;
  const task: TaskWithRefs | null | undefined = batched ? (batch!.byId.get(taskId) ?? null) : query.data;

  if (!taskId || (settled && !task)) {
    return (
      <div className={`${shell} ${shell}--tombstone`} data-testid="action-item-tombstone">
        {t('meetingDetail.minutes.actionTombstone', 'This action item is no longer available.')}
      </div>
    );
  }
  if (failed) {
    return (
      <div className={shell} data-testid="action-item-error">
        {t('meetingDetail.minutes.actionError', "Couldn't load this action item.")}
      </div>
    );
  }
  if (!task) {
    return (
      <div className={shell} aria-busy="true">
        {t('meetingDetail.minutes.actionLoading', 'Loading action item…')}
      </div>
    );
  }
  return (
    <div className={shell} data-testid="action-item">
      {task.project_id || (task.meeting_id && task.meeting_id !== meetingId) ? (
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
          : t('meetingDetail.minutes.unassigned', 'Unassigned: assign an owner')}
      </span>
      {task.end_date && (
        <span className={`${shell}__meta`}>
          {t('meetingDetail.minutes.dueLabel', 'Due date')}: {formatDateOnly(task.end_date)}
        </span>
      )}
    </div>
  );
};
