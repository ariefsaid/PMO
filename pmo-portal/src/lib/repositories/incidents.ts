/** Incident repository implementation. */
import {
  listIncidents,
  getIncident,
  createIncident,
  updateIncident,
  transitionIncident,
  deleteIncident,
} from '@/src/lib/db/incidents';
import { wrap } from './repositoryErrors';
import type { IncidentRepository } from './contracts/incidents';

export const incidentRepository: IncidentRepository = {
  list: (params) => wrap(() => listIncidents(params)),
  get: (id) => wrap(() => getIncident(id)),
  create: (input) => wrap(() => createIncident(input)),
  update: (id, input) => wrap(() => updateIncident(id, input)),
  transition: (id, status) => wrap(() => transitionIncident(id, status)),
  delete: (id) => wrap(() => deleteIncident(id)),
};
