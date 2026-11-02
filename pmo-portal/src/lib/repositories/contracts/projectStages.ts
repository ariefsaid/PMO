import type { ImportStageDate, StageEntry } from '@/src/lib/db/projectStageEntries';
import type { ProjectStatus } from '@/src/lib/db/projectTransitions';

export interface ProjectStageRepository {
  list(projectId: string): Promise<StageEntry[]>;
  redate(entryId: string, enteredOn: string): Promise<void>;
  addSkipped(beforeEntryId: string, stage: ProjectStatus, enteredOn: string): Promise<void>;
  importHistory(projectId: string, entries: ImportStageDate[]): Promise<void>;
}
