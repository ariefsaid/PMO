/** Task repository implementation (ADR-0017 seam). */
import {
  listTasks,
  listOpenTasksByWorkOrder,
  listTaskDueRows,
  listCalendarTasks,
  listTasksByMeeting,
  listTasksByIds,
  listMyTasks,
  getTask,
  createTask,
  createTaskTree,
  updateTask,
  updateTaskStatus,
  deleteTask,
  archiveTask,
  unarchiveTask,
  addDependency,
  removeDependency,
  taskLinkedRecords,
  findOpenTaskForRecord,
} from '@/src/lib/db/tasks';
import { wrap } from './repositoryErrors';
import type { TaskRepository } from './contracts/tasks';

export const taskRepository: TaskRepository = {
  list: (projectId, opts) => wrap(() => (opts ? listTasks(projectId, opts) : listTasks(projectId))),
  listOpenByWorkOrder: (workOrderId) => wrap(() => listOpenTasksByWorkOrder(workOrderId)),
  listDueRows: (projectIds) => wrap(() => listTaskDueRows(projectIds)),
  listCalendar: (opts) => wrap(() => listCalendarTasks(opts)),
  listByMeeting: (meetingId) => wrap(() => listTasksByMeeting(meetingId)),
  listByIds: (ids) => wrap(() => listTasksByIds(ids)),
  listByAssignee: (userId) => wrap(() => listMyTasks(userId)),
  get: (id) => wrap(() => getTask(id)),
  create: (input) => wrap(() => createTask(input)),
  createTree: (root, parentId, drafts, place) => wrap(() => createTaskTree(root, parentId, drafts, place)),
  update: (id, patch, projectId) =>
    wrap(() => (projectId === undefined ? updateTask(id, patch) : updateTask(id, patch, projectId))),
  updateStatus: (id, status, projectId) =>
    wrap(() => (projectId === undefined ? updateTaskStatus(id, status) : updateTaskStatus(id, status, projectId))),
  delete: (id, projectId) => wrap(() => (projectId === undefined ? deleteTask(id) : deleteTask(id, projectId))),
  archive: (id, projectId) => wrap(() => (projectId === undefined ? archiveTask(id) : archiveTask(id, projectId))),
  unarchive: (id, projectId) =>
    wrap(() => (projectId === undefined ? unarchiveTask(id) : unarchiveTask(id, projectId))),
  linkedRecords: (taskIds) => wrap(() => taskLinkedRecords(taskIds)),
  findOpenForRecord: (type, recordId) => wrap(() => findOpenTaskForRecord(type, recordId)),
  addDependency: (taskId, dependsOnId) => wrap(() => addDependency(taskId, dependsOnId)),
  removeDependency: (taskId, dependsOnId) => wrap(() => removeDependency(taskId, dependsOnId)),
};
