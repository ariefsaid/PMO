import React from 'react';
import { Drawer } from '@/src/components/ui/Drawer';
import { CommentsSection } from './CommentsSection';

export interface TaskCommentsDrawerProps {
  task: { id: string; name: string } | null;
  onClose: () => void;
}

/**
 * Read view for a task's comments (#790): opens for ANY reader of the task — no edit right needed — and
 * works for project-less tasks too. RLS decides what posts; this only hosts the section.
 */
export const TaskCommentsDrawer: React.FC<TaskCommentsDrawerProps> = ({ task, onClose }) => (
  <Drawer open={task !== null} title={task?.name ?? ''} onClose={onClose}>
    {task && <CommentsSection entityType="task" entityId={task.id} />}
  </Drawer>
);
