import React, { useCallback, useMemo } from 'react';
import { WorkCalendar } from '@/src/components/calendar/WorkCalendar';
import type { MilestoneDate, MilestoneWithProgress } from '@/src/lib/db/milestones';
import type { TaskPatch, TaskWithRefs } from '@/src/lib/db/tasks';
import type { WorkTask } from '@/src/lib/calendar/workCalendar';

interface Props {
  projectId: string;
  /** Already filtered by the tab's scope/status/assignee/search controls. */
  tasks: readonly TaskWithRefs[];
  milestones: readonly MilestoneWithProgress[];
  /** The tab's own per-row edit gate (real role + route ownership). */
  canEditTask: (task: TaskWithRefs) => boolean;
  /** The tab's update mutation, so a drop saves exactly like an edit. */
  onMove: (id: string, patch: Pick<TaskPatch, 'start_date' | 'end_date'>) => Promise<unknown>;
  onMoveError: (err: unknown) => void;
  onOpenTask: (task: TaskWithRefs) => void;
}

/** The project tab's Calendar view: the tab's already-loaded tasks + milestones, no extra read. */
export const TaskCalendarView: React.FC<Props> = ({ projectId, tasks, milestones, canEditTask, onMove, onMoveError, onOpenTask }) => {
  const byId = useMemo(() => new Map(tasks.map((task) => [task.id, task])), [tasks]);
  const workTasks = useMemo<WorkTask[]>(
    () => tasks.flatMap((task) => task.end_date ? [{
      id: task.id, name: task.name, status: task.status, project_id: task.project_id, project_name: null,
      start_date: task.start_date, end_date: task.end_date, assignee_id: task.assignee_id, created_by: task.created_by,
    }] : []),
    [tasks],
  );
  const dated = useMemo<MilestoneDate[]>(
    () => milestones.flatMap((m) => m.target_date ? [{ id: m.id, projectId, name: m.name, targetDate: m.target_date }] : []),
    [milestones, projectId],
  );
  const canMoveTask = useCallback((task: WorkTask) => {
    const full = byId.get(task.id);
    return full ? canEditTask(full) : false;
  }, [byId, canEditTask]);
  return (
    <WorkCalendar
      tasks={workTasks}
      milestones={dated}
      canMoveTask={canMoveTask}
      onMoveTask={(task, patch) => onMove(task.id, patch)}
      onMoveError={onMoveError}
      onOpenItem={(item) => {
        if (item.kind !== 'task') return;
        const full = byId.get(item.id);
        if (full) onOpenTask(full);
      }}
    />
  );
};
