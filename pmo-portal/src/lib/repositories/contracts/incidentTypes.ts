import type { IncidentTypeOption } from '@/src/lib/db/incidentTypes';

export interface IncidentTypeRepository {
  list(): Promise<IncidentTypeOption[]>;
  add(label: string): Promise<void>;
  rename(id: string, label: string): Promise<void>;
  setArchived(id: string, archived: boolean): Promise<void>;
}
