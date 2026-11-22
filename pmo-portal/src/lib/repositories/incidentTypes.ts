import { wrap } from './repositoryErrors';
import { listIncidentTypes, addIncidentType, renameIncidentType, setIncidentTypeArchived } from '@/src/lib/db/incidentTypes';
import type { IncidentTypeRepository } from './contracts/incidentTypes';

export const incidentTypeRepository: IncidentTypeRepository = {
  list: () => wrap(() => listIncidentTypes()),
  add: (label) => wrap(() => addIncidentType(label)),
  rename: (id, label) => wrap(() => renameIncidentType(id, label)),
  setArchived: (id, archived) => wrap(() => setIncidentTypeArchived(id, archived)),
};
