/** Task repository implementation (ADR-0017 seam). */
import {
  listTasks,
  listTaskDueRows,
  listCalendarTasks,
  listTasksByMeeting,
  listTasksByIds,
  listMyTasks,
  getTask,
  createTask,
  updateTask,
  updateTaskStatus,
  deleteTask,
  archiveTask,
  unarchiveTask,
  addDependency,
  removeDependency,
} from '@/src/lib/db/tasks';
import { wrap } from './repositoryErrors';
import type { TaskRepository } from './contracts/tasks';

export const taskRepository: TaskRepository = {
  list: (projectId) => wrap(() => listTasks(projectId)),
  listDueRows: (projectIds) => wrap(() => listTaskDueRows(projectIds)),
  listCalendar: (opts) => wrap(() => listCalendarTasks(opts)),
  listByMeeting: (meetingId) => wrap(() => listTasksByMeeting(meetingId)),
  listByIds: (ids) => wrap(() => listTasksByIds(ids)),
  listByAssignee: (userId) => wrap(() => listMyTasks(userId)),
  get: (id) => wrap(() => getTask(id)),
  create: (input) => wrap(() => createTask(input)),
  update: (id, patch, projectId) =>
    wrap(() => (projectId === undefined ? updateTask(id, patch) : updateTask(id, patch, projectId))),
  updateStatus: (id, status, projectId) =>
    wrap(() => (projectId === undefined ? updateTaskStatus(id, status) : updateTaskStatus(id, status, projectId))),
  delete: (id, projectId) => wrap(() => (projectId === undefined ? deleteTask(id) : deleteTask(id, projectId))),
  archive: (id, projectId) => wrap(() => (projectId === undefined ? archiveTask(id) : archiveTask(id, projectId))),
  unarchive: (id, projectId) =>
    wrap(() => (projectId === undefined ? unarchiveTask(id) : unarchiveTask(id, projectId))),
  addDependency: (taskId, dependsOnId) => wrap(() => addDependency(taskId, dependsOnId)),
  removeDependency: (taskId, dependsOnId) => wrap(() => removeDependency(taskId, dependsOnId)),
};
