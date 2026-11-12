import React, { useRef, useState } from 'react';
import { Link, useParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import {
  Card,
  CardHead,
  CardPad,
  ConfirmDialog,
  UnsavedChangesDialog,
  ListState,
  StatusPill,
  useToast,
} from '@/src/components/ui';
import { BackBar } from '@/src/components/shell';
import ActionItemModal from '@/src/components/meetings/ActionItemModal';
import MeetingAttendees from '@/src/components/meetings/MeetingAttendees';
import MeetingHeader from '@/src/components/meetings/MeetingHeader';
import MeetingMinutes, { type MeetingMinutesHandle } from '@/src/components/meetings/MeetingMinutes';
import MeetingSharing from '@/src/components/meetings/MeetingSharing';
import { usePermission } from '@/src/auth/usePermission';
import { useAuth } from '@/src/auth/useAuth';
import { useListReturn } from '@/src/hooks/useListReturn';
import {
  useMeeting,
  useMeetingAttendees,
  useMeetingGrants,
  useMeetingActionItems,
  useMeetingMutations,
} from '@/src/hooks/useMeetings';
import { useProjectPickerOptions } from '@/src/hooks/useProjects';
import { classifyMutationError } from '@/src/lib/classifyMutationError';
import { formatDay } from '@/src/lib/format';
import { routeTaskWrite } from '@/src/lib/adapterSeam/ownershipCache';
import { projectDisplayName } from '@/src/lib/projectDisplayName';

/**
 * MeetingDetail — the routable `/meetings/:id` record page (#526).
 *
 * The route owns record reads, navigation and mutation sequencing. Editing workflows live in
 * focused meeting components; the minutes editor remains lazy-loaded by MeetingMinutes.
 */
const MeetingDetail: React.FC = () => {
  const { t } = useTranslation();
  const { t: tMeetings } = useTranslation('meetings');
  const { meetingId } = useParams<{ meetingId: string }>();
  const may = usePermission();
  const { toast } = useToast();
  const { currentUser } = useAuth();
  const currentUserId = currentUser?.id ?? null;

  const query = useMeeting(meetingId);
  const attendeesQuery = useMeetingAttendees(meetingId);
  const grantsQuery = useMeetingGrants(meetingId);
  const actionItemsQuery = useMeetingActionItems(meetingId);
  const { data: projects } = useProjectPickerOptions();
  const { archive, restore, remove, createActionItem } = useMeetingMutations();
  const meeting = query.data ?? null;
  const minutesRef = useRef<MeetingMinutesHandle>(null);
  const [headerDirty, setHeaderDirty] = useState(false);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [actionLine, setActionLine] = useState<string | null>(null);
  const [pendingLeave, setPendingLeave] = useState<(() => void) | null>(null);

  const backLabel = t('meetingDetail.backToMeetings', 'Meetings');
  const { returnToList } = useListReturn({ list: 'meetings' });
  const goBack = () => {
    const leave = minutesRef.current?.guardLeave;
    if (leave) leave(returnToList);
    else returnToList();
  };

  const onMutationError = (err: unknown) => {
    const { headline, detail } = classifyMutationError(err);
    toast(headline, detail, 'warning');
  };

  if (query.isPending) {
    return (
      <>
        <BackBar label={backLabel} phoneOnly onBack={goBack} />
        <div data-testid="meeting-loading"><ListState variant="loading" shape="detail" rows={5} /></div>
      </>
    );
  }

  if (query.isError) {
    return (
      <>
        <BackBar label={backLabel} phoneOnly onBack={goBack} />
        <ListState
          variant="error"
          title={t('meetingDetail.error.title', "Couldn't load meeting")}
          sub={t('meetingDetail.error.sub', 'Something went wrong fetching this meeting.')}
          onRetry={() => query.refetch()}
        />
      </>
    );
  }

  if (!meeting) {
    return (
      <>
        <BackBar label={backLabel} phoneOnly onBack={goBack} />
        <div data-testid="meeting-not-found">
          <ListState
            variant="empty"
            icon="cal"
            title={t('meetingDetail.notFound.title', 'Meeting not found')}
            sub={t(
              'meetingDetail.notFound.sub',
              "This meeting either doesn't exist or isn't shared with you. Ask an attendee or its author to share it.",
            )}
          />
        </div>
      </>
    );
  }

  const canEdit = may('edit', 'meeting', {
    currentUserId,
    record: { created_by_id: meeting.created_by_id },
  });
  const canArchive = may('archive', 'meeting', {
    currentUserId,
    record: { created_by_id: meeting.created_by_id },
  });
  const canDelete = may('delete', 'meeting');
  const tasksExternal = routeTaskWrite(meeting.project_id ?? undefined) === 'external';
  const actionItems = actionItemsQuery.data ?? [];

  const onArchiveConfirm = async () => {
    try {
      await archive.mutateAsync(meeting.id);
      toast(t('meetingDetail.toast.archived', 'Meeting archived'), meeting.title, 'success');
      setArchiveOpen(false);
      returnToList();
    } catch (err) {
      onMutationError(err);
    }
  };

  const onDeleteConfirm = async () => {
    try {
      await remove.mutateAsync(meeting.id);
      toast(t('meetingDetail.toast.deleted', 'Meeting deleted'), meeting.title, 'success');
      setDeleteOpen(false);
      returnToList();
    } catch (err) {
      onMutationError(err);
      setDeleteOpen(false);
    }
  };

  const onRestore = async () => {
    try {
      await restore.mutateAsync(meeting.id);
      toast(tMeetings('toast.restored', 'Meeting restored'), meeting.title, 'success');
    } catch (err) {
      onMutationError(err);
    }
  };

  const onCreateActionItem = async (input: { name: string; assigneeId: string; endDate: string }) => {
    const finalName = input.name.trim() || t('meetingDetail.action.placeholderName', 'Untitled action');
    const created = await createActionItem.mutateAsync({
      meetingId: meeting.id,
      projectId: meeting.project_id,
      name: finalName,
      assigneeId: input.assigneeId || null,
      endDate: input.endDate || null,
    });
    minutesRef.current?.insertActionItem(created.id);
    toast(t('meetingDetail.toast.actionCreated', 'Action item created'), finalName, 'success');
    setActionLine(null);
  };

  return (
    <div>
      <div data-testid="mobile-back-bar" className="hidden max-[920px]:block">
        <BackBar label={backLabel} onBack={goBack} />
      </div>

      <MeetingHeader
        meeting={meeting}
        projects={projects ?? []}
        canEdit={canEdit}
        canArchive={canArchive}
        canDelete={canDelete}
        onArchive={() => setArchiveOpen(true)}
        onRestore={() => void onRestore()}
        restorePending={restore.isPending}
        onDelete={() => setDeleteOpen(true)}
        onDirtyChange={setHeaderDirty}
      />

      <MeetingMinutes
        ref={minutesRef}
        meeting={meeting}
        canEdit={canEdit}
        tasksExternal={tasksExternal}
        additionalDirty={headerDirty}
        onBlockedLeave={(leave) => setPendingLeave(() => leave)}
        onRequestAction={setActionLine}
      />

      <Card variant="bare" className="mb-4">
        <CardHead>{t('meetingDetail.actionItems.title', 'Action items')}</CardHead>
        <CardPad>
          {actionItemsQuery.isPending ? (
            <div data-testid="meeting-action-items-loading"><ListState variant="loading" rows={2} /></div>
          ) : actionItemsQuery.isError ? (
            <ListState
              variant="error"
              title={t('meetingDetail.actionItems.error', "Couldn't load this meeting's action items.")}
              onRetry={() => void actionItemsQuery.refetch()}
            />
          ) : actionItems.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {t('meetingDetail.actionItems.empty', 'No action items yet. Type /action in the minutes to create one.')}
            </p>
          ) : (
            <ul className="flex flex-col gap-2" data-testid="action-items-list">
              {actionItems.map((task) => (
                <li id={`task-${task.id}`} key={task.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                  {task.project_id ? (
                    <Link
                      to={`/projects/${task.project_id}/tasks#task-${task.id}`}
                      className="rounded font-medium hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      {task.name}
                    </Link>
                  ) : (
                    <span className="font-medium">{task.name}</span>
                  )}
                  <StatusPill record="task" state={task.status} />
                  <span className="text-muted-foreground">
                    {task.assignee
                      ? `${t('meetingDetail.minutes.ownerLabel', 'Owner')}: ${task.assignee.full_name}`
                      : t('meetingDetail.minutes.unassigned', 'Unassigned: assign an owner')}
                  </span>
                  {task.end_date && (
                    <span className="text-muted-foreground">
                      {t('meetingDetail.minutes.dueLabel', 'Due date')}: {formatDay(task.end_date)}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </CardPad>
      </Card>

      <MeetingAttendees
        meetingId={meeting.id}
        canEdit={canEdit}
        attendeesQuery={attendeesQuery}
        onError={onMutationError}
      />
      <MeetingSharing
        meetingId={meeting.id}
        meetingAuthorId={meeting.created_by_id}
        currentUserId={currentUserId}
        projectManager={meeting.project?.pm ?? null}
        attendeesQuery={attendeesQuery}
        grantsQuery={grantsQuery}
        onError={onMutationError}
      />

      {actionLine !== null && (
        <ActionItemModal
          initialName={actionLine.trim()}
          projectName={meeting.project ? projectDisplayName(meeting.project) : null}
          onClose={() => setActionLine(null)}
          onCreate={onCreateActionItem}
          onError={onMutationError}
        />
      )}

      <ConfirmDialog
        open={archiveOpen}
        tone="default"
        title={t('meetingDetail.confirm.archiveTitle', 'Archive meeting?')}
        description={t(
          'meetingDetail.confirm.archiveDescription',
          'It will be hidden from the default list. Its minutes, attendees and action items stay intact.',
        )}
        confirmLabel={t('meetingDetail.confirm.archiveConfirm', 'Archive meeting')}
        loading={archive.isPending}
        onConfirm={onArchiveConfirm}
        onCancel={() => setArchiveOpen(false)}
      />

      <ConfirmDialog
        open={deleteOpen}
        tone="destructive"
        title={t('meetingDetail.confirm.deleteTitle', 'Delete meeting?')}
        description={t(
          'meetingDetail.confirm.deleteDescription',
          'This permanently removes the meeting and its minutes. A meeting whose action items still exist as tasks cannot be deleted; archive it instead.',
        )}
        confirmLabel={t('meetingDetail.confirm.deleteConfirm', 'Delete meeting')}
        loading={remove.isPending}
        onConfirm={onDeleteConfirm}
        onCancel={() => setDeleteOpen(false)}
      />

      <UnsavedChangesDialog
        open={pendingLeave !== null}
        onDiscard={() => {
          const leave = pendingLeave;
          setPendingLeave(null);
          leave?.();
        }}
        onKeepEditing={() => setPendingLeave(null)}
      />
    </div>
  );
};

export default MeetingDetail;
