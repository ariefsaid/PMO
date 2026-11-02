import React, { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import {
  Button,
  RecordHeader,
  SelectField,
  StatusPill,
  TextField,
} from '@/src/components/ui';
import { useMeetingMutations } from '@/src/hooks/useMeetings';
import { useToast } from '@/src/components/ui';
import { projectDisplayName } from '@/src/lib/projectDisplayName';
import { classifyMutationError } from '@/src/lib/classifyMutationError';
import { formatDateTime, instantToZonedDatetimeLocal, zonedDatetimeLocalToInstant } from '@/src/lib/format';
import type { MeetingWithRefs } from '@/src/lib/db/meetings';
import type { ProjectWithRefs } from '@/src/lib/repositories';

interface HeaderDraft {
  title: string;
  occurredAt: string;
  location: string;
  projectId: string;
}

interface MeetingHeaderProps {
  meeting: MeetingWithRefs;
  projects: ProjectWithRefs[];
  canEdit: boolean;
  canArchive: boolean;
  canDelete: boolean;
  onArchive: () => void;
  onRestore: () => void;
  restorePending: boolean;
  onDelete: () => void;
  onDirtyChange: (dirty: boolean) => void;
}

const headerDraftFor = (meeting: MeetingWithRefs): HeaderDraft => ({
  title: meeting.title,
  occurredAt: instantToZonedDatetimeLocal(new Date(meeting.occurred_at)),
  location: meeting.location ?? '',
  projectId: meeting.project_id ?? '',
});

const sameHeaderDraft = (left: HeaderDraft, right: HeaderDraft): boolean =>
  left.title === right.title && left.occurredAt === right.occurredAt &&
  left.location === right.location && left.projectId === right.projectId;

const MeetingHeader: React.FC<MeetingHeaderProps> = ({
  meeting,
  projects,
  canEdit,
  canArchive,
  canDelete,
  onArchive,
  onRestore,
  restorePending,
  onDelete,
  onDirtyChange,
}) => {
  const { t } = useTranslation();
  const { t: tMeetingCreate } = useTranslation('meetingCreate');
  const { t: tMeetings } = useTranslation('meetings');
  const { toast } = useToast();
  const { update } = useMeetingMutations();
  const [headerDraft, setHeaderDraft] = useState(() => headerDraftFor(meeting));
  const headerDraftRef = useRef(headerDraft);
  headerDraftRef.current = headerDraft;
  const syncedHeaderRef = useRef<{ meetingId: string; draft: HeaderDraft } | null>(null);

  useEffect(() => {
    const serverDraft = headerDraftFor(meeting);
    const synced = syncedHeaderRef.current;
    const edited = synced?.meetingId === meeting.id && !sameHeaderDraft(headerDraftRef.current, synced.draft);
    syncedHeaderRef.current = { meetingId: meeting.id, draft: serverDraft };
    if (!edited) setHeaderDraft(serverDraft);
  }, [meeting]);

  const serverDraft = headerDraftFor(meeting);
  const headerDirty = !sameHeaderDraft(headerDraft, serverDraft);
  useEffect(() => onDirtyChange(headerDirty), [headerDirty, onDirtyChange]);

  const saveHeader = async () => {
    const instant = zonedDatetimeLocalToInstant(headerDraft.occurredAt);
    if (!instant || !headerDraft.title.trim()) return;
    const savedDraft = {
      ...headerDraft,
      title: headerDraft.title.trim(),
      occurredAt: instantToZonedDatetimeLocal(instant),
      location: headerDraft.location.trim(),
    };
    try {
      await update.mutateAsync({ id: meeting.id, patch: {
        title: savedDraft.title,
        occurred_at: instant.toISOString(),
        location: savedDraft.location || null,
        project_id: headerDraft.projectId || null,
      } });
      syncedHeaderRef.current = { meetingId: meeting.id, draft: savedDraft };
      setHeaderDraft(savedDraft);
      toast(t('meetingDetail.toast.updated', 'Meeting updated'), savedDraft.title, 'success');
    } catch (err) {
      const { headline, detail } = classifyMutationError(err);
      toast(headline, detail, 'warning');
    }
  };

  const hasHeaderActions = canEdit || canArchive || canDelete;

  return (
    <RecordHeader
      name={canEdit ? (headerDraft.title || meeting.title) : meeting.title}
      icon={(meeting.title.trim().charAt(0) || '•').toUpperCase()}
      status={meeting.archived_at
        ? <StatusPill variant="neutral">{tMeetings('pill.archived', 'Archived')}</StatusPill>
        : <StatusPill variant="violet">{t('meetingDetail.pill.meeting', 'Meeting')}</StatusPill>}
      meta={canEdit ? (
        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <TextField
            id="meeting-header-title"
            label={t('meetingDetail.form.title.label', 'Title')}
            required
            value={headerDraft.title}
            onChange={(value) => setHeaderDraft((draft) => ({ ...draft, title: value }))}
            error={!headerDraft.title.trim() ? t('meetingDetail.form.errors.titleRequired', 'Meeting title is required.') : undefined}
          />
          <TextField
            id="meeting-header-when"
            label={t('meetingDetail.form.when.label', 'When')}
            type="datetime-local"
            value={headerDraft.occurredAt}
            onChange={(value) => setHeaderDraft((draft) => ({ ...draft, occurredAt: value }))}
            error={!zonedDatetimeLocalToInstant(headerDraft.occurredAt)
              ? t('meetingDetail.form.errors.whenInvalid', 'Choose a valid date and a local time that exists.')
              : undefined}
          />
          <TextField
            id="meeting-header-location"
            label={t('meetingDetail.form.location.label', 'Location')}
            value={headerDraft.location}
            onChange={(value) => setHeaderDraft((draft) => ({ ...draft, location: value }))}
          />
          <SelectField
            id="meeting-header-project"
            label={t('meetingDetail.form.project.label', 'Project')}
            value={headerDraft.projectId}
            onChange={(value) => setHeaderDraft((draft) => ({ ...draft, projectId: value }))}
            options={[
              { value: '', label: t('meetingDetail.form.project.none', 'No project') },
              ...projects.map((item) => ({ value: item.id, label: projectDisplayName(item) })),
            ]}
          />
        </div>
      ) : (
        <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span>{formatDateTime(new Date(meeting.occurred_at))}</span>
          {meeting.location && <span>{meeting.location}</span>}
          {meeting.project && (
            <Link
              to={`/projects/${meeting.project.id}`}
              className="text-primary-text hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
              title={meeting.project.name}
            >
              {projectDisplayName(meeting.project)}
            </Link>
          )}
        </span>
      )}
      actions={hasHeaderActions ? (
        <>
          {canEdit && headerDirty && <>
            <Button
              variant="primary"
              size="sm"
              data-testid="meeting-header-save"
              disabled={update.isPending || !headerDraft.title.trim() || !zonedDatetimeLocalToInstant(headerDraft.occurredAt)}
              onClick={() => void saveHeader()}
            >
              {tMeetingCreate('save', 'Save meeting')}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              data-testid="meeting-header-cancel"
              onClick={() => setHeaderDraft(serverDraft)}
            >
              {tMeetingCreate('cancel', 'Cancel')}
            </Button>
          </>}
          {canArchive && !meeting.archived_at && (
            <Button variant="ghost" size="sm" data-testid="meeting-archive" onClick={onArchive}>
              {t('meetingDetail.archive', 'Archive')}
            </Button>
          )}
          {canArchive && meeting.archived_at && (
            <Button
              variant="outline"
              size="sm"
              data-testid="meeting-restore"
              disabled={restorePending}
              onClick={onRestore}
            >
              {restorePending
                ? tMeetings('actions.restoring', 'Restoring…')
                : tMeetings('actions.restore', 'Restore')}
            </Button>
          )}
          {canDelete && (
            <Button variant="ghost" size="sm" data-testid="meeting-delete" onClick={onDelete}>
              {t('meetingDetail.delete', 'Delete')}
            </Button>
          )}
        </>
      ) : undefined}
    />
  );
};

export default MeetingHeader;
