/** Incident repository implementation. */
import {
  listIncidents,
  listIncidentsPage,
  countIncidents,
  getIncident,
  createIncident,
  updateIncident,
  transitionIncident,
  deleteIncident,
  listIncidentFiles,
  uploadIncidentFile,
  getIncidentFileUrl,
  createTaskFromIncident,
  addTaskToIncident,
  mayTaskIncident,
  setIncidentRootCause,
} from '@/src/lib/db/incidents';
import { wrap } from './repositoryErrors';
import type { IncidentRepository } from './contracts/incidents';

export const incidentRepository: IncidentRepository = {
  list: (params) => wrap(() => listIncidents(params)),
  listPage: (params) => wrap(() => listIncidentsPage(params)),
  count: () => wrap(() => countIncidents()),
  get: (id) => wrap(() => getIncident(id)),
  create: (input) => wrap(() => createIncident(input)),
  update: (id, input) => wrap(() => updateIncident(id, input)),
  transition: (id, status, closeNote) => wrap(() => transitionIncident(id, status, closeNote)),
  listFiles: (incidentId) => wrap(() => listIncidentFiles(incidentId)),
  uploadFile: (input) => wrap(() => uploadIncidentFile(input)),
  fileUrl: (filePath) => wrap(() => getIncidentFileUrl(filePath)),
  createTask: (incidentId) => wrap(() => createTaskFromIncident(incidentId)),
  addTask: (incidentId, input) => wrap(() => addTaskToIncident(incidentId, input)),
  mayTaskIncident: (incidentId) => wrap(() => mayTaskIncident(incidentId)),
  setRootCause: (id, rootCause) => wrap(() => setIncidentRootCause(id, rootCause)),
  delete: (id) => wrap(() => deleteIncident(id)),
};
