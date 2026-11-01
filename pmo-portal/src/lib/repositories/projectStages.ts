import * as dal from '@/src/lib/db/projectStageEntries';

export const projectStageRepository = {
  list: dal.listStageEntries,
  redate: dal.redateStageEntry,
  addSkipped: dal.addSkippedStageEntry,
  importHistory: dal.importProjectStageHistory,
};

export type ProjectStageRepository = typeof projectStageRepository;
