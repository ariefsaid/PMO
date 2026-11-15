import React, { useState } from 'react';
import { Drawer } from '@/src/components/ui/Drawer';
import { UnsavedChangesDialog } from '@/src/components/ui/UnsavedChangesDialog';
import { CommentsSection } from './CommentsSection';

export interface TaskCommentsDrawerProps {
  task: { id: string; name: string } | null;
  onClose: () => void;
}

/**
 * Read view for a task's comments (#790): opens for ANY reader of the task — no edit right needed — and
 * works for project-less tasks too. RLS decides what posts; this only hosts the section.
 * Closing unmounts the section, so a typed draft asks before it is dropped (#2080).
 */
export const TaskCommentsDrawer: React.FC<TaskCommentsDrawerProps> = ({ task, onClose }) => {
  const [draftTyped, setDraftTyped] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);
  return (
    <>
      <Drawer
        open={task !== null}
        title={task?.name ?? ''}
        onClose={() => { if (draftTyped) setConfirmClose(true); else onClose(); }}
      >
        {task && <CommentsSection entityType="task" entityId={task.id} onDirtyChange={setDraftTyped} />}
      </Drawer>
      <UnsavedChangesDialog
        open={confirmClose}
        onDiscard={() => { setConfirmClose(false); setDraftTyped(false); onClose(); }}
        onKeepEditing={() => setConfirmClose(false)}
      />
    </>
  );
};
