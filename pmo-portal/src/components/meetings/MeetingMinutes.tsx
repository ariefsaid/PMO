import React, { Suspense, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Button,
  Card,
  CardHead,
  CardPad,
  GateNotice,
  FieldError,
  ListState,
  useToast,
} from '@/src/components/ui';
import { useUnsavedChangesGuard } from '@/src/hooks/useUnsavedChangesGuard';
import { useMeetingMutations } from '@/src/hooks/useMeetings';
import { classifyMutationError } from '@/src/lib/classifyMutationError';
import { upgradeNotes, type NoteBlock } from '@/src/lib/meetingNotes';
import type { MinutesEditorHandle } from '@/src/components/meetings/MinutesEditor';
import { MinutesEditor } from '@/src/components/meetings/minutesEditorChunk';
import type { MeetingWithRefs } from '@/src/lib/db/meetings';

export interface MeetingMinutesHandle {
  guardLeave: (leave: () => void) => void;
  insertActionItem: (id: string) => void;
}

interface MeetingMinutesProps {
  meeting: MeetingWithRefs;
  canEdit: boolean;
  tasksExternal: boolean;
  additionalDirty: boolean;
  onBlockedLeave: (leave: () => void) => void;
  onRequestAction: (line: string) => void;
}

const MeetingMinutes = React.forwardRef<MeetingMinutesHandle, MeetingMinutesProps>(function MeetingMinutes({
  meeting,
  canEdit,
  tasksExternal,
  additionalDirty,
  onBlockedLeave,
  onRequestAction,
}, ref) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const { update } = useMeetingMutations();
  const editorRef = useRef<MinutesEditorHandle>(null);
  const [blocks, setBlocks] = useState<NoteBlock[] | null>(null);
  const [baseline, setBaseline] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const previousMeetingId = useRef(meeting.id);
  const savedBlocks = useMemo(
    () => upgradeNotes(meeting.notes, meeting.notes_schema_version),
    [meeting.notes, meeting.notes_schema_version],
  );
  const minutesDirty = blocks !== null && baseline !== null && JSON.stringify(blocks) !== baseline;

  const onEditorReady = useCallback((document: NoteBlock[]) => {
    setBaseline(JSON.stringify(document));
    setBlocks(document);
  }, []);

  useEffect(() => {
    if (previousMeetingId.current === meeting.id) return;
    previousMeetingId.current = meeting.id;
    setBlocks(null);
    setBaseline(null);
  }, [meeting.id]);

  const guardLeave = useUnsavedChangesGuard({
    dirty: minutesDirty || additionalDirty,
    guardHistory: true,
    onBlocked: onBlockedLeave,
  });
  useImperativeHandle(ref, () => ({
    guardLeave,
    insertActionItem: (id) => editorRef.current?.insertActionItem(id),
  }), [guardLeave]);

  const saveMinutes = async () => {
    try {
      const document = editorRef.current?.getDocument() ?? blocks;
      if (!document) return;
      await update.mutateAsync({ id: meeting.id, patch: { notes: document } });
      setBlocks(document);
      setBaseline(JSON.stringify(document));
      setSaveError(null);
      toast(t('meetingDetail.toast.minutesSaved', 'Minutes saved'), meeting.title, 'success');
    } catch (err) {
      const { headline, detail } = classifyMutationError(err);
      setSaveError(detail ? `${headline}. ${detail}` : headline);
      toast(headline, detail, 'warning');
    }
  };

  return (
    <Card variant="bare" className="mb-4">
      <CardHead
        actions={canEdit && (
          <Button
            variant="primary"
            size="sm"
            data-testid="minutes-save"
            disabled={!minutesDirty || update.isPending}
            onClick={() => void saveMinutes()}
          >
            {t('meetingDetail.minutes.save', 'Save minutes')}
          </Button>
        )}
      >
        {t('meetingDetail.minutes.title', 'Minutes')}
      </CardHead>
      <CardPad>
        <FieldError id="meeting-minutes-save-error" className="mb-3">{saveError}</FieldError>
        {tasksExternal && canEdit && (
          <GateNotice variant="blocked" className="mb-2" data-testid="minutes-external-gate">
            {t('meetingDetail.action.externalGate', 'Tasks are managed by the connected task system, so action items cannot be created from these minutes.')}
          </GateNotice>
        )}
        {!canEdit && savedBlocks.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {t('meetingDetail.minutes.empty', 'No minutes were recorded for this meeting.')}
          </p>
        ) : (
          <div data-testid={canEdit ? 'minutes-editor' : 'minutes-readonly'}>
            <Suspense fallback={<ListState variant="loading" rows={3} />}>
              <MinutesEditor
                key={meeting.id}
                ref={editorRef}
                initialBlocks={savedBlocks}
                editable={canEdit}
                tasksExternal={tasksExternal}
                onReady={onEditorReady}
                onChange={setBlocks}
                onRequestAction={onRequestAction}
              />
            </Suspense>
          </div>
        )}
      </CardPad>
    </Card>
  );
});

export default MeetingMinutes;
