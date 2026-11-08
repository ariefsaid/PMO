import React, { Suspense, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Button,
  Card,
  CardHead,
  CardPad,
  GateNotice,
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

/**
 * The minutes section (#805; read view + inline edit #2062). The meeting record opens as a READ
 * view — the rendered document — and switches to the editor on the Edit button, on a click on the
 * content, or immediately for an author opening a meeting with no minutes at all (an empty read
 * view is a dead end). Save persists and returns to the read view; Cancel and Escape revert to
 * the saved document. Each mode flip remounts the editor seeded from the SAVED document, so the
 * revert is by construction and the dirty baseline is always the saved state. The unsaved-changes
 * navigation guard is unchanged: it protects a DIRTY editor.
 */
const MeetingMinutes = React.forwardRef<MeetingMinutesHandle, MeetingMinutesProps>(function MeetingMinutes({
  meeting,
  canEdit,
  tasksExternal,
  additionalDirty,
  onBlockedLeave,
  onRequestAction,
}, ref) {
  const { t } = useTranslation();
  const { t: tMeetings } = useTranslation('meetings');
  const { toast } = useToast();
  const { update } = useMeetingMutations();
  const editorRef = useRef<MinutesEditorHandle>(null);
  const [blocks, setBlocks] = useState<NoteBlock[] | null>(null);
  const [baseline, setBaseline] = useState<string | null>(null);
  const previousMeetingId = useRef(meeting.id);
  const savedBlocks = useMemo(
    () => upgradeNotes(meeting.notes, meeting.notes_schema_version),
    [meeting.notes, meeting.notes_schema_version],
  );
  const [editing, setEditing] = useState(() => savedBlocks.length === 0);
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
    setEditing(upgradeNotes(meeting.notes, meeting.notes_schema_version).length === 0);
  }, [meeting.id, meeting.notes, meeting.notes_schema_version]);

  const enterEdit = useCallback(() => {
    if (!canEdit) return;
    setEditing(true);
    // the click that opened the editor should leave the caret in it
    requestAnimationFrame(() => editorRef.current?.focus());
  }, [canEdit]);

  /** Cancel (#2062): back to the read view; the remount re-seeds the saved document. */
  const cancelEdit = useCallback(() => setEditing(false), []);

  const onReadClick = useCallback(
    (event: React.MouseEvent) => {
      // A click on the read content is a shortcut for the Edit button — but a click on an
      // embedded interactive element (an action-item link) means THAT element, not "edit".
      if ((event.target as HTMLElement).closest('a, button, [role="button"]')) return;
      enterEdit();
    },
    [enterEdit],
  );

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
      setEditing(false);
      toast(t('meetingDetail.toast.minutesSaved', 'Minutes saved'), meeting.title, 'success');
    } catch (err) {
      const { headline, detail } = classifyMutationError(err);
      toast(headline, detail, 'warning');
    }
  };

  const isEditing = canEdit && editing;

  return (
    <Card variant="bare" className="mb-4">
      <CardHead
        actions={canEdit && (isEditing ? (
          <>
            <Button variant="ghost" size="sm" data-testid="minutes-cancel" onClick={cancelEdit}>
              {tMeetings('actions.minutesCancel', 'Cancel')}
            </Button>
            <Button
              variant="primary"
              size="sm"
              data-testid="minutes-save"
              disabled={!minutesDirty || update.isPending}
              onClick={() => void saveMinutes()}
            >
              {t('meetingDetail.minutes.save', 'Save minutes')}
            </Button>
          </>
        ) : (
          <Button variant="outline" size="sm" data-testid="minutes-edit" onClick={enterEdit}>
            {tMeetings('actions.minutesEdit', 'Edit minutes')}
          </Button>
        ))}
      >
        {t('meetingDetail.minutes.title', 'Minutes')}
      </CardHead>
      <CardPad>
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
          <div
            data-testid={isEditing ? 'minutes-editor' : 'minutes-readonly'}
            onClick={!isEditing && canEdit ? onReadClick : undefined}
            className={!isEditing && canEdit ? 'cursor-text rounded-sm' : undefined}
          >
            <Suspense fallback={<ListState variant="loading" rows={3} />}>
              {/* The key remounts per mode flip: each mode starts from the SAVED document, so
                  cancel/escape revert by construction and Save's baseline is the saved state. */}
              <MinutesEditor
                key={`${meeting.id}:${isEditing ? 'edit' : 'read'}`}
                ref={editorRef}
                initialBlocks={savedBlocks}
                editable={isEditing}
                tasksExternal={tasksExternal}
                onReady={onEditorReady}
                onChange={setBlocks}
                onRequestAction={onRequestAction}
                onCancel={cancelEdit}
              />
            </Suspense>
          </div>
        )}
      </CardPad>
    </Card>
  );
});

export default MeetingMinutes;
