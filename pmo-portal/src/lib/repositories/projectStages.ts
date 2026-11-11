import * as dal from '@/src/lib/db/projectStageEntries';
import type { ProjectStageRepository } from './contracts/projectStages';

export const projectStageRepository: ProjectStageRepository = {
  list: dal.listStageEntries,
  redate: dal.redateStageEntry,
  addSkipped: dal.addSkippedStageEntry,
  importHistory: dal.importProjectStageHistory,
};
