/** Task repository contract (ADR-0017). */
import type {
  TaskRow, TaskDueRow, CalendarTask, TaskWithRefs, TaskInput, TaskPatch, TaskStatus, MyTask, TaskLinkedRecord, RecordLinkType,
} from '@/src/lib/db/tasks';

export interface TaskRepository {
  /** Per-project tasks with assignee + dependency edges. */
  list(projectId: string, opts?: { workOrderId?: string | 'none' }): Promise<TaskWithRefs[]>;
  /** #2531: the open (not Done, not archived) tasks of one work order, with assignee and due date. */
  listOpenByWorkOrder(workOrderId: string): Promise<TaskWithRefs[]>;
  /** Status + due date of live tasks across projects, one batched read (dashboard overdue counts). */
  listDueRows(projectIds: readonly string[]): Promise<TaskDueRow[]>;
  /** Dated live tasks due in [from, to), org-wide or one project — the calendar views (one read). */
  listCalendar(opts: { from: string; to: string; projectId?: string }): Promise<CalendarTask[]>;
  /** Tasks minuted out of one meeting (the /action seam, migration 0206). */
  listByMeeting(meetingId: string): Promise<TaskWithRefs[]>;
  listByAssignee(userId: string): Promise<MyTask[]>;
  /** A single task by id, or null when not found / not readable. */
  get(id: string): Promise<TaskWithRefs | null>;
  /** Several tasks by id in ONE read (#2106): the minutes' action items. Unreadable ids are simply absent. */
  listByIds(ids: readonly string[]): Promise<TaskWithRefs[]>;
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
  /** #2587: the live status of each task's linked record as the caller may see it, one read per page. */
  linkedRecords(taskIds: readonly string[]): Promise<Map<string, TaskLinkedRecord>>;
  /** #2587: the open task that follows a record, or null (create-from-record opens it, never offers a second). */
  findOpenForRecord(type: RecordLinkType, recordId: string): Promise<{ id: string; name: string; project_id: string | null } | null>;
  /** Add a dependency edge (taskId depends on dependsOnId). */
  addDependency(taskId: string, dependsOnId: string): Promise<void>;
  /** Remove a dependency edge. */
  removeDependency(taskId: string, dependsOnId: string): Promise<void>;
}
