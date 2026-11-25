import React from 'react';
import { Drawer } from '@/src/components/ui/Drawer';
import { TaskProofPanel } from '@/src/components/tasks/TaskProofPanel';
import type { TaskStatus } from '@/src/lib/db/tasks';
import { CommentsSection } from './CommentsSection';

export interface TaskCommentsDrawerProps {
  /** `status` is given where the reader is the task's owner (My tasks): they may then attach proof here too (#2898). */
  task: { id: string; name: string; status?: TaskStatus } | null;
  onClose: () => void;
}

/**
 * Read view for a task's comments (#790): opens for ANY reader of the task — no edit right needed — and
 * works for project-less tasks too. RLS decides what posts; this only hosts the section. For the task's owner it also
 * holds the proof of completion, so a check is closed with a note and proof from My tasks whatever the owner's role.
 */
export const TaskCommentsDrawer: React.FC<TaskCommentsDrawerProps> = ({ task, onClose }) => (
  <Drawer open={task !== null} title={task?.name ?? ''} onClose={onClose}>
    {task?.status && (
      <div className="mb-6">
        <TaskProofPanel taskId={task.id} status={task.status} proofRequired={false} canAttach canSetStatus={false} onMarkDone={() => undefined} />
      </div>
    )}
    {task && <CommentsSection entityType="task" entityId={task.id} />}
  </Drawer>
);
