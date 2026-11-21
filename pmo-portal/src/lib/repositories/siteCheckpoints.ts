/**
 * repositories/siteCheckpoints.ts (#2594) — the seam over timed checkpoints (ADR-0017). Standalone module (same shape as
 * `crews.ts`): imported directly by its hooks, so the registry in `index.ts` and its key list stay as they are.
 */
import * as dal from '@/src/lib/db/siteCheckpoints';
import { wrap } from './repositoryErrors';
import type { SiteCheckpointRepository } from './contracts/siteCheckpoints';

export type {
  CheckpointTemplateItem, DayCheckpoint, CheckpointState, CrewPunctuality, PunctualityDay, PunctualityResult, LostTimeResult, LostTimeRow,
  PunctualityFilter, PunctualityStatus, RecordInput,
} from '@/src/lib/db/siteCheckpoints';

export const siteCheckpointRepository: SiteCheckpointRepository = {
  getList: () => wrap(() => dal.getCheckpointList()),
  setList: (items) => wrap(() => dal.setCheckpointList(items)),
  day: (workOrderId, date) => wrap(() => dal.listDayCheckpoints(workOrderId, date)),
  flag: (workOrderId, date) => wrap(() => dal.getWorkOrderFlag(workOrderId, date)),
  record: (input) => wrap(() => dal.recordCheckpoint(input)),
  recordRefs: (id) => wrap(() => dal.getCheckpointRecordRefs(id)),
  photoUrl: (path) => wrap(() => dal.checkpointPhotoUrl(path)),
  punctuality: (filter) => wrap(() => dal.getCrewPunctuality(filter)),
  lostTime: (filter) => wrap(() => dal.getLostTimeByCause(filter)),
};
