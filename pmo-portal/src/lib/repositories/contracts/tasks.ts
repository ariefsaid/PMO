/** Task repository contract (ADR-0017). */
import type { TaskRow, TaskWithRefs, TaskInput, TaskPatch, TaskStatus, MyTask } from '@/src/lib/db/tasks';

export interface TaskRepository {
  /** Per-project tasks with assignee + dependency edges. */
  list(projectId: string): Promise<TaskWithRefs[]>;
  /** Tasks minuted out of one meeting (the /action seam, migration 0206). */
  listByMeeting(meetingId: string): Promise<TaskWithRefs[]>;
  listByAssignee(userId: string): Promise<MyTask[]>;
  /** A single task by id, or null when not found / not readable. */
  get(id: string): Promise<TaskWithRefs | null>;
  /** Create a task (org_id stamped by RLS, never sent). */
  create(input: TaskInput): Promise<TaskRow>;
  /** Update structure fields (name/assignee/dates/status) — managers. */
  update(id: string, patch: TaskPatch, projectId?: string): Promise<void>;
  /** Update ONLY the status column — the assignee (Engineer own-task) path. */
  updateStatus(id: string, status: TaskStatus, projectId?: string | null): Promise<void>;
  /** Hard-delete a task (cascades dependencies). */
  delete(id: string, projectId?: string): Promise<void>;
  /** PMO-owned reversible soft archive. */
  archive(id: string, projectId?: string): Promise<void>;
  /** PMO-owned reversible unarchive. */
  unarchive(id: string, projectId?: string): Promise<void>;
  /** Add a dependency edge (taskId depends on dependsOnId). */
  addDependency(taskId: string, dependsOnId: string): Promise<void>;
  /** Remove a dependency edge. */
  removeDependency(taskId: string, dependsOnId: string): Promise<void>;
}
